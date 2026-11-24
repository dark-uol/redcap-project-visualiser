/* Signals and setters for the application state, plus the anchor-capture hook and the file sequence number. */
import { createSignal } from 'solid-js';
import { allTypesOn, clampDepth } from './common';
import type { AnchorCapture, Tab } from './common';
import type {
  DepType, Direction, Explore, FocusDir, FormPair, GroupBy, LabelMode, Level, Model, Renderer, View,
} from '../lib/types';

export function createState() {
  let modelSeq = 0; // bumps on each file load; history entries from an older file are ignored
  const nextModelSequence = (): number => ++modelSeq;
  const currentModelSequence = (): number => modelSeq;
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

  return {
    model, setModel, fileBase, setFileBase, dragOver, setDragOver, loadError, setLoadError,
    level, setLevel, renderer, setRenderer, dir, setDir, labelMode, setLabelMode,
    groupBy, setGroupBy, edgeLabels, setEdgeLabels, hideIso, setHideIso, hideIsoNodes, setHideIsoNodes, showMissing, setShowMissing,
    typesOn, setTypesOn, formsOn, setFormsOn, focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, eventsOn, setEventsOn,
    instanceOnly, setInstanceOnly, instances, setInstances, crossOnly, setCrossOnly, formQ, setFormQ, pair, setPair, selectedEdge, setSelectedEdge,
    expanded, setExpanded, explore, setExplore, tab, setTab, downloadMenuOpen, setDownloadMenuOpen, selected, setSelected, setSelectedRaw,
    depQ, setDepQ, fieldQ, setFieldQ, svgEl, setSvgEl, svgView, setSvgView, busy, setBusy, renderMsg, setRenderMsg,
    forcedFor, setForcedFor, mxCell, setMxCell, captureAnchor, setAnchorCapture, nextModelSequence, currentModelSequence,
  };
}

export type State = ReturnType<typeof createState>;
