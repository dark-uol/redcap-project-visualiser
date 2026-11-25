/* What if tab: one editable table of the values set (fields and smart variables, each with the event its value is for), then the explored field's state, what decides whether it is shown and what it affects. */
import { For, Show, createMemo, createSignal } from 'solid-js';
import { ANY_EVENT, controllersOf, dependentsOf, eventForField, eventsForField, eventsToEvaluate, isSmartKey, smartKey } from '../lib/whatIf';
import type { MissingInput, Visibility, VisibilityInfo } from '../lib/whatIf';
import type { Field } from '../lib/types';
import { need, model, selection, whatIf, visibilityIn, formLabel } from '../store';
import { LogicText, SmartValueInput, StateBadge, ValueInput, editField, eventLabel, missingText } from './whatIfParts';
import { STATE_ORDER } from './whatIfViews';

const FORM_PREFIX = 'form:';
const MAX_MATCHES = 20;
const DERIVED_SMART = new Set(['event-name', 'event-label', 'arm-number', 'arm-label']);

const loadedEvents = () => need(model()).parsed.events || [];
const fieldFor = (variable: string | null): Field | undefined => (variable === null ? undefined : need(model()).byVar.get(variable));

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

/** One row of the values table: a field or smart variable key, and the event its value is for (null: every event, or no events). */
interface TableRow { variable: string; event: string | null }

const rowKeyOf = (row: TableRow): string => row.variable + '|' + (row.event ?? '');
const isExploredRow = (row: TableRow): boolean => row.variable === whatIf.field() && row.event === whatIf.event();

/** One entry of the chooser's dropdown: a field, or a smart variable (`smart`, with its key in `variable`). */
interface ChooserMatch { variable: string; smart: boolean; text: string }

/** The rows as listed: the ones the user added, in order, then any value set elsewhere (the Needs inputs) that no row lists yet. */
function displayRowsOf(): TableRow[] {
  const listed: TableRow[] = [...whatIf.rows()];
  const seen = new Set(listed.map(rowKeyOf));
  const all = whatIf.values();
  const unlisted = [ANY_EVENT, ...loadedEvents().map((event) => event.id)]
    .filter((key) => all[key] !== undefined)
    .flatMap((key): TableRow[] => Object.keys(all[key]).map((variable) => ({ variable, event: key === ANY_EVENT ? null : key })))
    .filter((row) => !seen.has(rowKeyOf(row)));
  return [...listed, ...unlisted];
}

