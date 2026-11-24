/* What if tab: pick a field, set its value, and see which fields and forms it affects (shown, hidden, or still unknown), with inputs for whatever else is needed. */
import { For, Show, createMemo, createSignal } from 'solid-js';
import { ANY_EVENT, controllersOf, dependentsOf, eventsForField, eventsToEvaluate, isSmartKey, smartKey } from '../lib/whatIf';
import type { MissingInput, Visibility, VisibilityInfo, WhatIfValue } from '../lib/whatIf';
import type { Field } from '../lib/types';
import { need, model, selection, whatIf, visibilityIn, formLabel } from '../store';
import { STATE_ORDER, SmartValueInput, StateBadge, ValueInput, choicesFor, editField, eventLabel, missingText } from './whatIfParts';

const FORM_PREFIX = 'form:';
const MAX_MATCHES = 20;

const loadedEvents = () => need(model()).parsed.events || [];
const fieldFor = (variable: string | null): Field | undefined => (variable === null ? undefined : need(model()).byVar.get(variable));

/** `1` or `2 (Female)` for a plain value, `1, 3 (Yes, No)` for a checkbox list; the labels only when the field has choices. */
function valueText(variable: string, value: WhatIfValue): string {
  const codes = Array.isArray(value) ? value : [value];
  const field = fieldFor(variable);
  const choices = field ? choicesFor(field) : [];
  const labels = codes.map((code) => choices.find((choice) => choice.code === code)?.label);
  const plain = codes.join(', ');
  return choices.length && labels.every((label) => label !== undefined) ? plain + ' (' + labels.join(', ') + ')' : plain;
}

/** The logic that decides whether a field or form is shown, in the event it is judged in: branching logic and the action tags that can hide a field, the display rules of a form. */
function visibilityLogic(id: string, event: string | null): { main: string[]; note: string } {
  const loadedModel = need(model());
  const node = loadedModel.formNodes.get(id);
  if (node) {
    const rules = node.logic.filter((_rule, index) => {
      const events = node.logicEvents[index] ?? [];
      return event === null || events.length === 0 || events.includes(event);
    });
    return { main: rules, note: '' };
  }
  const field = loadedModel.byVar.get(id);
  const annotation = field?.annotation || '';
  return { main: field?.branching.trim() ? [field.branching.trim()] : [], note: /@(HIDDEN|IF)\b/i.test(annotation) ? annotation.trim() : '' };
}

function FieldSearch() {
  const [query, setQuery] = createSignal('');
  const [listOpen, setListOpen] = createSignal(true);
  const matches = createMemo(() => {
    const needle = query().toLowerCase().trim();
    if (!needle) return [];
    return need(model()).parsed.fields.filter((field) => field.variable.toLowerCase().includes(needle) || field.label.toLowerCase().includes(needle)).slice(0, MAX_MATCHES);
  });
  const onInput = function onInput(event: Event & { currentTarget: HTMLInputElement }): void {
    setQuery(event.currentTarget.value);
    setListOpen(true);
  };
  const choose = function choose(variable: string): void {
    editField(variable);
    setListOpen(false);
  };
  return (
    <div class="wi-search">
      <input class="filter" placeholder="Search fields by variable or label…" value={query()} onInput={onInput} />
      <Show when={listOpen() && matches().length}>
        <div class="wi-matches">
          <For each={matches()}>
            {(field) => <button class="wi-match small" onClick={() => choose(field.variable)}>{field.variable} — {field.label} ({formLabel(field.form)})</button>}
          </For>
        </div>
      </Show>
    </div>
  );
}

function ModeSelect() {
  const onModeChange = function onModeChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setMode(event.currentTarget.value === 'survey' ? 'survey' : 'form');
  };
  return (
    <label class="wi-mode small">
      <span class="muted">Show as</span>
      <select onChange={onModeChange}>
        <option value="form" selected={whatIf.mode() === 'form'}>data entry form</option>
        <option value="survey" selected={whatIf.mode() === 'survey'}>survey</option>
      </select>
    </label>
  );
}

/** The chosen field: its heading, value input, the event it is entered in (only when its form is used in several), and its own state. */
function FieldEditor(props: { field: Field }) {
  const events = () => eventsForField(need(model()), props.field.variable);
  const onEventChange = function onEventChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setEvent(event.currentTarget.value);
  };
  const showInGraph = function showInGraph(): void {
    selection.setSelected(props.field.variable);
    selection.setTab('graph');
  };
  return (
    <div class="wi-editor">
      <h4>{props.field.variable}{props.field.label ? ' — ' + props.field.label : ''} <button class="link" onClick={showInGraph}>Show in graph</button></h4>
      <div class="wi-row">
        <ValueInput field={props.field} event={whatIf.event()} />
        <Show when={events().length > 1}>
          <span class="muted small">in</span>
          <select title="Event the value is entered in" onChange={onEventChange}>
            <For each={events()}>{(id) => <option value={id} selected={whatIf.event() === id}>{eventLabel(id)}</option>}</For>
          </select>
        </Show>
        <span class="small">State: <StateBadge info={visibilityIn(whatIf.event(), true)?.get(props.field.variable)} /></span>
      </div>
    </div>
  );
}

