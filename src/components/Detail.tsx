/* Detail panel: logic code, explore buttons, form / instance / event / edge summaries. */
import { Show, createSignal } from 'solid-js';
import { TraceControl } from './FocusControls';
import { HintHeading } from './controls';
import type { Element as SolidElement } from 'solid-js';
import { TYPES, findNode, neighbors, isRepeatingInstance, formIsRepeating, nodeInfo } from '../lib/graph';
import { classifyDetail } from '../lib/detailKind';
import type { DetailFacts } from '../lib/detailKind';
import { resolveExploreTarget } from '../lib/exploreTarget';
import type { ExploreContext } from '../lib/exploreTarget';
import { groupIdFor, parseSelection } from '../lib/selection';
import type { DepType, Edge, EventDef, Field, Form, FormNode, FormPair, LogicNode, Model, NeighborDir, View, ViewEdge, ViewNode } from '../lib/types';
import {
  need, model, view, opts, selection, setExplore, expanded,
  currentExploration, exploreVisible, instanceMode, formLabel, expandRef, collapseRef, toggleExpandForm, jumpToField, focusing,
} from '../store';

const { setFocus, setPair } = focusing;
const { level, selected, selectedEdge, setSelectedEdge, setSelected, setLevel } = selection;

const TOKEN_RE = /(\[[A-Za-z][A-Za-z0-9_]*(?:\([^)\]]*\))?(?::[A-Za-z0-9_]+)?\])/;

function repEvents(parsed: Model['parsed'], fm: { id: string }): string {
  const evs = (parsed.repeatingInstruments || []).filter((r) => r.form === fm.id).map((r) => r.event);
  return [...new Set(evs)].map((id) => ((parsed.events || []).find((e) => e.id === id) || { label: id }).label).join(', ');
}

export function Tag(props: { type: DepType }) {
  return <span class="tag" style={`background:${TYPES[props.type].color}`}>{props.type}</span>;
}

