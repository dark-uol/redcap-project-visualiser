/* Application state: signals, derived memos, the graph-render effect and actions.
   Created once under a root (client-only app, so module scope is fine). */
import { createSignal, createMemo, createEffect, createRoot } from 'solid-js';
import { parseODM } from './lib/parser';
import { TYPES, buildModel, buildView, neighbors } from './lib/graph';
import { toMermaid, toDot, toCsv } from './lib/exporters';
import { renderDot, renderMermaid } from './lib/renderers';
import { download } from './lib/download';
import type {
  DepType, Direction, Explore, ExploreFilter, FocusDir, FormPair, GroupBy, LabelMode, Level, Model, NeighborDir,
  Renderer, View, ViewFilter, ViewOptions, ViewPresentation,
} from './lib/types';

export const MAX_AUTO_EDGES = 700;
export const TYPE_KEYS = Object.keys(TYPES) as DepType[];
export const clampDepth = (v: unknown): number => Math.min(50, Math.max(1, Math.round(Number(v)) || 1));

export type Tab = 'graph' | 'matrix' | 'analysis' | 'deps' | 'fields';

/** Navigation state: tab, level, focus and selection. */
export interface Navigation {
  tab: Tab;
  level: Level;
  focus: string;
  pair: FormPair | null;
  sel: string | null;
  edge: FormPair | null;
}

/** Browser history entry: navigation plus the file sequence number. */
type HistState = Navigation & { m: number };

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The value, asserting it is present. Components only render once a project is loaded. */
export function need<T>(v: T | null | undefined): T {
  if (v == null) throw new Error('No project loaded');
  return v;
}

const allTypesOn = (): Record<DepType, boolean> =>
  Object.fromEntries(TYPE_KEYS.map((k) => [k, true])) as Record<DepType, boolean>;