interface AffectedRow {
  id: string;
  event: string | null;
  info: VisibilityInfo | undefined;
  state: Visibility;
  /** Distance upstream of the chosen field in "Shown when" (0 = the field or its form); unused in "Affects". */
  step: number;
}

const rowKey = (row: AffectedRow): string => row.id + '|' + (row.event ?? '');
/** The form a row belongs to: a field's own form, a form node's form; undefined for an id this project does not define. */
const formOf = (id: string): string | undefined => {
  const loadedModel = need(model());
  return loadedModel.byVar.get(id)?.form ?? loadedModel.formNodes.get(id)?.form;
};
const isDefined = (id: string): boolean => formOf(id) !== undefined;

/** Rows for the given ids in the order given, each id expanded over the events it is judged in. Repeated ids are listed once. */
function rowsFor(entries: { id: string; step: number }[]): AffectedRow[] {
  const loadedModel = need(model());
  const seen = new Set<string>();
  return entries
    .filter((entry) => !seen.has(entry.id) && !!seen.add(entry.id))
    .flatMap((entry) => eventsToEvaluate(loadedModel, entry.id, whatIf.event()).map((event): AffectedRow => {
      const info = visibilityIn(event, true)?.get(entry.id);
      return { id: entry.id, event, info, state: info?.state ?? 'unknown', step: entry.step };
    }));
}
const inputKey = (input: MissingInput): string => input.variable + '|' + (input.event ?? '');

/** A control for one value a row still needs: its variable (and event when different from the row's), then the input. */
function NeedControl(props: { input: MissingInput; rowEvent: string | null }) {
  const field = () => fieldFor(props.input.variable);
  return (
    <div class="wi-need">
      <code>{missingText(props.input, props.rowEvent)}</code>
      <Show when={!isSmartKey(props.input.variable)} fallback={<SmartValueInput variable={props.input.variable} event={props.input.event} compact />}>
        <Show when={field()} keyed fallback={<span class="muted small" title="The logic refers to a field this project does not define, so it can never have a value">not defined in this project</span>}>
          {(needed) => <ValueInput field={needed} event={props.input.event} compact />}
        </Show>
      </Show>
    </div>
  );
}

/** The rows' distinct values of a key, in first-seen order. */
const distinctOf = <Key extends string>(values: (Key | undefined | null)[]): Key[] => [...new Set(values.filter((value): value is Key => value !== undefined && value !== null))];

