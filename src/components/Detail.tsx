/* Detail panel: reads the store, looks up facts about the selection and renders the matching view from DetailViews. */
import { Show, createSignal } from 'solid-js';
import { TraceControl } from './FocusControls';
import { HintHeading } from './controls';
import { WhatIfBadge, editField } from './whatIfParts';
import {
  DetailPanelView, EdgeDetailView, EventDetailView, FieldDetailView, FormDetailView, FormDisplayLogicDetailView,
  GhostDetailView, GroupDetailView, InstanceDetailView, LogicSourceDetailView, UndefinedFieldsDetailView,
} from './DetailViews';
import type { Element as SolidElement } from 'solid-js';
import { findNode, neighbors, isRepeatingInstance, formIsRepeating, nodeInfo } from '../lib/graph';
import { classifyDetail } from '../lib/detailKind';
import type { DetailFacts } from '../lib/detailKind';
import { resolveExploreTarget } from '../lib/exploreTarget';
import type { ExploreContext } from '../lib/exploreTarget';
import { groupIdFor, parseSelection } from '../lib/selection';
import type { Edge, EventDef, Field, Form, FormNode, FormPair, LogicNode, Model, NeighborDir, View, ViewEdge, ViewNode } from '../lib/types';
import {
  need, model, view, opts, selection, setExplore, expanded,
  currentExploration, exploreVisible, instanceMode, formLabel, expandRef, collapseRef, toggleExpandForm, toggleExpandEvent, expandedEvents, jumpToField, focusing,
} from '../store';

const { setFocus, setPair } = focusing;
const { level, selected, selectedEdge, setSelectedEdge, setSelected, setLevel } = selection;

const isDefinedVariable = (variable: string): boolean => need(model()).byVar.has(variable);

function repEvents(parsed: Model['parsed'], fm: { id: string }): string {
  const evs = (parsed.repeatingInstruments || []).filter((r) => r.form === fm.id).map((r) => r.event);
  return [...new Set(evs)].map((id) => ((parsed.events || []).find((e) => e.id === id) || { label: id }).label).join(', ');
}

function exploreButton(m: Model, t: string, dir: NeighborDir, label: string, tip: string) {
  const ex = currentExploration();
  const vis = ex ? exploreVisible(ex) : new Set<string>();
  const nb = neighbors(m, need(opts()), t, dir);
  const open = !!(ex && ex.exp.some((x) => x.node === t && x.dir === dir));
  const fresh = nb.filter((x) => !vis.has(x)).length;
  return (
    <button class={open ? 'btn sm primary' : 'btn sm'} title={tip} disabled={!nb.length && !open} onClick={() => (open ? collapseRef(t, dir) : expandRef(t, dir))}>
      {label} ({open ? nb.length : fresh})
    </button>
  );
}

/** The Instances view's non-field nodes (the ones the explore buttons can target). */
function viewInstanceNodes(v: View | null): ViewNode[] {
  if (!v) return [];
  return [...(v.nodes || []), ...(v.expandedNodes || [])].filter((x) => !x.field);
}

/** The Instances-view node with this id, when the view is in instance mode and has it. */
function instanceNodeFor(id: string): ViewNode | undefined {
  const v = view();
  if (!v || !(v.instances || v.level === 'event')) return undefined;
  const node = viewInstanceNodes(v).find((x) => x.id === id);
  // at event level the event nodes have no `event`; only the form nodes drawn inside an expanded event do
  return node && node.form && (v.instances || node.event) ? node : undefined;
}

function exploreContext(): ExploreContext {
  const m = need(model());
  const instanceModeOn = instanceMode();
  return {
    level: level(),
    instanceMode: instanceModeOn,
    isFormId: (id) => m.formsById.has(id),
    formOf: (id) => findNode(m, id)?.form,
    instanceNodes: instanceModeOn ? viewInstanceNodes(view()) : [],
  };
}

/** The 'whole form' checkbox as shown when the selection already is a whole form: ticked and fixed, so every Expand row looks the same. */
function ExploreHeading() {
  return <HintHeading title="Add to graph" hint="Adds this node's direct links to the current graph. A highlighted button is on; click it again to remove what it added." />;
}

function WholeFormLocked() {
  return <label class="chk" title="This selection is already a whole form"><input type="checkbox" checked disabled /> for the whole form</label>;
}

