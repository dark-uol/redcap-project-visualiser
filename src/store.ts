/* Application state: signals, derived memos, the graph-render effect and actions.
   Created once under a root (client-only app, so module scope is fine). */
import { createSignal, createMemo, createEffect, createRoot } from 'solid-js';
import { parseODM } from './lib/parser';
import { TYPES, buildModel, buildView, neighbors } from './lib/graph';
import { toMermaid, toDot, toCsv } from './lib/exporters';
import { renderDot, renderMermaid } from './lib/renderers';
import { download } from './lib/download';
import { isInstanceScopedId } from './lib/selection';
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
  selection: string | null;
  edge: FormPair | null;
}

/** Browser history entry: navigation plus the file sequence number. */
type HistoryState = Navigation & { m: number };

/** Keeps zoom and the position of a node across re-renders; set by GraphView, null when unmounted. */
type AnchorCapture = (nodeId: string, options?: { zoom?: boolean; back?: boolean }) => void;

/** Input to one graph render: the text to draw and the context it is drawn in. */
interface RenderInput {
  source: string | null;
  rendererName: Renderer;
  tooBig: boolean;
  status: string;
  view: View | null;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
  const [instanceOnly, setInstanceOnly] = createSignal(false); // only logic using [current/first/last/previous/next-instance]
  const [instances, setInstances] = createSignal(false); // form level, longitudinal: one node per form per event
  const [crossOnly, setCrossOnly] = createSignal(false); // only references that name another event ([event][var])
  const [formQ, setFormQ] = createSignal('');
  const [pair, setPair] = createSignal<FormPair | null>(null); // only the field links of one form->form edge
  const [selectedEdge, setSelectedEdge] = createSignal<FormPair | null>(null); // form-level edge clicked in the graph
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set()); // form ids expanded in place at form level
  const [explore, setExplore] = createSignal<Explore | null>(null); // interactive expansion

  const [tab, setTab] = createSignal<Tab>('graph');
  const [downloadMenuOpen, setDownloadMenuOpen] = createSignal(false);
  const [selected, setSelectedRaw] = createSignal<string | null>(null);
  const setSelected = (v: string | null): void => { if (v) setSelectedEdge(null); setSelectedRaw(v); };
  const [depQ, setDepQ] = createSignal('');
  const [fieldQ, setFieldQ] = createSignal('');
  const [svgEl, setSvgEl] = createSignal<SVGSVGElement | null>(null);
  const [svgView, setSvgView] = createSignal<View | null>(null); // the view svgEl was rendered from (view() may already be newer)
  const [busy, setBusy] = createSignal(false);
  const [renderMsg, setRenderMsg] = createSignal('');
  const [forcedFor, setForcedFor] = createSignal('');
  const [mxCell, setMxCell] = createSignal(0); // matrix cell size, 0 = automatic

  // keeps zoom + the position of the node you acted on across expand/collapse re-renders
  let anchorCapture: AnchorCapture | null = null;
  const captureAnchor = (nodeId: string, options?: { zoom?: boolean; back?: boolean }): void => { anchorCapture?.(nodeId, options); };
  const setAnchorCapture = (fn: AnchorCapture | null): void => { anchorCapture = fn; };

  // ================= derived =================
  const formIds = createMemo<string[]>(() => {
    const loadedModel = model();
    return loadedModel ? loadedModel.parsed.forms.map((f) => f.id) : [];
  });
  const instanceMode = (): boolean => {
    const loadedModel = model();
    return instances() && level() === 'form' && !!loadedModel && (loadedModel.parsed.events || []).length > 0;
  };
  const exploreVisible = (exploration: Pick<Explore, 'seeds' | 'exp'>): Set<string> =>
    new Set([...exploration.seeds, ...exploration.exp.flatMap((x) => x.added)]);
  const currentExploration = (): Explore | null => {
    const e = explore();
    return e && e.level === level() && !!e.inst === instanceMode() ? e : null;
  };
  const filter = createMemo<ViewFilter | null>(() => {
    const loadedModel = model();
    if (!loadedModel) return null;
    const formsEnabled = formsOn();
    // event/arm filter narrows the form set: only forms collected in at least one selected event stay
    const events = loadedModel.parsed.events || [], eventsEnabled = eventsOn();
    const evActive = events.some((e) => eventsEnabled[e.id] === false);
    const evForms = evActive ? new Set(events.filter((e) => eventsEnabled[e.id] !== false).flatMap((e) => e.forms)) : null;
    const on = formIds().filter((i) => formsEnabled[i] !== false && (!evForms || evForms.has(i)));
    const typesEnabled = typesOn();
    const currentExplorationValue = currentExploration();
    const explored: ExploreFilter | null = currentExplorationValue ? { level: level(), inst: instanceMode(), set: exploreVisible(currentExplorationValue) } : null;
    return {
      level: level(),
      eventSet: evActive ? new Set(events.filter((e) => eventsEnabled[e.id] !== false).map((e) => e.id)) : null,
      hideIsolated: hideIso(),
      hideIsolatedNodes: hideIsoNodes(),
      showMissing: showMissing(),
      types: new Set(TYPE_KEYS.filter((k) => typesEnabled[k])),
      forms: on.length === formIds().length ? null : new Set(on),
      formsNone: on.length === 0,
      crossOnly: crossOnly(),
      instOnly: instanceOnly(),
      instances: instanceMode(),
      expanded: level() === 'form' ? expanded() : null,
      explore: explored,
      pair: pair(),
      focus: focus(),
      focusDir: focusDir(),
      focusDepth: focusDepth(),
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
    const loadedModel = model();
    if (!loadedModel) return null;
    const o = need(opts());
    return o.formsNone ? { level: o.level, nodes: [], edges: [], groups: [] } : buildView(loadedModel, o);
  });
  // lazy: only built when read (the renderer in use, or a download), and only once per view
  const lazySrc = (fn: (v: View, o: ViewOptions) => string) => {
    let lastView: View | null = null, lastOptions: ViewOptions | null = null, cachedSource = '';
    return (): string => {
      const currentView = view(), currentOptions = opts();
      if (currentView !== lastView || currentOptions !== lastOptions) {
        lastView = currentView;
        lastOptions = currentOptions;
        cachedSource = currentView && currentOptions ? fn(currentView, currentOptions) : '';
      }
      return cachedSource;
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
  function expandRef(t: string, direction: NeighborDir): void {
    captureAnchor(t);
    const exploration = currentExploration() || { level: level(), seeds: [], exp: [] };
    const neighborIds = neighbors(need(model()), need(filter()), t, direction);
    const seeds = exploreVisible(exploration).has(t) ? exploration.seeds : [...exploration.seeds, t];
    setExplore({ level: exploration.level, inst: instanceMode(), seeds, exp: [...exploration.exp, { node: t, dir: direction, added: neighborIds }] });
    setPair(null);
    setFocus('');
  }
  function collapseRef(t: string, direction: NeighborDir): void {
    const exploration = currentExploration();
    if (!exploration) return;
    captureAnchor(t);
    let exp = exploration.exp.filter((x) => !(x.node === t && x.dir === direction));
    for (;;) { // drop expansions whose own node is no longer visible
      const vis = exploreVisible({ seeds: exploration.seeds, exp });
      const keep = exp.filter((x) => vis.has(x.node));
      if (keep.length === exp.length) break;
      exp = keep;
    }
    setExplore({ ...exploration, exp });
  }
  createEffect(level, () => { setExplore(null); }, { defer: true });
  // node ids differ between plain and Instances mode (form vs form@event): drop a selection that may no longer exist
  // untracked: compares against the last value so selection is only dropped when the mode actually flips
  let previousInstanceMode = false;
  createEffect(
    () => [instanceMode(), selected()] as const,
    ([im, s]) => {
      if (im === previousInstanceMode) return;
      previousInstanceMode = im;
      if (s && isInstanceScopedId(s)) setSelectedRaw(null);
    },
  );
  function toggleExpandForm(formId: string): void {
    const on = expanded().has(formId);
    captureAnchor(formId, on ? { back: true } : { zoom: true });
    const next = new Set(expanded());
    if (on) next.delete(formId);
    else next.add(formId);
    setExpanded(next);
  }

  // ================= graph rendering =================
  // untracked: monotonic id so a stale async render is discarded when a newer one has started
  let token = 0;
  let svgNow: SVGSVGElement | null = null; // mirrors svgEl for the (untracked) render step below
  const setSvg = (v: SVGSVGElement | null): void => { svgNow = v; setSvgEl(v); };
  createEffect(
    (): RenderInput => ({ source: graphSrc(), rendererName: renderer(), tooBig: tooBig(), status: graphStatus(), view: view() }),
    (input) => { renderGraph(input); },
  );
  async function renderGraph(input: RenderInput): Promise<void> {
    const { source, rendererName, tooBig: big, status, view: v } = input;
    if (source == null) return;
    const renderToken = ++token;
    const clear = (msg: string): void => { setBusy(false); setSvg(null); setSvgView(null); setRenderMsg(msg); };
    if (status) { clear(status); return; }
    if (big) { clear(''); return; }
    setRenderMsg(svgNow ? '' : 'Rendering…');
    setBusy(true); // keep the previous SVG on screen (dimmed) until the new one is ready
    try {
      const svg = rendererName === 'graphviz' ? await renderDot(source) : await renderMermaid('mmd' + renderToken, source);
      if (renderToken !== token) return;
      setRenderMsg(''); setBusy(false); setSvgView(v); setSvg(svg);
    } catch (e) {
      if (renderToken !== token) return;
      clear('Could not render graph: ' + errorMessage(e) + ' (check your network connection). The Mermaid and DOT downloads still work.');
    }
  }

  // ================= loading =================
  const currentNav = (): Navigation => ({ tab: tab(), level: level(), focus: focus(), pair: pair(), selection: selected(), edge: selectedEdge() });
  const applyNav = (n: Navigation): void => { setTab(n.tab); setLevel(n.level); setFocus(n.focus); setPair(n.pair); setSelectedRaw(n.selection); setSelectedEdge(n.edge); };
  const resetNav = (): void => { setTab('graph'); setLevel('form'); setFocus(''); setPair(null); setSelectedEdge(null); setSelected(null); };
  function loadText(text: string, name?: string): void {
    try {
      const parsed = parseODM(text);
      const builtModel = buildModel(parsed);
      modelSeq++;
      setLoadError('');
      setFileBase((name || parsed.projectName).replace(/\.xml$/i, '').replace(/[^\w.-]+/g, '_') || 'redcap');
      resetNav(); setFormQ(''); setFormsOn({}); setEventsOn({}); setCrossOnly(false); setInstanceOnly(false);
      setExplore(null); setExpanded(new Set<string>());
      setTypesOn(allTypesOn());
      setModel(builtModel);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }
  async function loadSample(): Promise<void> {
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'sample/sample.xml');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      loadText(await res.text(), 'sample');
    } catch (e) {
      setLoadError('Could not load sample/sample.xml (' + errorMessage(e) + ').');
    }
  }
  function readFile(f: File): void {
    const r = new FileReader();
    r.onload = () => loadText(String(r.result), f.name);
    r.onerror = () => setLoadError('Could not read file');
    r.readAsText(f);
  }

  // ================= downloads =================
  const suffix = (): string => (level() === 'form' ? (instanceMode() ? '_instances' : '_forms') : level() === 'event' ? '_events' : '_fields');
  const downloadMermaid = (): void => download(fileBase() + suffix() + '.mmd', mermaidSrc());
  const downloadDot = (): void => download(fileBase() + suffix() + '.dot', dotSrc());
  const downloadCsv = (): void => {
    const loadedModel = need(model());
    const types = need(opts()).types;
    download(fileBase() + '_dependencies.csv', toCsv(loadedModel, loadedModel.edges.filter((e) => types.has(e.type))), 'text/csv;charset=utf-8');
  };
  const downloadSvg = (): void => {
    const s = svgEl();
    if (!s) { alert('Render the graph first.'); return; }
    const c = s.cloneNode(true) as SVGSVGElement;
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    download(fileBase() + suffix() + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c), 'image/svg+xml;charset=utf-8');
  };

  // ================= shared navigation helpers =================
  const jumpToField = (v: string): void => { setLevel('field'); setFocus(v); setPair(null); setSelectedEdge(null); setSelected(v); setTab('graph'); };
  const pickNode = (id: string): void => { setSelectedEdge(null); setSelected(id); };

  // ================= browser history: back/forward step through tab / level / focus / selection =================
  let lastKey: string | null = null;
  createEffect(
    (): HistoryState | null => (model() ? { m: modelSeq, ...currentNav() } : null),
    (st) => {
      if (!st) return;
      const key = JSON.stringify(st);
      if (key === lastKey) return;
      const sameFile = lastKey !== null && (JSON.parse(lastKey) as HistoryState).m === st.m;
      try {
        if (sameFile) history.pushState(st, '');
        else history.replaceState(st, '');
      } catch { /* history unavailable */ }
      lastKey = key;
    },
  );
  window.addEventListener('popstate', (e: PopStateEvent) => {
    const st = e.state as HistoryState | null;
    if (!st || !model() || st.m !== modelSeq) return;
    lastKey = JSON.stringify(st);
    applyNav(st);
  });

  return {
    model, fileBase, dragOver, setDragOver, loadError, level, setLevel, renderer, setRenderer, dir, setDir, labelMode, setLabelMode,
    groupBy, setGroupBy, edgeLabels, setEdgeLabels, hideIso, setHideIso, hideIsoNodes, setHideIsoNodes, showMissing, setShowMissing,
    typesOn, setTypesOn, formsOn, setFormsOn, focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, eventsOn, setEventsOn,
    instanceOnly, setInstanceOnly, instances, setInstances, crossOnly, setCrossOnly, formQ, setFormQ, pair, setPair, selectedEdge, setSelectedEdge,
    expanded, explore, setExplore, tab, setTab, downloadMenuOpen, setDownloadMenuOpen, selected, setSelected, setSelectedRaw, depQ, setDepQ, fieldQ, setFieldQ,
    svgEl, svgView, busy, renderMsg, forcedFor, setForcedFor, mxCell, setMxCell, captureAnchor, setAnchorCapture,
    opts, view, dotSrc, mermaidSrc, tooBig, instanceMode, exploreVisible, currentExploration, formLabel,
    expandRef, collapseRef, toggleExpandForm, loadText, loadSample, readFile, downloadMermaid, downloadDot, downloadCsv, downloadSvg, jumpToField, pickNode,
  };
});

