/* Memos derived from the state: the filtered view, presentation options, graph sources and status messages. */
import { createMemo } from 'solid-js';
import { MAX_AUTO_EDGES, TYPE_KEYS, need } from './common';
import type { State } from './state';
import { buildView } from '../lib/graph';
import { toMermaid, toDot } from '../lib/exporters';
import { activeEventIds, enabledFormIds } from '../lib/filterSelection';
import type { Explore, ExploreFilter, View, ViewFilter, ViewOptions, ViewPresentation } from '../lib/types';

export function createDerived(state: State) {
  const {
    model, instances, expanded, expandedEvents, explore, forcedFor,
  } = state;
  const { level } = state.selection;
  const { focus, focusDir, focusDepth, pair } = state.focusing;
  const { dir, labelMode, groupBy, edgeLabels, renderer } = state.presentation;
  const { formsOn, eventsOn, typesOn, crossOnly, instanceOnly, hideIso, hideIsoNodes, showMissing } = state.filters;

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

  return {
    formIds, instanceMode, exploreVisible, currentExploration, filter, presentationOptions, opts, view,
    mermaidSrc, dotSrc, graphSrc, graphStatus, tooBig, formLabel,
  };
}

export type Derived = ReturnType<typeof createDerived>;