const [wholeForm, setWholeForm] = createSignal(false);
const onWholeFormChange = function onWholeFormChange(event: Event & { currentTarget: HTMLInputElement }): void {
  setWholeForm(event.currentTarget.checked);
};

/** The explore buttons for the selected id. Rendered reactively, so it follows level, mode and explore state. */
function ExploreRow(props: { id: string }) {
  const renderExploreRow = (): SolidElement => {
    const plan = resolveExploreTarget(exploreContext(), props.id);
    if (plan.kind === 'none') return '';
    if (plan.kind === 'hint') return <div class="muted small" style="margin:6px 0">{plan.message}</div>;
    const m = need(model());
    const btn = (dir: NeighborDir, label: string, tip: string) => exploreButton(m, plan.target, dir, label, tip);
    if (plan.kind === 'instance') {
      return (
        <div class="exrow"><ExploreHeading />{btn('up', '▲ depends on', 'Add the instances this one depends on')}{btn('down', '▼ used by', 'Add the instances that depend on this one')}
          <WholeFormLocked />
          {plan.appliesTo ? <div class="muted small" style="width:100%">applies to the instance node {plan.appliesTo}</div> : ''}</div>
      );
    }
    const formMode = plan.isGroup || (plan.wholeFormId !== null && wholeForm());
    return (
      <div class="exrow">
        <ExploreHeading />
        {formMode
          ? <>{btn('fup', '▲ depends on', 'Add every field in other forms that this form depends on (with the fields in this form they feed)')}{btn('fdown', '▼ used by', 'Add every field in other forms that depends on this form (with the fields in this form they use)')}</>
          : <>{btn('up', '▲ depends on', 'Add what this depends on')}{btn('down', '▼ used by', 'Add what depends on this')}</>}
        {plan.wholeFormId && !plan.isGroup
          ? <label class="chk" title={'Expand from every field in ' + formLabel(plan.wholeFormId)}><input type="checkbox" checked={wholeForm()} onChange={onWholeFormChange} /> for the whole form</label>
          : <WholeFormLocked />}
        {plan.appliesTo ? <div class="muted small" style="width:100%">applies to its form: {formLabel(plan.appliesTo)}</div> : ''}
      </div>
    );
  };
  return <>{renderExploreRow}</>;
}

// a form box (cluster) clicked in the field-level graph
function groupDetail(formId: string) {
  const m = need(model()), fm = m.formsById.get(formId), o = need(opts());
  const linked = new Set<string>();
  m.edges.forEach((e) => { if (o.types.has(e.type) && (o.showMissing || !e.missing)) { linked.add(e.from); linked.add(e.to); } });
  const inForm = fm ? fm.fields.filter((v) => linked.has(v)) : [];
  const seeds = [groupIdFor(formId), ...(inForm.length ? inForm : fm ? fm.fields : [])];
  const focusForm = function focusForm(): void { setPair(null); setFocus(''); setExplore({ level: 'field', seeds, exp: [] }); };
  return (
    <GroupDetailView
      label={fm ? fm.label : formId}
      formId={formId}
      fieldCount={fm ? fm.fields.length : 0}
      linkedFieldCount={inForm.length}
      onFocusForm={focusForm}
      explore={<ExploreRow id={groupIdFor(formId)} />}
    />
  );
}

function undefinedFieldsDetail(id: string) {
  return <UndefinedFieldsDetailView explore={<ExploreRow id={id} />} />;
}

// a form (not a field) clicked in the field-level graph
function formDetail(fm: Form) {
  const m = need(model()), id = fm.id;
  const cross = m.edges.filter((e) => !e.missing && e.type !== 'logicsrc' && (nodeInfo(m, e.from).form === id) !== (nodeInfo(m, e.to).form === id));
  const repeatingIn = repEvents(m.parsed, fm);
  return (
    <FormDetailView
      label={fm.label}
      formId={fm.id}
      fieldCount={fm.fields.length}
      repeatingNote={formIsRepeating(m.parsed, fm) ? ' · repeating' + (repeatingIn ? ' in ' + repeatingIn : '') : ''}
      canZoom={!instanceMode()}
      zoomLabel={expanded().has(id) ? 'back to form' : 'into fields'}
      onToggleZoom={() => toggleExpandForm(id)}
      crossFormEdges={cross}
      onOpen={setSelected}
      explore={<ExploreRow id={id} />}
      trace={<TraceControl id={id} what="form" />}
    />
  );
}

