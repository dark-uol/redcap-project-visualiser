/* Memos derived from the state: the filtered view, presentation options, graph sources and status messages. */
import { createMemo, createSignal } from 'solid-js';
import { MAX_AUTO_EDGES, TYPE_KEYS, need } from './common';
import type { State } from './state';
import { buildView } from '../lib/graph';
import { toMermaid, toDot } from '../lib/exporters';
import { activeEventIds, enabledFormIds } from '../lib/filterSelection';
import { evaluateVisibility } from '../lib/whatIf';
import type { VisibilityInfo, WhatIfContext } from '../lib/whatIf';
import type { PythonVisibilityEngine } from '../lib/pythonEngine';
import type { Model, Renderer, Explore, ExploreFilter, View, ViewFilter, ViewOptions, ViewPresentation } from '../lib/types';

export function createDerived(state: State) {
  const {
    model, instances, expanded, expandedEvents, explore, forcedFor,
  } = state;
  const { level } = state.selection;
  const { focus, focusDir, focusDepth, pair } = state.focusing;
  const { dir, labelMode, groupBy, edgeLabels, lineWidths, renderer } = state.presentation;
  const { formsOn, eventsOn, typesOn, crossOnly, instanceOnly, hideIso, hideIsoNodes, showMissing } = state.filters;

  const formIds = createMemo<string[]>(() => {
    const loadedModel = model();
    return loadedModel ? loadedModel.parsed.forms.map((f) => f.id) : [];
  });
  /**
   * The renderer actually used. Swimlane needs a longitudinal project: it shows events, form instances, or forms and fields
   * in the column of their form's first event, at every level. Without events ELK stands in. Switching renderer never
   * changes the view itself, only how it is laid out.
   */
  const effectiveRenderer = (): Renderer => {
    const loadedModel = model();
    const swimlaneApplies = !!loadedModel && (loadedModel.parsed.events || []).length > 0;
    return renderer() === 'swimlane' && !swimlaneApplies ? 'elk' : renderer();
  };
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
    // event/arm filter narrows the form set: only forms collected in at least one selected event stay
    const events = loadedModel.parsed.events || [];
    const activeEvents = activeEventIds(events, eventsOn());
    const on = enabledFormIds(formIds(), formsOn(), events, activeEvents);
    const typesEnabled = typesOn();
    const currentExplorationValue = currentExploration();
    const explored: ExploreFilter | null = currentExplorationValue ? { level: level(), inst: instanceMode(), set: exploreVisible(currentExplorationValue) } : null;
    return {
      level: level(),
      eventSet: activeEvents,
      hideIsolated: hideIso(),
      hideIsolatedNodes: hideIsoNodes(),
      showMissing: showMissing(),
      types: new Set(TYPE_KEYS.filter((k) => typesEnabled[k])),
      forms: on.length === formIds().length ? null : new Set(on),
      formsNone: on.length === 0,
      crossOnly: crossOnly(),
      instOnly: instanceOnly(),
      instances: instanceMode(),
      expanded: level() === 'form' || level() === 'event' ? expanded() : null,
      expandedEvents: level() === 'event' ? expandedEvents() : null,
      explore: explored,
      pair: pair(),
      focus: focus(),
      focusDir: focusDir(),
      focusDepth: focusDepth(),
    };
  });
  const presentationOptions = createMemo<ViewPresentation | null>(() => {
    if (!model()) return null;
    return {
      dir: dir(),
      labelMode: labelMode(),
      group: groupBy() !== 'none' && level() === 'field',
      groupBy: groupBy(),
      edgeLabels: edgeLabels(),
      lineWidths: lineWidths(),
    };
  });
  const opts = createMemo<ViewOptions | null>(() => {
    const f = filter(), p = presentationOptions();
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
  const graphSrc = createMemo<string | null>(() => (view() ? (effectiveRenderer() === 'graphviz' ? dotSrc() : effectiveRenderer() === 'mermaid' ? mermaidSrc() : '') : null));
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
  // Results per event for the current model, values, mode and engine; a fresh cache whenever any of them changes
  interface VisibilityCache { results: Map<string, Map<string, VisibilityInfo>>; requested: Set<string> }
  const visibilityCache = createMemo<VisibilityCache>(() => {
    model(); state.whatIf.values(); state.whatIf.mode(); state.whatIf.engine(); state.whatIf.derive();
    return { results: new Map(), requested: new Set() };
  });
  // The Python engine for the loaded model, created on first use. Python loads asynchronously, so its results arrive later
  // and `pythonArrivals` tells readers to look again.
  const [pythonArrivals, setPythonArrivals] = createSignal(0);
  let pythonEngine: { parsed: unknown; ready: Promise<PythonVisibilityEngine> } | null = null;
  const pythonEngineFor = (loadedModel: Model): Promise<PythonVisibilityEngine> => {
    if (pythonEngine?.parsed === loadedModel.parsed) return pythonEngine.ready;
    pythonEngine?.ready.then((previous) => previous.destroy(), () => undefined);
    state.whatIf.setPythonStatus({ kind: 'loading' });
    const ready = import('../lib/pythonEngine')
      .then((module) => module.createPythonVisibility(loadedModel.parsed, { indexURL: import.meta.env.BASE_URL + 'pyodide/' }))
      .then((engine) => { state.whatIf.setPythonStatus({ kind: 'ready', version: engine.pythonVersion }); return engine; });
    ready.catch((error: unknown) => {
      pythonEngine = null;
      state.whatIf.setPythonStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    pythonEngine = { parsed: loadedModel.parsed, ready };
    return ready;
  };
  const evaluateInPython = (cache: VisibilityCache, loadedModel: Model, key: string, context: WhatIfContext): void => {
    if (cache.requested.has(key)) return;
    cache.requested.add(key);
    // Called while a view reads visibility, where writing a signal (the engine status) is not allowed: start from a microtask.
    queueMicrotask(function startPythonEvaluation() {
      pythonEngineFor(loadedModel)
        .then((engine) => { cache.results.set(key, engine.evaluate(context)); setPythonArrivals((count) => count + 1); })
        .catch(() => undefined); // reported through pythonStatus
    });
  };
  /**
   * Visibility as seen in `event` (null = no event), evaluated on first use. Null when nothing is set, so normal use costs nothing,
   * unless `evenWithoutValues`: the What if tab evaluates from nothing to list what a field needs (working backwards).
   * With the Python engine selected the answer is null until Python has loaded and evaluated it.
   */
  const visibilityIn = (event: string | null, evenWithoutValues = false): Map<string, VisibilityInfo> | null => {
    const loadedModel = model();
    if (!loadedModel || (state.whatIf.valueCount() === 0 && !evenWithoutValues)) return null;
    const cache = visibilityCache();
    const key = event ?? '';
    const context: WhatIfContext = { values: state.whatIf.values(), mode: state.whatIf.mode(), event, derive: state.whatIf.derive() };
    if (state.whatIf.engine() === 'python') {
      pythonArrivals(); // look again when a result arrives
      const arrived = cache.results.get(key);
      if (!arrived) evaluateInPython(cache, loadedModel, key, context);
      return arrived ?? null;
    }
    let result = cache.results.get(key);
    if (!result) {
      result = evaluateVisibility(loadedModel, context);
      cache.results.set(key, result);
    }
    return result;
  };
  const visibility = createMemo<Map<string, VisibilityInfo> | null>(() => visibilityIn(state.whatIf.event()));
  const formLabel = (id: string): string => {
    const f = model()?.formsById.get(id);
    return f ? f.label : id;
  };

  return {
    formIds, effectiveRenderer, instanceMode, exploreVisible, currentExploration, filter, presentationOptions, opts, view,
    mermaidSrc, dotSrc, graphSrc, graphStatus, tooBig, formLabel, visibility, visibilityIn,
  };
}

export type Derived = ReturnType<typeof createDerived>;