/** The values table: every row with its field, event, label, value and state, a row to change its event or remove it, and the chooser that adds a field or smart variable as the last row. */
function ValuesTable() {
  const [query, setQuery] = createSignal('');
  const [listOpen, setListOpen] = createSignal(true);
  // smart variables the project's logic uses (the derived ones follow from the event and are not offered)
  const smartNames = createMemo(() => {
    const found = new Set<string>();
    need(model()).smartDeps.forEach((deps) => deps.forEach((dep) => dep.smart.forEach((name) => { if (!DERIVED_SMART.has(name)) found.add(name); })));
    return [...found];
  });
  const matches = createMemo<ChooserMatch[]>(() => {
    const needle = query().toLowerCase().trim();
    if (!needle) return [];
    const fields = need(model()).parsed.fields
      .filter((field) => field.variable.toLowerCase().includes(needle) || field.label.toLowerCase().includes(needle))
      .slice(0, MAX_MATCHES)
      .map((field): ChooserMatch => ({ variable: field.variable, smart: false, text: field.variable + ' — ' + field.label + ' (' + formLabel(field.form) + ')' }));
    const smarts = smartNames()
      .filter((name) => name.toLowerCase().includes(needle))
      .map((name): ChooserMatch => ({ variable: smartKey(name), smart: true, text: smartKey(name) + ' — smart variable' }));
    return [...fields, ...smarts];
  });
  const choose = function choose(match: ChooserMatch): void {
    if (match.smart) {
      whatIf.addRow(match.variable, null);
    } else {
      const event = eventForField(need(model()), match.variable, whatIf.event());
      whatIf.addRow(match.variable, event);
      editField(match.variable, event);
    }
    setQuery('');
    setListOpen(false);
  };
  const onInput = function onInput(event: Event & { currentTarget: HTMLInputElement }): void {
    setQuery(event.currentTarget.value);
    setListOpen(true);
  };
  // Enter picks the first match
  const onKeyDown = function onKeyDown(event: KeyboardEvent): void {
    const first = matches()[0];
    if (event.key !== 'Enter' || !first) return;
    event.preventDefault();
    choose(first);
  };
  const onClearAll = function onClearAll(): void {
    whatIf.clearValues();
    whatIf.setField(null);
  };
  // a click anywhere on a field's row explores it, except on its inputs and buttons, which do their own thing
  const onRowClick = function onRowClick(row: TableRow, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('input, select, button, label') || !fieldFor(row.variable)) return;
    editField(row.variable, row.event);
  };
  const changeEvent = function changeEvent(row: TableRow, value: string): void {
    const explored = isExploredRow(row);
    const next = value === '' ? null : value;
    whatIf.moveRow(row.variable, row.event, next);
    if (explored) whatIf.setEvent(next);
  };
  const removeTableRow = function removeTableRow(row: TableRow): void {
    // worked out before the removal: a signal read straight after a write still returns the old value in Solid 2
    const next = isExploredRow(row)
      ? displayRowsOf().find((other) => rowKeyOf(other) !== rowKeyOf(row) && fieldFor(other.variable) !== undefined)
      : undefined;
    const explored = isExploredRow(row);
    whatIf.removeRow(row.variable, row.event);
    // the explored row is gone: explore the next field still listed, so the sections below never go blank while rows remain
    if (explored) {
      if (next) editField(next.variable, next.event);
      else whatIf.setField(null);
    }
  };
  const columnCount = (): number => (loadedEvents().length ? 6 : 5);
  return (
    <div class="wi-section">
      <div class="wi-row">
        <h4>Values</h4>
        <Show when={whatIf.valueCount() || whatIf.rows().length}>
          <button class="btn sm" onClick={onClearAll}>Clear all ({displayRowsOf().length})</button>
        </Show>
        <ModeSelect />
      </div>
      <table class="wi-table">
        <thead><tr>
          <th>Field</th><Show when={loadedEvents().length}><th>Event</th></Show><th>Label</th><th>Value</th><th>State</th><th></th>
        </tr></thead>
        <tbody>
          <For each={displayRowsOf()} keyed={rowKeyOf}>
            {(row) => {
              const field = () => fieldFor(row().variable);
              const isSmart = () => isSmartKey(row().variable);
              const eventIds = (): string[] => (isSmart() ? loadedEvents().map((event) => event.id) : eventsForField(need(model()), row().variable));
              return (
                <tr class={{ 'wi-current': isExploredRow(row()), 'wi-explorable': field() !== undefined }} onClick={(clicked) => onRowClick(row(), clicked)}>
                  <td>
                    <Show when={field()} fallback={<code>{row().variable}</code>}>
                      <button class="link" title="Explore this field" onClick={() => editField(row().variable, row().event)}>{row().variable}</button>
                    </Show>
                  </td>
                  <Show when={loadedEvents().length}>
                    <td>
                      <Show when={isSmart() || eventIds().length > 1} fallback={<span>{row().event === null ? '' : eventLabel(row().event as string)}</span>}>
                        <select title="Event the value is entered in" onChange={(changed) => changeEvent(row(), changed.currentTarget.value)}>
                          <Show when={isSmart()}><option value="" selected={row().event === null}>all events</option></Show>
                          <For each={eventIds()}>{(id) => <option value={id} selected={row().event === id}>{eventLabel(id)}</option>}</For>
                        </select>
                      </Show>
                    </td>
                  </Show>
                  <td>
                    <Show when={!isSmart()} fallback="smart variable">
                      <Show when={field()} fallback={<span class="muted small">not defined in this project</span>}>{field()?.label ?? ''}</Show>
                    </Show>
                  </td>
                  <td>
                    <Show when={!isSmart()} fallback={<SmartValueInput variable={row().variable} event={row().event} compact />}>
                      <Show when={field()} keyed>{(defined) => <ValueInput field={defined} event={row().event} compact />}</Show>
                    </Show>
                  </td>
                  <td>
                    <Show when={!isSmart() && field()}><StateBadge info={visibilityIn(row().event, true)?.get(row().variable)} /></Show>
                  </td>
                  <td><button class="link wi-remove" title="Remove this row" onClick={() => removeTableRow(row())}>✕</button></td>
                </tr>
              );
            }}
          </For>
          <tr class="wi-chooser">
            <td colspan={columnCount()}>
              <input class="filter" placeholder="Add a field or smart variable…" value={query()} onInput={onInput} onKeyDown={onKeyDown} />
              <Show when={listOpen() && matches().length}>
                <div class="wi-matches">
                  <For each={matches()}>{(match) => <button class="wi-match small" onClick={() => choose(match)}>{match.text}</button>}</For>
                </div>
              </Show>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** The explored field's heading: its event (when the project has events), its own state and the link to the graph. Its value is set in the table above. */
function FieldEditor(props: { field: Field }) {
  const eventId = (): string | null => (loadedEvents().length ? whatIf.event() : null);
  const showInGraph = function showInGraph(): void {
    selection.setSelected(props.field.variable);
    selection.setTab('graph');
  };
  return (
    <div class="wi-editor">
      <h4>
        Exploring {props.field.variable}{props.field.label ? ' — ' + props.field.label : ''}
        <Show when={eventId()} keyed>{(id) => <span class="small muted"> in {eventLabel(id)}</span>}</Show>
        {' '}<span class="small">State: <StateBadge info={visibilityIn(whatIf.event(), true)?.get(props.field.variable)} /></span>
        {' '}<button class="link" onClick={showInGraph}>Show in graph</button>
      </h4>
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
  const collapsed = (): boolean => !!whatIf.collapsed()[props.title];
  /** The inputs a row still needs, minus the edited field itself in its own event, which has its input above. */
  const needsOf = (row: AffectedRow): MissingInput[] =>
    (row.info?.missing ?? []).filter((input) => !(input.variable === props.excludedInput.variable && input.event === whatIf.event()));
  return (
    <div class="wi-section">
      {/* the heading folds the section away; the counts stay in view so a collapsed section still says how things stand */}
      <button class="wi-fold" aria-expanded={collapsed() ? 'false' : 'true'} onClick={() => whatIf.toggleSection(props.title)}>
        <h4>{props.title}</h4>
        <span class={{ 'wi-fold-mark': true, collapsed: collapsed() }} aria-hidden="true" />
        <Show when={props.rows.length}><span class="small muted">{STATE_ORDER.map(([state, title]) => title + ' (' + countOf(state) + ')').join(' · ')}</span></Show>
      </button>
      <Show when={!collapsed()}>
      <Show when={props.rows.length} fallback={<div class="muted small">{props.emptyText}</div>}>
        <div class="wi-row small">
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
                      <For each={logic().main}>{(text) => <LogicText text={text} event={row().event} />}</For>
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

export default function WhatIfTab() {
  return (
    <div class="whatif wi-tab">
      <ValuesTable />
      {/* keyed: new tables per field, so an input can never write to the previous field */}
      <Show when={fieldFor(whatIf.field())} keyed fallback={<div class="muted small">Add a field above, or click one, to see what decides whether it is shown and what it affects.</div>}>
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