function formDisplayLogicDetail(info: FormNode, exploreId: string) {
  return (
    <FormDisplayLogicDetailView
      label={info.label}
      logic={info.logic}
      logicEvents={info.logicEvents}
      isDefined={isDefinedVariable}
      onSelect={setSelected}
      explore={<ExploreRow id={exploreId} />}
    />
  );
}

function logicSourceDetail(info: LogicNode, id: string, exploreId: string) {
  const reads = need(model()).analysis.inn.get(id) ?? [];
  return (
    <LogicSourceDetailView
      label={info.label}
      kind={info.kind}
      logic={info.logic}
      reads={reads.map((e) => ({ id: e.from, t: e.type }))}
      isDefined={isDefinedVariable}
      onSelect={setSelected}
      explore={<ExploreRow id={exploreId} />}
    />
  );
}

function ghostDetail(id: string, exploreId: string) {
  const usedBy = (need(model()).analysis.out.get(id) ?? []).map((e) => ({ id: e.to, t: e.type }));
  return <GhostDetailView id={id} usedBy={usedBy} onSelect={setSelected} explore={<ExploreRow id={exploreId} />} />;
}

const openWhatIf = function openWhatIf(variable: string): void {
  editField(variable);
  selection.setTab('whatif');
};

function fieldDetail(f: Field, id: string, exploreId: string) {
  const A = need(model()).analysis;
  const up = (A.inn.get(id) ?? []).map((e) => ({ id: e.from, t: e.type }));
  const down = (A.out.get(id) ?? []).map((e) => ({ id: e.to, t: e.type }));
  return (
    <FieldDetailView
      field={f}
      formLabel={formLabel(f.form)}
      dependsOn={up}
      usedBy={down}
      isDefined={isDefinedVariable}
      onSelect={setSelected}
      onOpenWhatIf={() => openWhatIf(f.variable)}
      whatIfBadge={<WhatIfBadge variable={f.variable} />}
      explore={<ExploreRow id={exploreId} />}
      trace={<TraceControl id={id} what="field" />}
    />
  );
}

function eventLabel(events: EventDef[], eventId: string | null | undefined): string {
  const event = events.find((x) => x.id === eventId);
  return event ? event.label : eventId || '';
}

function instanceNodeFormLabel(model: Model, node: { form: string; id: string }): string {
  const form = model.formsById.get(node.form);
  return form ? form.label : node.form || node.id;
}

function instanceNodeLabel(model: Model, nodes: ViewNode[], nodeId: string): string {
  const node = nodes.find((y) => y.id === nodeId);
  if (node && node.event === undefined) return node.label; // an event node of the event-level graph
  return node ? (instanceNodeFormLabel(model, node) + (node.event ? ' @ ' + eventLabel(model.parsed.events || [], node.event) : '')) : nodeId;
}

/** A node of the Instances view: a form@event node, or a plain form id when the form is in one event. */
function instanceDetail(node: ViewNode) {
  const v = need(view()), m = need(model());
  const nodes = viewInstanceNodes(v);
  const id = node.id;
  const fm = m.formsById.get(node.form), evs = m.parsed.events || [];
  const others = nodes.filter((x) => x.form === node.form && x.id !== node.id);
  const ie: ViewEdge[] = v.instEdges || v.edges || [];
  const inn = ie.filter((e) => e.to === id && e.from !== id);
  const out = ie.filter((e) => e.from === id && e.to !== id);
  return (
    <InstanceDetailView
      title={(fm ? fm.label : node.form) + (node.event ? ' @ ' + eventLabel(evs, node.event) : '')}
      formId={node.form}
      eventId={node.event || undefined}
      fieldCount={fm ? fm.fields.length : null}
      repeating={!!(fm && (node.event ? isRepeatingInstance(m.parsed, fm, node.event) : fm.repeating))}
      zoomLabel={expanded().has(id) ? 'back to form' : 'into fields'}
      onToggleZoom={() => toggleExpandForm(id)}
      alsoIn={others.map((x) => ({ id: x.id, label: eventLabel(evs, x.event) }))}
      incoming={inn.map((e) => ({ edge: e, other: e.from, label: instanceNodeLabel(m, nodes, e.from) }))}
      outgoing={out.map((e) => ({ edge: e, other: e.to, label: instanceNodeLabel(m, nodes, e.to) }))}
      onSelect={setSelected}
      explore={<ExploreRow id={id} />}
    />
  );
}

