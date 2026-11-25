/*
 * Presentational parts of the detail panel: one view per kind of selection. They take plain data, callbacks and
 * slots for the connected widgets (explore buttons, chain trace, what-if badge), and never touch the store.
 */
import { Show } from 'solid-js';
import type { Element as SolidElement } from 'solid-js';
import type { Edge, EventDef, Field, ViewEdge } from '../lib/types';
import { HintHeading } from './controls';
import { Tag } from './Tag';

const TOKEN_RE = /(\[[A-Za-z][A-Za-z0-9_]*(?:\([^)\]]*\))?(?::[A-Za-z0-9_]+)?\])/;

/** A selectable id with a hover hint (usually the dependency type). */
export type Chip = { id: string; t: string };

/** A row of the Instances view's incoming / outgoing lists. */
export type InstanceEdgeEntry = { edge: ViewEdge; other: string; label: string };

export type CodeBlockProps = {
  title: string;
  text: string | undefined;
  copyable?: boolean;
  /** Whether a referenced variable exists in the project; unknown ones are drawn red and are not clickable. */
  isDefined: (variable: string) => boolean;
  onSelect: (variable: string) => void;
};

/** Logic code with clickable [variable] references (red when undefined). */
export function CodeBlock(props: CodeBlockProps) {
  const copy = function copy(e: MouseEvent & { currentTarget: HTMLButtonElement }): void {
    navigator.clipboard?.writeText(props.text ?? '');
    e.currentTarget.textContent = 'copied';
  };
  const nodes = () => (props.text ?? '').split(TOKEN_RE).map((part) => {
    const match = /^\[([A-Za-z][A-Za-z0-9_]*)/.exec(part);
    if (!match || part[0] !== '[') return part;
    return props.isDefined(match[1])
      ? <span class="ref" style="cursor:pointer" onClick={() => props.onSelect(match[1])}>{part}</span>
      : <span class="ref bad">{part}</span>;
  });
  return (
    <Show when={props.text}>
      <div><h4>{props.title} {props.copyable ? <button class="link" onClick={copy}>copy</button> : ''}</h4><pre>{nodes()}</pre></div>
    </Show>
  );
}

/** A titled block: an h4 with an optional count, then the body, or 'none' when it is empty. */
export function Section(props: { title: string; count?: number; empty: boolean; children: SolidElement }) {
  return (
    <>
      <h4>{props.title}{props.count === undefined ? '' : ` (${props.count})`}</h4>
      {props.empty ? <span class="muted small">none</span> : props.children}
    </>
  );
}

export function ChipList(props: { items: Chip[]; onSelect: (id: string) => void }) {
  return <div class="chips">{props.items.map((x) => <button class="chip" title={x.t} onClick={() => props.onSelect(x.id)}>{x.id}</button>)}</div>;
}

/** One dependency edge as `from → to`, with its type tag and expression; `detail` adds trailing text. */
export function EdgeRow(props: { edge: Edge; onOpen: (id: string) => void; detail?: SolidElement }) {
  return (
    <div class="small" style="margin-bottom:6px">
      <button class="fieldlink" onClick={() => props.onOpen(props.edge.from)}>{props.edge.from}</button> → <button class="fieldlink" onClick={() => props.onOpen(props.edge.to)}>{props.edge.to}</button> <Tag type={props.edge.type} /> {props.detail}
      <pre>{props.edge.expr}</pre>
    </div>
  );
}

function EdgeFlags(props: { edge: ViewEdge }) {
  return (['cross', 'mismatch', 'relative', 'crossArm'] as const)
    .filter((k) => props.edge[k])
    .map((k) => <><span class="tag" style="background:#6b7280">{k === 'crossArm' ? 'cross-arm' : k}</span> </>);
}

function InstanceEdgeRow(props: { entry: InstanceEdgeEntry; onSelect: (id: string) => void }) {
  return (
    <div class="small" style="margin-bottom:4px"><button class="fieldlink" onClick={() => props.onSelect(props.entry.other)}>{props.entry.label}</button> <EdgeFlags edge={props.entry.edge} /></div>
  );
}

/** The "Zoom" box with one toggle button. */
function ZoomBox(props: { hint: string; label: string; onToggle: () => void }) {
  return (
    <div class="focus-box"><HintHeading title="Zoom" hint={props.hint} />
      <span class="seg"><button class="btn sm" onClick={() => props.onToggle()}>{props.label}</button></span></div>
  );
}

// ---- a form box (cluster) clicked in the field-level graph ----

export type GroupDetailViewProps = {
  label: string;
  formId: string;
  fieldCount: number;
  linkedFieldCount: number;
  onFocusForm: () => void;
  explore: SolidElement;
};

export function GroupDetailView(props: GroupDetailViewProps) {
  return (
    <div><h3>{props.label}</h3><div class="muted small">form <code>{props.formId}</code> · {props.fieldCount} fields · {props.linkedFieldCount} with dependencies</div>
      {props.explore}
      <div class="focus-box"><HintHeading title="Focus" hint="Shows only this form's linked fields. Then use Add to graph to bring in what it depends on or what uses it, or select any node to add its links individually." />
        <span class="seg"><button class="btn sm" title="Show only this form's linked fields" onClick={() => props.onFocusForm()}>this form</button></span></div>
    </div>
  );
}

export function UndefinedFieldsDetailView(props: { explore: SolidElement }) {
  return <div><h3>Undefined fields</h3><div class="muted small">fields referenced by logic but not defined in the project</div>{props.explore}</div>;
}

// ---- a form (not a field) clicked in the field-level graph ----

export type FormDetailViewProps = {
  label: string;
  formId: string;
  fieldCount: number;
  /** '' for a non-repeating form, else e.g. ' · repeating in Baseline'. */
  repeatingNote: string;
  /** Whether to offer the "into fields" zoom (not in Instances mode). */
  canZoom: boolean;
  zoomLabel: string;
  onToggleZoom: () => void;
  crossFormEdges: Edge[];
  onOpen: (id: string) => void;
  explore: SolidElement;
  trace: SolidElement;
};

export function FormDetailView(props: FormDetailViewProps) {
  return (
    <div><h3>{props.label}</h3><div class="muted small">form <code>{props.formId}</code> · {props.fieldCount} fields{props.repeatingNote}</div>
      {props.explore}
      {props.canZoom ? <ZoomBox hint="Shows this form's fields inside the graph." label={props.zoomLabel} onToggle={props.onToggleZoom} /> : ''}
      {props.trace}
      <Section title="Cross-form dependencies" count={props.crossFormEdges.length} empty={!props.crossFormEdges.length}>
        {props.crossFormEdges.map((e) => <EdgeRow edge={e} onOpen={props.onOpen} />)}
      </Section></div>
  );
}

// ---- a form display logic target ----

export type FormDisplayLogicDetailViewProps = {
  label: string;
  logic: string[];
  /** For each condition in `logic`, the events it applies in (empty: all events). */
  logicEvents: string[][];
  isDefined: (variable: string) => boolean;
  onSelect: (variable: string) => void;
  explore: SolidElement;
};

export function FormDisplayLogicDetailView(props: FormDisplayLogicDetailViewProps) {
  return (
    <div><h3>Form: {props.label}</h3><div class="muted small">form display logic target</div>{props.explore}{props.logic.map((condition, i) => <>
      <CodeBlock title="Display condition" text={condition} copyable={true} isDefined={props.isDefined} onSelect={props.onSelect} /><div class="muted small" style="margin:-2px 0 8px">Applies in event{(props.logicEvents[i] || []).length === 1 ? '' : 's'}: {(props.logicEvents[i] || []).length ? (props.logicEvents[i]).map((ev) => <><code>{ev}</code> </>) : 'all events'}</div></>)}</div>
  );
}

// ---- a logic source (e.g. a form's display logic reading fields) ----

export type LogicSourceDetailViewProps = {
  label: string;
  kind: string;
  logic: string | undefined;
  reads: Chip[];
  isDefined: (variable: string) => boolean;
  onSelect: (id: string) => void;
  explore: SolidElement;
};

export function LogicSourceDetailView(props: LogicSourceDetailViewProps) {
  return (
    <div><h3>{props.label}</h3><div class="muted small">logic source · <code>{props.kind}</code></div>{props.explore}
      <CodeBlock title="Logic" text={props.logic} copyable={true} isDefined={props.isDefined} onSelect={props.onSelect} />
      <Section title="Reads fields" count={props.reads.length} empty={!props.reads.length}>
        <ChipList items={props.reads} onSelect={props.onSelect} />
      </Section></div>
  );
}

// ---- a field referenced but not defined ----

export type GhostDetailViewProps = { id: string; usedBy: Chip[]; onSelect: (id: string) => void; explore: SolidElement };

export function GhostDetailView(props: GhostDetailViewProps) {
  return (
    <div><h3>{props.id}</h3><div class="muted small">Referenced but not defined in this project</div>{props.explore}
      <Section title="Used by" empty={!props.usedBy.length}><ChipList items={props.usedBy} onSelect={props.onSelect} /></Section></div>
  );
}

// ---- a field ----

export type FieldDetailViewProps = {
  field: Field;
  formLabel: string;
  dependsOn: Chip[];
  usedBy: Chip[];
  isDefined: (variable: string) => boolean;
  onSelect: (id: string) => void;
  onOpenWhatIf: () => void;
  whatIfBadge: SolidElement;
  explore: SolidElement;
  trace: SolidElement;
};

export function FieldDetailView(props: FieldDetailViewProps) {
  const field = () => props.field;
  const codeBlock = (title: string, text: string | undefined, copyable: boolean) => (
    <CodeBlock title={title} text={text} copyable={copyable} isDefined={props.isDefined} onSelect={props.onSelect} />
  );
  return (
    <div>
      <h3>{field().variable}</h3>
      <div class="muted small">{field().type} · form <b>{props.formLabel}</b>{field().required ? ' · required' : ''}</div>
      <div class="small" style="margin:4px 0">{props.whatIfBadge} <button class="link" title="Evaluate what this field would show or hide" onClick={() => props.onOpenWhatIf()}>What if…</button></div>
      {field().label ? <p style="margin:6px 0">{field().label}</p> : ''}
      {field().media && (field().media?.inlineImage || field().media?.videoUrl) ? <div class="muted small" style="margin:6px 0">Media: {[field().media?.inlineImage ? 'inline image ' + field().media?.inlineImage : '', field().media?.videoUrl ? 'video ' + field().media?.videoUrl + (field().media?.videoInline ? ' (inline)' : '') : ''].filter(Boolean).join(' · ')}</div> : ''}
      {props.explore}
      {props.trace}
      {codeBlock('Branching logic', field().branching, true)}{codeBlock('Calculation', field().calc, true)}{codeBlock('Action tags / annotation', field().annotation, true)}
      {codeBlock('Section header (piping [x] or embedding {x})', field().section, false)}{codeBlock('Field note (piping [x] or embedding {x})', field().note, false)}
      {!field().branching && !field().calc && !field().annotation ? <p class="muted small">No logic code on this field.</p> : ''}
      {field().choices.length ? <div><h4>Choices</h4><pre>{field().choices.map((c) => c.code + ', ' + c.label).join('\n')}</pre></div> : ''}
      <Section title="Depends on" count={props.dependsOn.length} empty={!props.dependsOn.length}><ChipList items={props.dependsOn} onSelect={props.onSelect} /></Section>
      <Section title="Used by" count={props.usedBy.length} empty={!props.usedBy.length}><ChipList items={props.usedBy} onSelect={props.onSelect} /></Section></div>
  );
}

// ---- a node of the Instances view: a form@event node, or a plain form id when the form is in one event ----

export type InstanceDetailViewProps = {
  title: string;
  formId: string;
  eventId: string | undefined;
  /** The form's field count, or null when the form is unknown. */
  fieldCount: number | null;
  repeating: boolean;
  zoomLabel: string;
  onToggleZoom: () => void;
  /** The same form in other events. */
  alsoIn: { id: string; label: string }[];
  incoming: InstanceEdgeEntry[];
  outgoing: InstanceEdgeEntry[];
  onSelect: (id: string) => void;
  explore: SolidElement;
};

export function InstanceDetailView(props: InstanceDetailViewProps) {
  return (
    <div><h3>{props.title}</h3>
      <div class="muted small">form <code>{props.formId}</code>{props.eventId ? <> · event <code>{props.eventId}</code></> : ''}{props.fieldCount !== null ? ' · ' + props.fieldCount + ' fields' : ''}{props.repeating ? ' · repeating' : ''}</div>
      {props.explore}
      <ZoomBox hint="Shows this form's fields inside the graph." label={props.zoomLabel} onToggle={props.onToggleZoom} />
      {props.alsoIn.length ? <><h4>Also collected in ({props.alsoIn.length})</h4><div class="chips">{props.alsoIn.map((x) => <button class="chip" onClick={() => props.onSelect(x.id)}>{x.label}</button>)}</div></> : ''}
      <Section title="Incoming from other instances" count={props.incoming.length} empty={!props.incoming.length}>
        {props.incoming.map((entry) => <InstanceEdgeRow entry={entry} onSelect={props.onSelect} />)}
      </Section>
      <Section title="Outgoing to other instances" count={props.outgoing.length} empty={!props.outgoing.length}>
        {props.outgoing.map((entry) => <InstanceEdgeRow entry={entry} onSelect={props.onSelect} />)}
      </Section></div>
  );
}

// ---- an event box clicked in the event-level graph ----

export type EventDetailViewProps = {
  event: EventDef;
  formLabels: string[];
  /** Whether to offer the "into forms" zoom (event level only). */
  canZoom: boolean;
  zoomLabel: string;
  onToggleZoom: () => void;
  repeatingInstruments: string[];
  readFromEvent: Edge[];
  readsOtherEvents: Edge[];
  onOpen: (id: string) => void;
  trace: SolidElement;
};

export function EventDetailView(props: EventDetailViewProps) {
  const eventsOf = (e: Edge) => <span class="muted">{(e.events || []).join(', ')}</span>;
  return (
    <div><h3>{props.event.label}</h3><div class="muted small">event <code>{props.event.id}</code>{props.event.arm ? ' · arm ' + props.event.arm + (props.event.armName ? ' (' + props.event.armName + ')' : '') : ''}{props.event.repeating ? ' · repeating' : ''}</div>
      <p class="small" style="margin:6px 0">Forms: {props.formLabels.join(', ') || 'none'}</p>
      {props.canZoom ? <ZoomBox hint="Shows this event's forms inside the graph." label={props.zoomLabel} onToggle={props.onToggleZoom} /> : ''}
      {props.trace}
      {props.repeatingInstruments.length ? <p class="small" style="margin:6px 0">Repeating instruments: {props.repeatingInstruments.join(', ')}</p> : ''}
      <Section title="Read from this event" count={props.readFromEvent.length} empty={!props.readFromEvent.length}>
        {props.readFromEvent.map((e) => <EdgeRow edge={e} onOpen={props.onOpen} detail={eventsOf(e)} />)}
      </Section>
      <Section title="Reads other events" count={props.readsOtherEvents.length} empty={!props.readsOtherEvents.length}>
        {props.readsOtherEvents.map((e) => <EdgeRow edge={e} onOpen={props.onOpen} detail={eventsOf(e)} />)}
      </Section></div>
  );
}

// ---- a form-level edge: the fields that make up the link ----

export type EdgeDetailViewProps = {
  fromLabel: string;
  toLabel: string;
  sourceCount: number;
  /** The dependent fields, each with the edges that make it depend on a field of the source form. */
  dependents: { dependent: string; edges: Edge[] }[];
  dependencyCount: number;
  onShowFields: () => void;
  onSelect: (id: string) => void;
};

export function EdgeDetailView(props: EdgeDetailViewProps) {
  return (
    <div>
      <h3>{props.fromLabel} → {props.toLabel}</h3>
      <div class="muted small">{props.sourceCount} source field{props.sourceCount === 1 ? '' : 's'} · {props.dependents.length} dependent field{props.dependents.length === 1 ? '' : 's'} · {props.dependencyCount} dependenc{props.dependencyCount === 1 ? 'y' : 'ies'}</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick={() => props.onShowFields()}>Show these fields in the field graph</button></p>
      {props.dependents.map((group) => <div style="margin-bottom:10px">
        <button class="fieldlink" style="font-weight:600" onClick={() => props.onSelect(group.dependent)}>{group.dependent}</button>
        <span class="muted small"> depends on </span>
        {group.edges.map((e) => <div class="small" style="margin:3px 0"><Tag type={e.type} /> <button class="fieldlink" onClick={() => props.onSelect(e.from)}>{e.from}</button><pre>{e.expr}</pre></div>)}
      </div>)}
    </div>
  );
}

// ---- the panel around whichever detail is shown ----

export function DetailPanelView(props: { onClose: () => void; children: SolidElement }) {
  return (
    <aside id="detail">
      <button class="link" style="float:right" onClick={() => props.onClose()}>✕ close</button>
      {props.children}
    </aside>
  );
}
