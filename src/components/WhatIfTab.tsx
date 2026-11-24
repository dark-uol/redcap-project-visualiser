/* What if tab: pick a field, set its value, and see which fields and forms it affects (shown, hidden, or still unknown), with inputs for whatever else is needed. */
import { For, Show, createMemo, createSignal } from 'solid-js';
import { ANY_EVENT, dependentsOf, eventsForField, eventsToEvaluate } from '../lib/whatIf';
import type { MissingInput, Visibility, VisibilityInfo, WhatIfValue } from '../lib/whatIf';
import type { Field } from '../lib/types';
import { need, model, selection, whatIf, visibilityIn, formLabel } from '../store';
import { STATE_ORDER, StateBadge, ValueInput, choicesFor, editField, eventLabel, missingText } from './whatIfParts';

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
        <span class="small">State: <StateBadge info={visibilityIn(whatIf.event())?.get(props.field.variable)} /></span>
      </div>
    </div>
  );
}

interface AffectedRow {
  id: string;
  event: string | null;
  info: VisibilityInfo | undefined;
  state: Visibility;
}

const rowKey = (row: AffectedRow): string => row.id + '|' + (row.event ?? '');
const inputKey = (input: MissingInput): string => input.variable + '|' + (input.event ?? '');

/** A control for one value a row still needs: its variable (and event when different from the row's), then the input. */
function NeedControl(props: { input: MissingInput; rowEvent: string | null }) {
  const field = () => fieldFor(props.input.variable);
  return (
    <div class="wi-need">
      <code>{missingText(props.input, props.rowEvent)}</code>
      <Show when={field()} keyed fallback={<span class="muted small" title="The logic refers to a field this project does not define, so it can never have a value">not defined in this project</span>}>
        {(needed) => <ValueInput field={needed} event={props.input.event} compact />}
      </Show>
    </div>
  );
}

function AffectedTable(props: { field: Field }) {
  const [stateFilter, setStateFilter] = createSignal<'all' | Visibility>('all');
  const onStateFilterChange = function onStateFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setStateFilter(event.currentTarget.value as 'all' | Visibility);
  };
  /** One row per dependent and event it is judged in, each in the event where it lives, in project order (stable, so a row does not move when a value changes its state). */
  const rows = createMemo<AffectedRow[]>(() => {
    const loadedModel = need(model());
    const order = new Map<string, number>([...loadedModel.byVar.keys(), ...loadedModel.formNodes.keys()].map((id, index) => [id, index]));
    const eventOrder = (event: string | null): number => loadedEvents().findIndex((candidate) => candidate.id === event);
    return dependentsOf(loadedModel, props.field.variable)
      .flatMap((id) => eventsToEvaluate(loadedModel, id, whatIf.event()).map((event) => ({ id, event })))
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0) || eventOrder(left.event) - eventOrder(right.event))
      .map(({ id, event }): AffectedRow => {
        const info = visibilityIn(event)?.get(id);
        return { id, event, info, state: info?.state ?? 'unknown' };
      });
  });
  const visibleRows = () => rows().filter((row) => stateFilter() === 'all' || row.state === stateFilter());
  const countOf = (state: Visibility): number => rows().filter((row) => row.state === state).length;
  /** The inputs a row still needs, minus the edited field itself in its own event, which has its input above. */
  const needsOf = (row: AffectedRow): MissingInput[] =>
    (row.info?.missing ?? []).filter((input) => !(input.variable === props.field.variable && input.event === whatIf.event()));
  return (
    <div class="wi-section">
      <h4>Affects</h4>
      <Show when={rows().length} fallback={<div class="muted small">No field or form depends on this field.</div>}>
        <div class="wi-row small">
          <span>{STATE_ORDER.map(([state, title]) => title + ' (' + countOf(state) + ')').join(' · ')}</span>
          <select title="Show rows in this state" onChange={onStateFilterChange}>
            <option value="all" selected={stateFilter() === 'all'}>all</option>
            <For each={STATE_ORDER}>{([state, title]) => <option value={state} selected={stateFilter() === state}>{title.toLowerCase()} only</option>}</For>
          </select>
          <Show when={whatIf.valueCount() === 0}><span class="muted">Set a value above to evaluate</span></Show>
        </div>
        <table class="wi-table">
          <thead><tr>
            <th>Field</th><Show when={loadedEvents().length}><th>Event</th></Show><th>Label</th><th>State</th><th>Logic</th><th>Needs</th>
          </tr></thead>
          <tbody>
            <For each={visibleRows()} keyed={rowKey}>
              {(row) => {
                const isForm = () => row().id.startsWith(FORM_PREFIX);
                const logic = () => visibilityLogic(row().id, row().event);
                return (
                  <tr>
                    <td>
                      <Show when={isForm()} fallback={<button class="link" title="Edit this field" onClick={() => editField(row().id, row().event)}>{row().id}</button>}>
                        Form: {formLabel(row().id.slice(FORM_PREFIX.length))}
                      </Show>
                    </td>
                    <Show when={loadedEvents().length}><td>{row().event === null ? '' : eventLabel(row().event as string)}</td></Show>
                    <td>{isForm() ? '' : fieldFor(row().id)?.label ?? ''}</td>
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

interface ValueRow {
  event: string | null;
  variable: string;
  value: WhatIfValue;
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
                  <td><button class="link" title="Edit this value" onClick={() => editField(row().variable, row().event)}>{row().variable}</button></td>
                  <Show when={loadedEvents().length}><td>{row().event === null ? '' : eventLabel(row().event as string)}</td></Show>
                  <td>{fieldFor(row().variable)?.label ?? ''}</td>
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
      {/* keyed: a new editor and table per field, so an input can never write to the previous field */}
      <Show when={fieldFor(whatIf.field())} keyed fallback={<div class="muted small">Search for a field to see what its value affects.</div>}>
        {(field) => (
          <>
            <FieldEditor field={field} />
            <AffectedTable field={field} />
          </>
        )}
      </Show>
      <ValuesSet />
    </div>
  );
}