/** Logic code with clickable [variable] references (red when undefined). */
function CodeBlock(props: { title: string; text: string | undefined; copyable?: boolean }) {
  const nodes = () => (props.text ?? '').split(TOKEN_RE).map((p) => {
    const m = /^\[([A-Za-z][A-Za-z0-9_]*)/.exec(p);
    if (!m || p[0] !== '[') return p;
    const ok = need(model()).byVar.has(m[1]);
    return ok
      ? <span class="ref" style="cursor:pointer" onClick={() => setSelected(m[1])}>{p}</span>
      : <span class="ref bad">{p}</span>;
  });
  return (
    <Show when={props.text}>
      <div><h4>{props.title} {props.copyable ? <button class="link" onClick={(e) => {
        navigator.clipboard?.writeText(props.text ?? '');
        e.currentTarget.textContent = 'copied';
      }}>copy</button> : ''}</h4><pre>{nodes()}</pre></div>
    </Show>
  );
}

/** A titled block: an h4 with an optional count, then the body, or 'none' when it is empty. */
function Section(props: { title: string; count?: number; empty: boolean; children: SolidElement }) {
  return (
    <>
      <h4>{props.title}{props.count === undefined ? '' : ` (${props.count})`}</h4>
      {props.empty ? <span class="muted small">none</span> : props.children}
    </>
  );
}

function ChipList(props: { items: { id: string; t: string }[] }) {
  return <div class="chips">{props.items.map((x) => <button class="chip" title={x.t} onClick={() => setSelected(x.id)}>{x.id}</button>)}</div>;
}

/** One dependency edge as `from → to`, with its type tag and expression; `detail` adds trailing text. */
function EdgeRow(props: { edge: Edge; onOpen: (id: string) => void; detail?: SolidElement }) {
  return (
    <div class="small" style="margin-bottom:6px">
      <button class="fieldlink" onClick={() => props.onOpen(props.edge.from)}>{props.edge.from}</button> → <button class="fieldlink" onClick={() => props.onOpen(props.edge.to)}>{props.edge.to}</button> <Tag type={props.edge.type} /> {props.detail}
      <pre>{props.edge.expr}</pre>
    </div>
  );
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
  if (!v || !v.instances) return undefined;
  const node = viewInstanceNodes(v).find((x) => x.id === id);
  return node && node.form ? node : undefined;
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
  const label = fm ? fm.label : formId;
  const linked = new Set<string>();
  m.edges.forEach((e) => { if (o.types.has(e.type) && (o.showMissing || !e.missing)) { linked.add(e.from); linked.add(e.to); } });
  const inForm = fm ? fm.fields.filter((v) => linked.has(v)) : [];
  const seeds = [groupIdFor(formId), ...(inForm.length ? inForm : fm ? fm.fields : [])];
  return (
    <div><h3>{label}</h3><div class="muted small">form <code>{formId}</code> · {fm ? fm.fields.length : 0} fields · {inForm.length} with dependencies</div>
      <ExploreRow id={groupIdFor(formId)} />
      <div class="focus-box"><HintHeading title="Focus" hint="Shows only this form's linked fields. Then use Add to graph to bring in what it depends on or what uses it, or select any node to add its links individually." />
        <span class="seg"><button class="btn sm" title="Show only this form's linked fields" onClick={() => { setPair(null); setFocus(''); setExplore({ level: 'field', seeds, exp: [] }); }}>this form</button></span></div>
</div>
  );
}

function undefinedFieldsDetail(id: string) {
  return <div><h3>Undefined fields</h3><div class="muted small">fields referenced by logic but not defined in the project</div><ExploreRow id={id} /></div>;
}

// a form (not a field) clicked in the field-level graph
function formDetail(fm: Form) {
  const m = need(model()), id = fm.id;
  const cross = m.edges.filter((e) => !e.missing && e.type !== 'logicsrc' && (nodeInfo(m, e.from).form === id) !== (nodeInfo(m, e.to).form === id));
  const repeatingIn = repEvents(m.parsed, fm);
  return (
    <div><h3>{fm.label}</h3><div class="muted small">form <code>{fm.id}</code> · {fm.fields.length} fields{formIsRepeating(m.parsed, fm) ? ' · repeating' + (repeatingIn ? ' in ' + repeatingIn : '') : ''}</div>
      <ExploreRow id={id} />
      {instanceMode() ? '' : <div class="focus-box"><HintHeading title="Zoom" hint="Shows this form's fields inside the graph." />
        <span class="seg"><button class="btn sm" onClick={() => toggleExpandForm(id)}>{expanded().has(id) ? 'back to form' : 'into fields'}</button></span></div>}
      <Section title="Cross-form dependencies" count={cross.length} empty={!cross.length}>
        {cross.map((e) => <EdgeRow edge={e} onOpen={(x) => setSelected(x)} />)}
      </Section></div>
  );
}

function formDisplayLogicDetail(info: FormNode, exploreId: string) {
  return (
    <div><h3>Form: {info.label}</h3><div class="muted small">form display logic target</div><ExploreRow id={exploreId} />{info.logic.map((l, i) => <>
      <CodeBlock title="Display condition" text={l} copyable={true} /><div class="muted small" style="margin:-2px 0 8px">Applies in event{(info.logicEvents[i] || []).length === 1 ? '' : 's'}: {(info.logicEvents[i] || []).length ? (info.logicEvents[i]).map((ev) => <><code>{ev}</code> </>) : 'all events'}</div></>)}</div>
  );
}

function logicSourceDetail(info: LogicNode, id: string, exploreId: string) {
  const reads = need(model()).analysis.inn.get(id) ?? [];
  return (
    <div><h3>{info.label}</h3><div class="muted small">logic source · <code>{info.kind}</code></div><ExploreRow id={exploreId} />
      <CodeBlock title="Logic" text={info.logic} copyable={true} />
      <Section title="Reads fields" count={reads.length} empty={!reads.length}>
        <ChipList items={reads.map((e) => ({ id: e.from, t: e.type }))} />
      </Section></div>
  );
}

function ghostDetail(id: string, exploreId: string) {
  const usedBy = (need(model()).analysis.out.get(id) ?? []).map((e) => ({ id: e.to, t: e.type }));
  return (
    <div><h3>{id}</h3><div class="muted small">Referenced but not defined in this project</div><ExploreRow id={exploreId} />
      <Section title="Used by" empty={!usedBy.length}><ChipList items={usedBy} /></Section></div>
  );
}

function fieldDetail(f: Field, id: string, exploreId: string) {
  const A = need(model()).analysis;
  const up = (A.inn.get(id) ?? []).map((e) => ({ id: e.from, t: e.type }));
  const down = (A.out.get(id) ?? []).map((e) => ({ id: e.to, t: e.type }));
  return (
    <div>
      <h3>{f.variable}</h3>
      <div class="muted small">{f.type} · form <b>{formLabel(f.form)}</b>{f.required ? ' · required' : ''}</div>
      {f.label ? <p style="margin:6px 0">{f.label}</p> : ''}
      {f.media && (f.media.inlineImage || f.media.videoUrl) ? <div class="muted small" style="margin:6px 0">Media: {[f.media.inlineImage ? 'inline image ' + f.media.inlineImage : '', f.media.videoUrl ? 'video ' + f.media.videoUrl + (f.media.videoInline ? ' (inline)' : '') : ''].filter(Boolean).join(' · ')}</div> : ''}
      <ExploreRow id={exploreId} />
      <TraceControl id={id} />
      <CodeBlock title="Branching logic" text={f.branching} copyable={true} /><CodeBlock title="Calculation" text={f.calc} copyable={true} /><CodeBlock title="Action tags / annotation" text={f.annotation} copyable={true} />
      <CodeBlock title="Section header (piping [x] or embedding {x})" text={f.section} /><CodeBlock title="Field note (piping [x] or embedding {x})" text={f.note} />
      {!f.branching && !f.calc && !f.annotation ? <p class="muted small">No logic code on this field.</p> : ''}
      {f.choices.length ? <div><h4>Choices</h4><pre>{f.choices.map((c) => c.code + ', ' + c.label).join('\n')}</pre></div> : ''}
      <Section title="Depends on" count={up.length} empty={!up.length}><ChipList items={up} /></Section>
      <Section title="Used by" count={down.length} empty={!down.length}><ChipList items={down} /></Section></div>
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
  return node ? (instanceNodeFormLabel(model, node) + (node.event ? ' @ ' + eventLabel(model.parsed.events || [], node.event) : '')) : nodeId;
}

function EdgeFlags(props: { edge: ViewEdge }) {
  return (['cross', 'mismatch', 'relative', 'crossArm'] as const)
    .filter((k) => props.edge[k])
    .map((k) => <><span class="tag" style="background:#6b7280">{k === 'crossArm' ? 'cross-arm' : k}</span> </>);
}

function InstanceEdgeRow(props: { edge: ViewEdge; other: string; label: string }) {
  return (
    <div class="small" style="margin-bottom:4px"><button class="fieldlink" onClick={() => setSelected(props.other)}>{props.label}</button> <EdgeFlags edge={props.edge} /></div>
  );
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
    <div><h3>{fm ? fm.label : node.form}{node.event ? ' @ ' + eventLabel(evs, node.event) : ''}</h3>
      <div class="muted small">form <code>{node.form}</code>{node.event ? <> · event <code>{node.event}</code></> : ''}{fm ? ' · ' + fm.fields.length + ' fields' : ''}{fm && (node.event ? isRepeatingInstance(m.parsed, fm, node.event) : fm.repeating) ? ' · repeating' : ''}</div>
      <ExploreRow id={id} />
      <div class="focus-box"><HintHeading title="Zoom" hint="Shows this form's fields inside the graph." />
        <span class="seg"><button class="btn sm" onClick={() => toggleExpandForm(id)}>{expanded().has(id) ? 'back to form' : 'into fields'}</button></span></div>
      {others.length ? <><h4>Also collected in ({others.length})</h4><div class="chips">{others.map((x) => <button class="chip" onClick={() => setSelected(x.id)}>{eventLabel(evs, x.event)}</button>)}</div></> : ''}
      <Section title="Incoming from other instances" count={inn.length} empty={!inn.length}>
        {inn.map((e) => <InstanceEdgeRow edge={e} other={e.from} label={instanceNodeLabel(m, nodes, e.from)} />)}
      </Section>
      <Section title="Outgoing to other instances" count={out.length} empty={!out.length}>
        {out.map((e) => <InstanceEdgeRow edge={e} other={e.to} label={instanceNodeLabel(m, nodes, e.to)} />)}
      </Section></div>
  );
}

// an event box clicked in the event-level graph
function eventDetail(ev: EventDef) {
  const m = need(model());
  const out = m.edges.filter((e) => (e.events || []).includes(ev.id));
  const inn = m.edges.filter((e) =>
    m.parsed.events.some((x) => x.forms.includes(nodeInfo(m, e.to).form) && x.id === ev.id) && (e.events || []).some((x) => x !== ev.id));
  const repInstr = (m.parsed.repeatingInstruments || []).filter((r) => r.event === ev.id);
  const eventsOf = (e: Edge) => <span class="muted">{(e.events || []).join(', ')}</span>;
  return (
    <div><h3>{ev.label}</h3><div class="muted small">event <code>{ev.id}</code>{ev.arm ? ' · arm ' + ev.arm + (ev.armName ? ' (' + ev.armName + ')' : '') : ''}{ev.repeating ? ' · repeating' : ''}</div>
      <p class="small" style="margin:6px 0">Forms: {ev.forms.map(formLabel).join(', ') || 'none'}</p>
      {repInstr.length ? <p class="small" style="margin:6px 0">Repeating instruments: {repInstr.map((r) => r.label || formLabel(r.form)).join(', ')}</p> : ''}
      <Section title="Read from this event" count={out.length} empty={!out.length}>
        {out.map((e) => <EdgeRow edge={e} onOpen={(x) => jumpToField(x)} detail={eventsOf(e)} />)}
      </Section>
      <Section title="Reads other events" count={inn.length} empty={!inn.length}>
        {inn.map((e) => <EdgeRow edge={e} onOpen={(x) => jumpToField(x)} detail={eventsOf(e)} />)}
      </Section></div>
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
  const srcs = new Set(es.map((e) => e.from));
  return (
    <div>
      <h3>{fl(ed.from)} → {fl(ed.to)}</h3>
      <div class="muted small">{srcs.size} source field{srcs.size === 1 ? '' : 's'} · {byDep.size} dependent field{byDep.size === 1 ? '' : 's'} · {es.length} dependenc{es.length === 1 ? 'y' : 'ies'}</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick={() => { setLevel('field'); setFocus(''); setPair({ from: ed.from, to: ed.to }); setSelectedEdge(null); }}>Show these fields in the field graph</button></p>
      {[...byDep.entries()].map(([dep, list]) => <div style="margin-bottom:10px">
        <button class="fieldlink" style="font-weight:600" onClick={() => setSelected(dep)}>{dep}</button>
        <span class="muted small"> depends on </span>
        {list.map((e) => <div class="small" style="margin:3px 0"><Tag type={e.type} /> <button class="fieldlink" onClick={() => setSelected(e.from)}>{e.from}</button><pre>{e.expr}</pre></div>)}
      </div>)}
    </div>
  );
}

/** Facts about one id for the classifier: its model node, Instances node, event and form. */
function lookUpDetailFacts(id: string): DetailFacts {
  const m = need(model());
  const node = findNode(m, id);
  return {
    node,
    instanceNode: node || !instanceMode() ? undefined : instanceNodeFor(id),
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
  return (
    <Show when={selected() || selectedEdge()}>
      <aside id="detail">
        <button class="link" style="float:right" onClick={() => { setSelected(null); setSelectedEdge(null); }}>✕ close</button>
        {selectedEdge() ? edgeDetail(selectedEdge() as FormPair) : selected() ? detailContent(selected() as string) : ''}
      </aside>
    </Show>
  );
}