const app = createRoot(() => {
  // ================= state =================
  let modelSeq = 0; // bumps on each file load; history entries from an older file are ignored
  const [model, setModel] = createSignal<Model | null>(null);
  const [fileBase, setFileBase] = createSignal('redcap');
  const [dragOver, setDragOver] = createSignal(false);
  const [loadError, setLoadError] = createSignal('');

  const [level, setLevel] = createSignal<Level>('form'); // open in form-level view
  const [renderer, setRenderer] = createSignal<Renderer>('graphviz');
  const [dir, setDir] = createSignal<Direction>('LR');
  const [labelMode, setLabelMode] = createSignal<LabelMode>('var');
  const [groupBy, setGroupBy] = createSignal<GroupBy>('form'); // field level clusters: none | form | event | arm
  const [edgeLabels, setEdgeLabels] = createSignal(false);
  const [hideIso, setHideIso] = createSignal(true); // fields (field level; fields listed inside expanded forms)
  const [hideIsoNodes, setHideIsoNodes] = createSignal(true); // forms (form level) / events (event level)
  const [showMissing, setShowMissing] = createSignal(true);
  const [typesOn, setTypesOn] = createSignal<Record<DepType, boolean>>(allTypesOn());
  const [formsOn, setFormsOn] = createSignal<Record<string, boolean>>({}); // id -> bool (absent = on)
  const [focus, setFocus] = createSignal('');
  const [focusDir, setFocusDir] = createSignal<FocusDir>('both');
  const [focusDepth, setFocusDepthRaw] = createSignal(3);
  const setFocusDepth = (v: unknown) => setFocusDepthRaw(clampDepth(v));
  const [eventsOn, setEventsOn] = createSignal<Record<string, boolean>>({}); // event id -> bool (absent = on)
  const [instOnly, setInstOnly] = createSignal(false); // only logic using [current/first/last/previous/next-instance]
  const [instances, setInstances] = createSignal(false); // form level, longitudinal: one node per form per event
  const [crossOnly, setCrossOnly] = createSignal(false); // only references that name another event ([event][var])
  const [formQ, setFormQ] = createSignal('');
  const [pair, setPair] = createSignal<FormPair | null>(null); // only the field links of one form->form edge
  const [selEdge, setSelEdge] = createSignal<FormPair | null>(null); // form-level edge clicked in the graph
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set()); // form ids expanded in place at form level
  const [explore, setExplore] = createSignal<Explore | null>(null); // interactive expansion

  const [tab, setTab] = createSignal<Tab>('graph');
  const [dlOpen, setDlOpen] = createSignal(false);
  const [selected, setSelectedRaw] = createSignal<string | null>(null);
  const setSelected = (v: string | null): void => { if (v) setSelEdge(null); setSelectedRaw(v); };
  const [depQ, setDepQ] = createSignal('');
  const [fieldQ, setFieldQ] = createSignal('');
  const [svgEl, setSvgEl] = createSignal<SVGSVGElement | null>(null);
  const [svgView, setSvgView] = createSignal<View | null>(null); // the view svgEl was rendered from (view() may already be newer)
  const [busy, setBusy] = createSignal(false);
  const [renderMsg, setRenderMsg] = createSignal('');
  const [forcedFor, setForcedFor] = createSignal('');
  const [mxCell, setMxCell] = createSignal(0); // matrix cell size, 0 = automatic

  // keeps zoom + the position of the node you acted on across expand/collapse re-renders
  let anchorCapture: ((t: string, opt?: { zoom?: boolean; back?: boolean }) => void) | null = null;
  const captureAnchor = (t: string, opt?: { zoom?: boolean; back?: boolean }): void => { anchorCapture?.(t, opt); };
  const setAnchorCapture = (fn: typeof anchorCapture): void => { anchorCapture = fn; };

  // ================= derived =================
  const formIds = createMemo<string[]>(() => {
    const m = model();
    return m ? m.parsed.forms.map((f) => f.id) : [];
  });
  const instMode = (): boolean => {
    const m = model();
    return instances() && level() === 'form' && !!m && (m.parsed.events || []).length > 0;
  };
  const exVisible = (ex: Pick<Explore, 'seeds' | 'exp'>): Set<string> =>
    new Set([...ex.seeds, ...ex.exp.flatMap((x) => x.added)]);
  const curEx = (): Explore | null => {
    const e = explore();
    return e && e.level === level() && !!e.inst === instMode() ? e : null;
  };
  const filter = createMemo<ViewFilter | null>(() => {
    const m = model();
    if (!m) return null;
    const fo = formsOn();
    // event/arm filter narrows the form set: only forms collected in at least one selected event stay
    const evs = m.parsed.events || [], eo = eventsOn();
    const evActive = evs.some((e) => eo[e.id] === false);
    const evForms = evActive ? new Set(evs.filter((e) => eo[e.id] !== false).flatMap((e) => e.forms)) : null;
    const on = formIds().filter((i) => fo[i] !== false && (!evForms || evForms.has(i)));
    const t = typesOn();
    const ce = curEx();
    const explored: ExploreFilter | null = ce ? { level: level(), inst: instMode(), set: exVisible(ce) } : null;
    return {
      level: level(),
      eventSet: evActive ? new Set(evs.filter((e) => eo[e.id] !== false).map((e) => e.id)) : null,
      hideIsolated: hideIso(),
      hideIsolatedNodes: hideIsoNodes(),
      showMissing: showMissing(),
      types: new Set(TYPE_KEYS.filter((k) => t[k])),
      forms: on.length === formIds().length ? null : new Set(on),
      formsNone: on.length === 0,
      crossOnly: crossOnly(),
      instOnly: instOnly(),
      instances: instMode(),
      expanded: level() === 'form' ? expanded() : null,
      explore: explored,
      pair: pair(),
      focus: focus(),
      focusDir: focusDir(),
      focusDepth: Math.max(1, +focusDepth() || 1),
    };
  });
  const presentation = createMemo<ViewPresentation | null>(() => {
    if (!model()) return null;
    return {
      dir: dir(),
      labelMode: labelMode(),
      group: groupBy() !== 'none' && level() === 'field',
      groupBy: groupBy(),
      edgeLabels: edgeLabels(),
    };
  });
  const opts = createMemo<ViewOptions | null>(() => {
    const f = filter(), p = presentation();
    return f && p ? { ...f, ...p } : null;
  });
  const view = createMemo<View | null>(() => {
    const m = model();
    if (!m) return null;
    const o = need(opts());
    return o.formsNone ? { level: o.level, nodes: [], edges: [], groups: [] } : buildView(m, o);
  });
  // lazy: only built when read (the renderer in use, or a download), and only once per view
  const lazySrc = (fn: (v: View, o: ViewOptions) => string) => {
    let v0: View | null = null, o0: ViewOptions | null = null, out = '';
    return (): string => {
      const v = view(), o = opts();
      if (v !== v0 || o !== o0) {
        v0 = v;
        o0 = o;
        out = v && o ? fn(v, o) : '';
      }
      return out;
    };
  };
  const mermaidSrc = lazySrc(toMermaid);
  const dotSrc = lazySrc(toDot);
  // string memo: downstream only re-runs when the text sent to the renderer actually changes
  const graphSrc = createMemo<string | null>(() => (view() ? (renderer() === 'graphviz' ? dotSrc() : mermaidSrc()) : null));
  const graphStatus = createMemo<string>(() => {
    const v = view();
    if (!v) return '';
    if (!v.nodes.length) return 'Nothing to show with the current filters.';
    if (v.level === 'event' && !v.edges.length) return 'No cross-event references ([event][field]) with the current filters.';
    if (v.level === 'form' && v.instances && !v.edges.length) return 'No dependencies between form instances with the current filters.';
    if (v.level === 'form' && !v.edges.length) return 'No cross-form dependencies with the current filters.';
    return '';
  });
  const tooBig = createMemo<boolean>(() => !!view() && (view()?.edges.length ?? 0) > MAX_AUTO_EDGES && forcedFor() !== dotSrc());
  const formLabel = (id: string): string => {
    const f = model()?.formsById.get(id);
    return f ? f.label : id;
  };

  // ================= interactive expansion of back / forward references =================
  function expandRef(t: string, d: NeighborDir): void {
    captureAnchor(t);
    const ex = curEx() || { level: level(), seeds: [], exp: [] };
    const nb = neighbors(need(model()), need(opts()), t, d);
    const seeds = exVisible(ex).has(t) ? ex.seeds : [...ex.seeds, t];
    setExplore({ level: ex.level, inst: instMode(), seeds, exp: [...ex.exp, { node: t, dir: d, added: nb }] });
    setPair(null);
    setFocus('');
  }
  function collapseRef(t: string, d: NeighborDir): void {
    const ex = curEx();
    if (!ex) return;
    captureAnchor(t);
    let exp = ex.exp.filter((x) => !(x.node === t && x.dir === d));
    for (;;) { // drop expansions whose own node is no longer visible
      const vis = exVisible({ seeds: ex.seeds, exp });
      const keep = exp.filter((x) => vis.has(x.node));
      if (keep.length === exp.length) break;
      exp = keep;
    }
    setExplore({ ...ex, exp });
  }
  createEffect(level, () => { setExplore(null); }, { defer: true });
  // node ids differ between plain and Instances mode (form vs form@event): drop a selection that may no longer exist
  let prevInstMode = false;
  createEffect(
    () => [instMode(), selected()] as const,
    ([im, s]) => {
      if (im === prevInstMode) return;
      prevInstMode = im;
      if (s && s.includes('@') && !s.startsWith('@form:')) setSelectedRaw(null);
    },
  );
  function toggleExpandForm(F: string): void {
    const on = expanded().has(F);
    captureAnchor(F, on ? { back: true } : { zoom: true });
    const next = new Set(expanded());
    if (on) next.delete(F);
    else next.add(F);
    setExpanded(next);
  }

  // ================= graph rendering =================
  let token = 0;
  let svgNow: SVGSVGElement | null = null; // mirrors svgEl for the (untracked) render step below
  const setSvg = (v: SVGSVGElement | null): void => { svgNow = v; setSvgEl(v); };
  createEffect(
    () => ({ src: graphSrc(), r: renderer(), big: tooBig(), status: graphStatus(), v: view() }),
    ({ src, r, big, status, v }) => { renderGraph(src, r, big, status, v); },
  );
  async function renderGraph(src: string | null, r: Renderer, big: boolean, status: string, v: View | null): Promise<void> {
    if (src == null) return;
    const my = ++token;
    const clear = (msg: string): void => { setBusy(false); setSvg(null); setSvgView(null); setRenderMsg(msg); };
    if (status) { clear(status); return; }
    if (big) { clear(''); return; }
    setRenderMsg(svgNow ? '' : 'Rendering…');
    setBusy(true); // keep the previous SVG on screen (dimmed) until the new one is ready
    try {
      const svg = r === 'graphviz' ? await renderDot(src) : await renderMermaid('mmd' + my, src);
      if (my !== token) return;
      setRenderMsg(''); setBusy(false); setSvgView(v); setSvg(svg);
    } catch (e) {
      if (my !== token) return;
      clear('Could not render graph: ' + errMsg(e) + ' (check your network connection). The Mermaid and DOT downloads still work.');
    }
  }

  // ================= loading =================
  const currentNav = (): Navigation => ({ tab: tab(), level: level(), focus: focus(), pair: pair(), sel: selected(), edge: selEdge() });
  const applyNav = (n: Navigation): void => { setTab(n.tab); setLevel(n.level); setFocus(n.focus); setPair(n.pair); setSelectedRaw(n.sel); setSelEdge(n.edge); };
  const resetNav = (): void => { setTab('graph'); setLevel('form'); setFocus(''); setPair(null); setSelEdge(null); setSelected(null); };
  function loadText(text: string, name?: string): void {
    try {
      const parsed = parseODM(text);
      const m = buildModel(parsed);
      modelSeq++;
      setLoadError('');
      setFileBase((name || parsed.projectName).replace(/\.xml$/i, '').replace(/[^\w.-]+/g, '_') || 'redcap');
      resetNav(); setFormQ(''); setFormsOn({}); setEventsOn({}); setCrossOnly(false); setInstOnly(false);
      setExplore(null); setExpanded(new Set<string>());
      setTypesOn(allTypesOn());
      setModel(m);
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }
  async function loadSample(): Promise<void> {
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'sample/sample.xml');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      loadText(await res.text(), 'sample');
    } catch (e) {
      setLoadError('Could not load sample/sample.xml (' + errMsg(e) + ').');
    }
  }
  function readFile(f: File): void {
    const r = new FileReader();
    r.onload = () => loadText(String(r.result), f.name);
    r.onerror = () => setLoadError('Could not read file');
    r.readAsText(f);
  }

  // ================= downloads =================
  const suffix = (): string => (level() === 'form' ? (instMode() ? '_instances' : '_forms') : level() === 'event' ? '_events' : '_fields');
  const dlMermaid = (): void => download(fileBase() + suffix() + '.mmd', mermaidSrc());
  const dlDot = (): void => download(fileBase() + suffix() + '.dot', dotSrc());
  const dlCsv = (): void => {
    const m = need(model());
    const types = need(opts()).types;
    download(fileBase() + '_dependencies.csv', toCsv(m, m.edges.filter((e) => types.has(e.type))), 'text/csv;charset=utf-8');
  };
  const dlSvg = (): void => {
    const s = svgEl();
    if (!s) { alert('Render the graph first.'); return; }
    const c = s.cloneNode(true) as SVGSVGElement;
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    download(fileBase() + suffix() + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c), 'image/svg+xml;charset=utf-8');
  };

  // ================= shared navigation helpers =================
  const jumpToField = (v: string): void => { setLevel('field'); setFocus(v); setPair(null); setSelEdge(null); setSelected(v); setTab('graph'); };
  const pickNode = (id: string): void => { setSelEdge(null); setSelected(id); };

  // ================= browser history: back/forward step through tab / level / focus / selection =================
  let lastKey: string | null = null;
  createEffect(
    (): HistState | null => (model() ? { m: modelSeq, ...currentNav() } : null),
    (st) => {
      if (!st) return;
      const key = JSON.stringify(st);
      if (key === lastKey) return;
      const sameFile = lastKey !== null && (JSON.parse(lastKey) as HistState).m === st.m;
      try {
        if (sameFile) history.pushState(st, '');
        else history.replaceState(st, '');
      } catch { /* history unavailable */ }
      lastKey = key;
    },
  );
  window.addEventListener('popstate', (e: PopStateEvent) => {
    const st = e.state as HistState | null;
    if (!st || !model() || st.m !== modelSeq) return;
    lastKey = JSON.stringify(st);
    applyNav(st);
  });

  return {
    model, fileBase, dragOver, setDragOver, loadError, level, setLevel, renderer, setRenderer, dir, setDir, labelMode, setLabelMode,
    groupBy, setGroupBy, edgeLabels, setEdgeLabels, hideIso, setHideIso, hideIsoNodes, setHideIsoNodes, showMissing, setShowMissing,
    typesOn, setTypesOn, formsOn, setFormsOn, focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, eventsOn, setEventsOn,
    instOnly, setInstOnly, instances, setInstances, crossOnly, setCrossOnly, formQ, setFormQ, pair, setPair, selEdge, setSelEdge,
    expanded, explore, setExplore, tab, setTab, dlOpen, setDlOpen, selected, setSelected, setSelectedRaw, depQ, setDepQ, fieldQ, setFieldQ,
    svgEl, svgView, busy, renderMsg, forcedFor, setForcedFor, mxCell, setMxCell, captureAnchor, setAnchorCapture,
    filter, presentation, opts, view, dotSrc, mermaidSrc, tooBig, instMode, exVisible, curEx, formLabel,
    expandRef, collapseRef, toggleExpandForm, loadText, loadSample, readFile, dlMermaid, dlDot, dlCsv, dlSvg, jumpToField, pickNode,
  };
});

export const {
  model, fileBase, dragOver, setDragOver, loadError, level, setLevel, renderer, setRenderer, dir, setDir, labelMode, setLabelMode,
  groupBy, setGroupBy, edgeLabels, setEdgeLabels, hideIso, setHideIso, hideIsoNodes, setHideIsoNodes, showMissing, setShowMissing,
  typesOn, setTypesOn, formsOn, setFormsOn, focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, eventsOn, setEventsOn,
  instOnly, setInstOnly, instances, setInstances, crossOnly, setCrossOnly, formQ, setFormQ, pair, setPair, selEdge, setSelEdge,
  expanded, explore, setExplore, tab, setTab, dlOpen, setDlOpen, selected, setSelected, setSelectedRaw, depQ, setDepQ, fieldQ, setFieldQ,
  svgEl, svgView, busy, renderMsg, forcedFor, setForcedFor, mxCell, setMxCell, captureAnchor, setAnchorCapture,
  filter, presentation, opts, view, dotSrc, mermaidSrc, tooBig, instMode, exVisible, curEx, formLabel,
  expandRef, collapseRef, toggleExpandForm, loadText, loadSample, readFile, dlMermaid, dlDot, dlCsv, dlSvg, jumpToField, pickNode,
} = app;