export const {
  model, fileBase, dragOver, setDragOver, loadError, level, setLevel, renderer, setRenderer, dir, setDir, labelMode, setLabelMode,
  groupBy, setGroupBy, edgeLabels, setEdgeLabels, hideIso, setHideIso, hideIsoNodes, setHideIsoNodes, showMissing, setShowMissing,
  typesOn, setTypesOn, formsOn, setFormsOn, focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, eventsOn, setEventsOn,
  instanceOnly, setInstanceOnly, instances, setInstances, crossOnly, setCrossOnly, formQ, setFormQ, pair, setPair, selectedEdge, setSelectedEdge,
  expanded, explore, setExplore, tab, setTab, downloadMenuOpen, setDownloadMenuOpen, selected, setSelected, setSelectedRaw, depQ, setDepQ, fieldQ, setFieldQ,
  svgEl, svgView, busy, renderMsg, forcedFor, setForcedFor, mxCell, setMxCell, captureAnchor, setAnchorCapture,
  opts, view, dotSrc, mermaidSrc, tooBig, instanceMode, exploreVisible, currentExploration, formLabel,
  expandRef, collapseRef, toggleExpandForm, loadText, loadSample, readFile, downloadMermaid, downloadDot, downloadCsv, downloadSvg, jumpToField, pickNode,
} = app;