// an event box clicked in the event-level graph
function eventDetail(ev: EventDef) {
  const m = need(model());
  const out = m.edges.filter((e) => (e.events || []).includes(ev.id));
  const inn = m.edges.filter((e) =>
    m.parsed.events.some((x) => x.forms.includes(nodeInfo(m, e.to).form) && x.id === ev.id) && (e.events || []).some((x) => x !== ev.id));
  const repInstr = (m.parsed.repeatingInstruments || []).filter((r) => r.event === ev.id);
  return (
    <EventDetailView
      event={ev}
      formLabels={ev.forms.map(formLabel)}
      canZoom={level() === 'event'}
      zoomLabel={expandedEvents().has(ev.id) ? 'back to event' : 'into forms'}
      onToggleZoom={() => toggleExpandEvent(ev.id)}
      repeatingInstruments={repInstr.map((r) => r.label || formLabel(r.form))}
      readFromEvent={out}
      readsOtherEvents={inn}
      onOpen={jumpToField}
      trace={<TraceControl id={ev.id} what="event" />}
    />
  );
}

// form-level edge: the fields that make up the link
function edgeDetail(ed: FormPair) {
  const m = need(model()), o = need(opts());
  const fl = (id: string): string => (id === '(unknown)' ? 'Undefined fields' : formLabel(id));
  const es = m.edges.filter((e) =>
    o.types.has(e.type) && (o.showMissing || !e.missing) && nodeInfo(m, e.from).form === ed.from && nodeInfo(m, e.to).form === ed.to);
  const byDep = new Map<string, Edge[]>();
  es.forEach((e) => {
    if (!byDep.has(e.to)) byDep.set(e.to, []);
    (byDep.get(e.to) as Edge[]).push(e);
  });
  const showFields = function showFields(): void { setLevel('field'); setFocus(''); setPair({ from: ed.from, to: ed.to }); setSelectedEdge(null); };
  return (
    <EdgeDetailView
      fromLabel={fl(ed.from)}
      toLabel={fl(ed.to)}
      sourceCount={new Set(es.map((e) => e.from)).size}
      dependents={[...byDep.entries()].map(([dependent, edges]) => ({ dependent, edges }))}
      dependencyCount={es.length}
      onShowFields={showFields}
      onSelect={setSelected}
    />
  );
}

/** Facts about one id for the classifier: its model node, Instances node, event and form. */
function lookUpDetailFacts(id: string): DetailFacts {
  const m = need(model());
  const node = findNode(m, id);
  return {
    node,
    instanceNode: node || !(instanceMode() || level() === 'event') ? undefined : instanceNodeFor(id),
    event: (m.parsed.events || []).find((x) => x.id === id),
    form: m.formsById.get(id),
  };
}

function detailContent(selectedId: string): SolidElement {
  const classified = classifyDetail(parseSelection(selectedId), lookUpDetailFacts);
  if (classified.kind === 'group') return groupDetail(classified.formId);
  const { id, instanceId, facts } = classified;
  // an instance-expanded field explores its instance; otherwise the node itself
  const exploreId = instanceId || id;
  switch (classified.kind) {
    case 'instance': return instanceDetail(need(facts.instanceNode));
    case 'undefinedFields': return undefinedFieldsDetail(id);
    case 'event': return eventDetail(need(facts.event));
    case 'form': return formDetail(need(facts.form));
    case 'formDisplayLogic': return formDisplayLogicDetail(facts.node as FormNode, exploreId);
    case 'logicSource': return logicSourceDetail(facts.node as LogicNode, id, exploreId);
    case 'ghost': return ghostDetail(id, exploreId);
    case 'field': return fieldDetail(facts.node as Field, id, exploreId);
    case 'none': return '';
  }
}

export default function Detail() {
  const closeDetail = function closeDetail(): void { setSelected(null); setSelectedEdge(null); };
  return (
    <Show when={selected() || selectedEdge()}>
      <DetailPanelView onClose={closeDetail}>
        {selectedEdge() ? edgeDetail(selectedEdge() as FormPair) : selected() ? detailContent(selected() as string) : ''}
      </DetailPanelView>
    </Show>
  );
}
