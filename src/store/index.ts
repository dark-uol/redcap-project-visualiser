/* Application state: signals, derived memos, the graph-render effect and actions.
   Created once under a single root (client-only app, so module scope is fine). Components import from this module. */
import { createRoot } from 'solid-js';
import { createState } from './state';
import { createDerived } from './derived';
import { createExplorationActions } from './exploration';
import { setupRendering } from './rendering';
import { createNavigation } from './navigation';
import { createLoading } from './loading';
import { createDownloads } from './downloads';

export { MAX_AUTO_EDGES, TYPE_KEYS, clampDepth, need } from './common';
export type { Tab, Navigation } from './common';

// Order matters: exploration effects, then the render effect, then the history effect (as before the split).
const app = createRoot(() => {
  const state = createState();
  const derived = createDerived(state);
  const exploration = createExplorationActions(state, derived);
  setupRendering(state, derived);
  const navigation = createNavigation(state);
  const loading = createLoading(state, navigation);
  const downloads = createDownloads(state, derived);
  return { ...state, ...derived, ...exploration, ...navigation, ...loading, ...downloads };
});

export const {
  model, fileBase, dragOver, setDragOver, loadError, focusing, presentation, selection, whatIf, visibility, visibilityIn,
  instances, setInstances, filters,
  expanded, expandedEvents, explore, setExplore, depQ, setDepQ, fieldQ, setFieldQ,
  svgEl, svgView, busy, renderMsg, forcedFor, setForcedFor, mxCell, setMxCell, captureAnchor, setAnchorCapture,
  opts, view, dotSrc, mermaidSrc, tooBig, instanceMode, exploreVisible, currentExploration, formLabel,
  expandRef, collapseRef, toggleExpandForm, toggleExpandEvent, loadText, loadSample, readFile, downloadMermaid, downloadDot, downloadCsv, downloadSvg, jumpToField, pickNode,
} = app;
