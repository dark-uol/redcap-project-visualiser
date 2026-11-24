/* Signals and setters for the application state, plus the anchor-capture hook and the file sequence number. */
import { createSignal } from 'solid-js';
import { allTypesOn, clampDepth, DEFAULT_DIRECTION, DEFAULT_RENDERER } from './common';
import type { AnchorCapture, Tab } from './common';
import { ANY_EVENT } from '../lib/whatIf';
import type { WhatIfValue } from '../lib/whatIf';
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
  const [renderer, setRenderer] = createSignal<Renderer>(DEFAULT_RENDERER);
  const [dir, setDir] = createSignal<Direction>(DEFAULT_DIRECTION);
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
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set()); // form ids (or `form@event` ids) expanded into fields, at form and event level
  const [expandedEvents, setExpandedEvents] = createSignal<Set<string>>(new Set()); // event ids expanded in place at event level
  const [explore, setExplore] = createSignal<Explore | null>(null); // interactive expansion

  // Filter signals, grouped so the sidebar and the filtered view read them from one place
  // Filters re-lay the graph out, so the setters the sidebar uses snapshot it first (captureAnchor('') animates the change).
  // `rawFilters` skips that; loading a file uses it, since the old graph is not what the new one should animate from.
  const animated = <T,>(setter: (value: T) => unknown) => (value: T): void => { captureAnchor(''); setter(value); };
  const rawFilters = { setTypesOn, setFormsOn, setEventsOn, setCrossOnly, setInstanceOnly, setFormQ };
  const filters = {
    typesOn, setTypesOn: animated(setTypesOn), formsOn, setFormsOn: animated(setFormsOn), eventsOn, setEventsOn: animated(setEventsOn),
    crossOnly, setCrossOnly: animated(setCrossOnly), instanceOnly, setInstanceOnly: animated(setInstanceOnly),
    hideIso, setHideIso: animated(setHideIso), hideIsoNodes, setHideIsoNodes: animated(setHideIsoNodes),
    showMissing, setShowMissing: animated(setShowMissing), formQ, setFormQ,
  };

  // Focus and presentation signals, grouped the same way as filters
  const focusing = { focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, pair, setPair };
  const presentation = { dir, setDir, labelMode, setLabelMode, groupBy, setGroupBy, edgeLabels, setEdgeLabels, renderer, setRenderer };

  // What-if values: picked field values, and the context they are evaluated in
  const [whatIfValues, setWhatIfValues] = createSignal<Record<string, Record<string, WhatIfValue>>>({});
  const [whatIfMode, setWhatIfMode] = createSignal<'survey' | 'form'>('form');
  const [whatIfEvent, setWhatIfEvent] = createSignal<string | null>(null);
  const [whatIfField, setWhatIfField] = createSignal<string | null>(null); // variable being edited in the What if tab
  // Writes into the bucket of an event (ANY_EVENT when null), dropping buckets that become empty
  const setWhatIfValueIn = function setWhatIfValueIn(event: string | null, variable: string, value: WhatIfValue | null): void {
    const key = event ?? ANY_EVENT;
    const next = { ...whatIfValues() };
    const bucket = { ...next[key] };
    if (value === null || value === '' || (Array.isArray(value) && !value.length)) delete bucket[variable];
    else bucket[variable] = value;
    if (Object.keys(bucket).length) next[key] = bucket;
    else delete next[key];
    setWhatIfValues(next);
  };
  const clearWhatIfValues = function clearWhatIfValues(): void { setWhatIfValues({}); };
  const whatIfValueCount = function whatIfValueCount(): number {
    return Object.values(whatIfValues()).reduce((total, bucket) => total + Object.keys(bucket).length, 0);
  };
  const whatIf = {
    values: whatIfValues, valueCount: whatIfValueCount, setValueIn: setWhatIfValueIn, clearValues: clearWhatIfValues,
    mode: whatIfMode, setMode: setWhatIfMode, event: whatIfEvent, setEvent: setWhatIfEvent,
    field: whatIfField, setField: setWhatIfField,
  };

  const [tab, setTab] = createSignal<Tab>('graph');
  const [downloadMenuOpen, setDownloadMenuOpen] = createSignal(false);
  // setSelectedKeepingEdge sets the selection without clearing selectedEdge; setSelected also clears selectedEdge.
  const [selected, setSelectedKeepingEdge] = createSignal<string | null>(null);
  const setSelected = (v: string | null): void => { if (v) setSelectedEdge(null); setSelectedKeepingEdge(v); };

  // selection signals, grouped the same way as filters
  const selection = { selected, setSelected, setSelectedKeepingEdge, selectedEdge, setSelectedEdge, tab, setTab, level, setLevel };
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
    focusing, presentation, selection, whatIf,
    instances, setInstances: animated(setInstances), rawSetInstances: setInstances, filters, rawFilters,
    expanded, setExpanded, expandedEvents, setExpandedEvents, explore, setExplore, downloadMenuOpen, setDownloadMenuOpen,
    depQ, setDepQ, fieldQ, setFieldQ, svgEl, setSvgEl, svgView, setSvgView, busy, setBusy, renderMsg, setRenderMsg,
    forcedFor, setForcedFor, mxCell, setMxCell, captureAnchor, setAnchorCapture, nextModelSequence, currentModelSequence,
  };
}

export type State = ReturnType<typeof createState>;