/** A table of fields/forms with their state under the current values: counts, state/event/form filters, logic, and inputs for what each still needs. Rows stay in the order given, so none jump when a value changes. */
function VisibilityTable(props: { title: string; emptyText: string; rows: AffectedRow[]; excludedInput: Field; showStep?: boolean }) {
  const [stateFilter, setStateFilter] = createSignal<'all' | Visibility>('all');
  const [eventFilter, setEventFilter] = createSignal('');
  const [formFilter, setFormFilter] = createSignal('');
  const eventOptions = createMemo(() => distinctOf<string>(props.rows.map((row) => row.event)));
  const formOptions = createMemo(() => distinctOf<string>(props.rows.map((row) => formOf(row.id))));
  // a filter whose value has left the options (the rows changed with the event) no longer applies
  const activeEvent = () => (eventOptions().includes(eventFilter()) ? eventFilter() : '');
  const activeForm = () => (formOptions().includes(formFilter()) ? formFilter() : '');
  const showEventFilter = () => loadedEvents().length > 0 && eventOptions().length > 1;
  const onStateFilterChange = function onStateFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setStateFilter(event.currentTarget.value as 'all' | Visibility);
  };
  const onEventFilterChange = function onEventFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setEventFilter(event.currentTarget.value);
  };
  const onFormFilterChange = function onFormFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setFormFilter(event.currentTarget.value);
  };
  const visibleRows = () => props.rows.filter((row) =>
    (stateFilter() === 'all' || row.state === stateFilter()) &&
    (activeEvent() === '' || row.event === activeEvent()) &&
    (activeForm() === '' || formOf(row.id) === activeForm()));
  const countOf = (state: Visibility): number => props.rows.filter((row) => row.state === state).length;
  /** The inputs a row still needs, minus the edited field itself in its own event, which has its input above. */
  const needsOf = (row: AffectedRow): MissingInput[] =>
    (row.info?.missing ?? []).filter((input) => !(input.variable === props.excludedInput.variable && input.event === whatIf.event()));
  return (
    <div class="wi-section">
      <h4>{props.title}</h4>
      <Show when={props.rows.length} fallback={<div class="muted small">{props.emptyText}</div>}>
        <div class="wi-row small">
          <span>{STATE_ORDER.map(([state, title]) => title + ' (' + countOf(state) + ')').join(' · ')}</span>
          <select title="Show rows in this state" onChange={onStateFilterChange}>
            <option value="all" selected={stateFilter() === 'all'}>all</option>
            <For each={STATE_ORDER}>{([state, title]) => <option value={state} selected={stateFilter() === state}>{title.toLowerCase()} only</option>}</For>
          </select>
          <Show when={showEventFilter()}>
            <select title="Show rows in this event" onChange={onEventFilterChange}>
              <option value="" selected={activeEvent() === ''}>all events</option>
              <For each={eventOptions()}>{(id) => <option value={id} selected={activeEvent() === id}>{eventLabel(id)}</option>}</For>
            </select>
          </Show>
          <select title="Show rows in this form" onChange={onFormFilterChange}>
            <option value="" selected={activeForm() === ''}>all forms</option>
            <For each={formOptions()}>{(id) => <option value={id} selected={activeForm() === id}>{formLabel(id)}</option>}</For>
          </select>
          <Show when={visibleRows().length !== props.rows.length}><span class="muted">{visibleRows().length} of {props.rows.length}</span></Show>
        </div>
        <table class="wi-table">
          <thead><tr>
            <Show when={props.showStep}><th>Step</th></Show>
            <th>Field</th><Show when={loadedEvents().length}><th>Event</th></Show><th>Label</th><th>State</th><th>Logic</th><th>Needs</th>
          </tr></thead>
          <tbody>
            <For each={visibleRows()} keyed={rowKey}>
              {(row) => {
                const isForm = () => row().id.startsWith(FORM_PREFIX);
                const logic = () => visibilityLogic(row().id, row().event);
                return (
                  <tr>
                    <Show when={props.showStep}><td>{row().step}</td></Show>
                    <td>
                      <Show when={isForm()} fallback={
                        <Show when={isDefined(row().id)} fallback={<code>{row().id}</code>}>
                          <button class="link" title="Edit this field" onClick={() => editField(row().id, row().event)}>{row().id}</button>
                        </Show>
                      }>
                        Form: {formLabel(row().id.slice(FORM_PREFIX.length))}
                      </Show>
                    </td>
                    <Show when={loadedEvents().length}><td>{row().event === null ? '' : eventLabel(row().event as string)}</td></Show>
                    <td>
                      <Show when={isDefined(row().id)} fallback={<span class="muted small">not defined in this project</span>}>
                        {isForm() ? '' : fieldFor(row().id)?.label ?? ''}
                      </Show>
                    </td>
                    <td><StateBadge info={row().info} /></td>
                    <td class="expr">
                      <For each={logic().main}>{(text) => <div>{text}</div>}</For>
                      <Show when={logic().note}><div class="muted">{logic().note}</div></Show>
                    </td>
                    <td>
                      <For each={needsOf(row())} keyed={inputKey}>{(input) => <NeedControl input={input()} rowEvent={row().event} />}</For>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

/** Forward: what this field's value affects, one row per dependent and event, in project order. */
function AffectedTable(props: { field: Field }) {
  const rows = createMemo<AffectedRow[]>(() => {
    const loadedModel = need(model());
    const order = new Map<string, number>([...loadedModel.byVar.keys(), ...loadedModel.formNodes.keys()].map((id, index) => [id, index]));
    const ids = [...dependentsOf(loadedModel, props.field.variable)].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
    return rowsFor(ids.map((id) => ({ id, step: 0 })));
  });
  return <VisibilityTable title="Affects" emptyText="No field or form depends on this field." rows={rows()} excludedInput={props.field} />;
}

/** Backwards: the field itself, its form's display logic, then every variable that can decide whether it is shown, nearest first. */
function ShownWhenTable(props: { field: Field }) {
  const rows = createMemo<AffectedRow[]>(() => {
    const loadedModel = need(model());
    const formNode = 'form:' + props.field.form;
    const entries = [
      { id: props.field.variable, step: 0 },
      ...(loadedModel.formNodes.has(formNode) ? [{ id: formNode, step: 0 }] : []),
      ...controllersOf(loadedModel, props.field.variable).map((controller) => ({ id: controller.variable, step: controller.depth })),
    ];
    return rowsFor(entries);
  });
  // a field with no logic of its own, no form display logic and no controllers is always shown
  const hasLogic = () => rows().some((row) => { const logic = visibilityLogic(row.id, row.event); return logic.main.length > 0 || logic.note !== ''; });
  return (
    <VisibilityTable
      title="Shown when"
      emptyText="Always shown: no branching logic, action tags or form display logic decide this field."
      rows={hasLogic() ? rows() : []}
      excludedInput={props.field}
      showStep
    />
  );
}

interface ValueRow {
  event: string | null;
  variable: string;
  value: WhatIfValue;
}

const DERIVED_SMART = new Set(['event-name', 'event-label', 'arm-number', 'arm-label']);

/** A compact way to set any smart variable the project's logic uses (the ones that follow from the event are worked out automatically). */
function SmartVariableSetter() {
  const names = createMemo(() => {
    const found = new Set<string>();
    need(model()).smartDeps.forEach((deps) => deps.forEach((dep) => dep.smart.forEach((name) => { if (!DERIVED_SMART.has(name)) found.add(name); })));
    return [...found];
  });
  const [chosen, setChosen] = createSignal('');
  const onChosenChange = function onChosenChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setChosen(event.currentTarget.value);
  };
  const onValueChange = function onValueChange(event: Event & { currentTarget: HTMLInputElement }): void {
    const input = event.currentTarget;
    const trimmed = input.value.trim();
    if (!chosen() || trimmed === '') return;
    whatIf.setValueIn(null, smartKey(chosen()), trimmed);
    input.value = '';
  };
  return (
    <Show when={names().length}>
      <label class="wi-row small">
        <span class="muted">Set smart variable</span>
        <select onChange={onChosenChange}>
          <option value="" selected={chosen() === ''}>(choose)</option>
          <For each={names()}>{(name) => <option value={name} selected={chosen() === name}>{smartKey(name)}</option>}</For>
        </select>
        <input type="text" class="wi-compact" placeholder="value" onChange={onValueChange} />
      </label>
    </Show>
  );
}

function ValuesSet() {
  // events in project order, with the no-event bucket first; within an event, in the order the values were set
  const rows = (): ValueRow[] => {
    const all = whatIf.values();
    return [ANY_EVENT, ...loadedEvents().map((event) => event.id)]
      .filter((key) => all[key] !== undefined)
      .flatMap((key) => Object.entries(all[key]).map(([variable, value]) => ({ event: key === ANY_EVENT ? null : key, variable, value })));
  };
  return (
    <div class="wi-section">
      <div class="wi-row">
        <h4>Values set</h4>
        <Show when={whatIf.valueCount()}>
          <button class="btn sm" onClick={() => whatIf.clearValues()}>Clear all ({whatIf.valueCount()})</button>
        </Show>
        <SmartVariableSetter />
      </div>
      <Show when={rows().length} fallback={<div class="muted small">No values set yet.</div>}>
        <table class="wi-table">
          <thead><tr>
            <th>Field</th><Show when={loadedEvents().length}><th>Event</th></Show><th>Label</th><th>Value</th><th></th>
          </tr></thead>
          <tbody>
            <For each={rows()} keyed={(row) => row.variable + '|' + (row.event ?? '')}>
              {(row) => (
                <tr>
                  <td>
                    <Show when={!isSmartKey(row().variable)} fallback={<code>{row().variable}</code>}>
                      <button class="link" title="Edit this value" onClick={() => editField(row().variable, row().event)}>{row().variable}</button>
                    </Show>
                  </td>
                  <Show when={loadedEvents().length}><td>{row().event === null ? (isSmartKey(row().variable) ? 'all events' : '') : eventLabel(row().event as string)}</td></Show>
                  <td>{isSmartKey(row().variable) ? 'smart variable' : fieldFor(row().variable)?.label ?? ''}</td>
                  <td>{valueText(row().variable, row().value)}</td>
                  <td><button class="link wi-remove" title="Remove this value" onClick={() => whatIf.setValueIn(row().event, row().variable, null)}>✕</button></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

export default function WhatIfTab() {
  return (
    <div class="whatif wi-tab">
      <div class="wi-top">
        <FieldSearch />
        <ModeSelect />
      </div>
      <ValuesSet />
      {/* keyed: a new editor and table per field, so an input can never write to the previous field */}
      <Show when={fieldFor(whatIf.field())} keyed fallback={<div class="muted small">Search for a field to see what its value affects.</div>}>
        {(field) => (
          <>
            <FieldEditor field={field} />
            <ShownWhenTable field={field} />
            <AffectedTable field={field} />
          </>
        )}
      </Show>
    </div>
  );
}
