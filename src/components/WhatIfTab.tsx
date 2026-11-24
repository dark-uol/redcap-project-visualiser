/* What if tab: set field values (per event) and see which fields and forms REDCap would show, hide, or cannot decide yet. */
import { For, Show, createMemo, createSignal } from 'solid-js';
import { ANY_EVENT, countMissingInputs, dependentsOf, eventsToEvaluate } from '../lib/whatIf';
import type { MissingInput, Visibility, VisibilityInfo, WhatIfValue } from '../lib/whatIf';
import type { Field } from '../lib/types';
import { need, model, selection, whatIf, visibility, visibilityIn, formLabel } from '../store';
import { STATE_ORDER, StateBadge, ValueInput, choicesFor, eventLabel, missingText, tooltipFor } from './whatIfParts';

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

/** Make a field the one being edited; when `event` is given (null = any event) the Event select switches to it. */
const editField = function editField(variable: string, event: string | null | undefined): void {
  whatIf.setField(variable);
  if (event !== undefined) whatIf.setEvent(event);
};

/** A field or form chip coloured by its state; a form node (`form:<id>`) opens that form's results, a field is edited. */
function StateChip(props: { id: string; event: string | null }) {
  const isForm = props.id.startsWith(FORM_PREFIX);
  const label = isForm ? formLabel(props.id.slice(FORM_PREFIX.length)) : props.id;
  const info = (): VisibilityInfo | undefined => visibilityIn(props.event)?.get(props.id);
  const state = (): string => info()?.state ?? 'unknown';
  const tip = (): string => (visibility() ? tooltipFor(info()) : 'Set a value to evaluate');
  const onPick = function onPick(): void {
    // edit the field in the event it was judged in, so the value lands where the field lives
    if (!isForm) { editField(props.id, props.event); return; }
    whatIf.setResultsForm(props.id.slice(FORM_PREFIX.length));
    whatIf.setResultsEvent(props.event);
  };
  return <button class={'chip wi-chip ' + state()} title={tip()} onClick={onPick}>{label}</button>;
}

function ControlsRow() {
  const onModeChange = function onModeChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setMode(event.currentTarget.value === 'survey' ? 'survey' : 'form');
  };
  const onEventChange = function onEventChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setEvent(event.currentTarget.value || null);
  };
  return (
    <div class="wi-row small">
      <Show when={loadedEvents().length}>
        <span class="muted">Event</span>
        <select title="Event the values are entered in" onChange={onEventChange}>
          <option value="" selected={whatIf.event() === null}>(any event)</option>
          <For each={loadedEvents()}>{(event) => <option value={event.id} selected={whatIf.event() === event.id}>{eventLabel(event.id)}</option>}</For>
        </select>
      </Show>
      <select title="Evaluate as a survey or as data entry" onChange={onModeChange}>
        <option value="form" selected={whatIf.mode() === 'form'}>data entry</option>
        <option value="survey" selected={whatIf.mode() === 'survey'}>survey</option>
      </select>
      <Show when={whatIf.valueCount()}>
        <button class="btn sm" onClick={() => whatIf.clearValues()}>Clear all ({whatIf.valueCount()})</button>
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
  // "Any event" first, then the events in project order; within an event, in the order the values were set
  const rows = (): ValueRow[] => {
    const all = whatIf.values();
    return [ANY_EVENT, ...loadedEvents().map((event) => event.id)]
      .filter((key) => all[key] !== undefined)
      .flatMap((key) => Object.entries(all[key]).map(([variable, value]) => ({ event: key === ANY_EVENT ? null : key, variable, value })));
  };
  return (
    <div class="wi-section">
      <h4>Values set</h4>
      <Show when={rows().length} fallback={<div class="muted small">No values set yet. Pick a field below.</div>}>
        <table class="wi-table">
          <thead><tr>
            <Show when={loadedEvents().length}><th>Event</th></Show>
            <th>Field</th><th>Label</th><th>Value</th><th></th>
          </tr></thead>
          <tbody>
            <For each={rows()}>
              {(row) => (
                <tr>
                  <Show when={loadedEvents().length}><td>{row.event === null ? 'Any event' : eventLabel(row.event)}</td></Show>
                  <td><button class="link" title="Edit this value" onClick={() => editField(row.variable, row.event)}>{row.variable}</button></td>
                  <td>{fieldFor(row.variable)?.label ?? ''}</td>
                  <td>{valueText(row.variable, row.value)}</td>
                  <td><button class="link wi-remove" title="Remove this value" onClick={() => whatIf.setValueIn(row.event, row.variable, null)}>✕</button></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

/** The logic that decides whether a field is shown: its branching logic and the action tags that can hide it. */
function visibilityLogic(field: Field): { branching: string; tags: string } {
  const annotation = field.annotation || '';
  return { branching: field.branching.trim(), tags: /@(HIDDEN|IF)\b/i.test(annotation) ? annotation.trim() : '' };
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
    whatIf.setField(variable);
    setListOpen(false);
  };
  return (
    <>
      <input class="filter" placeholder="Search fields by variable or label…" value={query()} onInput={onInput} />
      <Show when={listOpen() && matches().length}>
        <div class="wi-matches">
          <For each={matches()}>
            {(field) => <button class="wi-match small" onClick={() => choose(field.variable)}>{field.variable} — {field.label} ({formLabel(field.form)})</button>}
          </For>
        </div>
      </Show>
    </>
  );
}

function FieldEditor(props: { field: Field }) {
  const dependents = () => dependentsOf(need(model()), props.field.variable);
  /** The event the field's own state is judged in: the selected event if its form is used there, else the first event it is used in. */
  const ownEvent = (): string | null => eventsToEvaluate(need(model()), props.field.variable, whatIf.event())[0] ?? null;
  // each dependent is judged where it lives: the selected event if its form is used there, else each event its form is used in
  const sections = () => {
    const loadedModel = need(model());
    const selected = whatIf.event();
    const byEvent = new Map<string | null, string[]>();
    dependents().forEach((id) => eventsToEvaluate(loadedModel, id, selected).forEach((event) => {
      byEvent.set(event, [...(byEvent.get(event) ?? []), id]);
    }));
    const order = (event: string | null): number => (event === selected ? -1 : loadedEvents().findIndex((candidate) => candidate.id === event));
    return [...byEvent.entries()].sort((left, right) => order(left[0]) - order(right[0])).map(([event, ids]) => {
      const info = visibilityIn(event);
      const groups = STATE_ORDER
        .map(([state, title]) => ({ title, ids: ids.filter((id) => (info?.get(id)?.state ?? 'unknown') === state) }))
        .filter((group) => group.ids.length);
      return { event, groups };
    });
  };
  const sectionTitle = (event: string | null): string =>
    event === null ? '' : (event === whatIf.event() ? 'In this event' : 'In ' + eventLabel(event));
  const showSectionTitles = (): boolean => sections().some((section) => section.event !== whatIf.event());
  const showInGraph = function showInGraph(): void {
    selection.setSelected(props.field.variable);
    selection.setTab('graph');
  };
  return (
    <div class="wi-editor">
      <h4>{props.field.variable}{props.field.label ? ' — ' + props.field.label : ''} <button class="link" onClick={showInGraph}>Show in graph</button></h4>
      <ValueInput field={props.field} />
      <div class="small" style="margin:6px 0">State{ownEvent() !== whatIf.event() && ownEvent() !== null ? ' in ' + eventLabel(ownEvent() as string) : ''}: <StateBadge info={visibilityIn(ownEvent())?.get(props.field.variable)} /></div>
      <Show when={!visibility() && dependents().length}>
        <div class="muted small">Set a value to evaluate</div>
      </Show>
      <For each={sections()}>
        {(section) => (
          <div class="wi-event">
            <Show when={showSectionTitles()}><div class="small wi-event-title">{sectionTitle(section.event)}</div></Show>
            <For each={section.groups}>
              {(group) => (
                <div class="wi-group"><div class="small muted">{group.title} ({group.ids.length})</div>
                  <div class="chips"><For each={group.ids}>{(id) => <StateChip id={id} event={section.event} />}</For></div></div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

function FormResults() {
  const forms = () => need(model()).parsed.forms;
  const formId = (): string | null => whatIf.resultsForm() ?? fieldFor(whatIf.field())?.form ?? null;
  const formEvents = () => loadedEvents().filter((event) => formId() !== null && event.forms.includes(formId() as string));
  // the chosen results event if the form is used there; else the main event if it is, else the first event the form is used in
  const resultsEvent = (): string | null => {
    const candidates = formEvents().map((event) => event.id);
    const chosen = whatIf.resultsEvent();
    if (chosen !== null && candidates.includes(chosen)) return chosen;
    const main = whatIf.event();
    if (main !== null && candidates.includes(main)) return main;
    return candidates[0] ?? null;
  };
  /** The form display logic rules for a form that apply in the results event (all of them when no event). */
  const formRulesFor = (id: string): string[] => {
    const node = need(model()).formNodes.get(FORM_PREFIX + id);
    if (!node) return [];
    const event = resultsEvent();
    return node.logic.filter((_rule, index) => {
      const events = node.logicEvents[index] ?? [];
      return event === null || events.length === 0 || events.includes(event);
    });
  };
  const results = createMemo(() => {
    const id = formId();
    const form = id === null ? undefined : need(model()).formsById.get(id);
    const info = visibilityIn(resultsEvent());
    if (!form || !info) return null;
    const entries = form.fields.map((variable) => ({ variable, info: info.get(variable) }));
    const groups = STATE_ORDER.map(([state, title]) => ({ title, variables: entries.filter((entry) => (entry.info?.state ?? 'unknown') === state).map((entry) => entry.variable) }));
    const unknownInfos = entries.filter((entry) => entry.info?.state === 'unknown').map((entry) => entry.info as VisibilityInfo);
    const formInfo = info.get(FORM_PREFIX + form.id);
    if (formInfo?.state === 'unknown') unknownInfos.push(formInfo);
    return { entries, groups, formInfo, formRules: formRulesFor(form.id), needed: countMissingInputs(unknownInfos) };
  });
  const [stateFilter, setStateFilter] = createSignal<'all' | Visibility>('all');
  const onStateFilterChange = function onStateFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setStateFilter(event.currentTarget.value as 'all' | Visibility);
  };
  const onFormChange = function onFormChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setResultsForm(event.currentTarget.value || null);
    whatIf.setResultsEvent(null);
  };
  const onResultsEventChange = function onResultsEventChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setResultsEvent(event.currentTarget.value || null);
  };
  const pickMissing = function pickMissing(input: MissingInput): void { editField(input.variable, input.event); };
  return (
    <div class="wi-section">
      <h4>Results for a form</h4>
      <div class="wi-row small">
        <select title="Form to evaluate" onChange={onFormChange}>
          <option value="" selected={formId() === null}>(choose a form)</option>
          <For each={forms()}>{(form) => <option value={form.id} selected={formId() === form.id}>{formLabel(form.id)}</option>}</For>
        </select>
        <Show when={formEvents().length}>
          <span class="muted">in</span>
          <select title="Event the results are judged in" onChange={onResultsEventChange}>
            <For each={formEvents()}>{(event) => <option value={event.id} selected={resultsEvent() === event.id}>{eventLabel(event.id)}</option>}</For>
          </select>
        </Show>
      </div>
      <Show when={formId() !== null} fallback={<div class="muted small">Choose a form, or pick a field above.</div>}>
        <Show when={results()} fallback={<div class="muted small">Set a value to evaluate</div>}>
          {(current) => (
            <>
              <Show when={current().formInfo}>
                <div class="small" style="margin:4px 0">Form: <StateBadge info={current().formInfo} /></div>
                <For each={current().formRules}>{(rule) => <pre class="wi-logic">{rule}</pre>}</For>
              </Show>
              <div class="wi-row small">
                <span>{current().groups.map((group) => group.title + ' (' + group.variables.length + ')').join(' · ')}</span>
                <select title="Show fields in this state" onChange={onStateFilterChange}>
                  <option value="all" selected={stateFilter() === 'all'}>all fields</option>
                  <For each={STATE_ORDER}>{([state, title]) => <option value={state} selected={stateFilter() === state}>{title.toLowerCase()} only</option>}</For>
                </select>
              </div>
              <table class="wi-table">
                <thead><tr><th>Field</th><th>Label</th><th>State</th><th>Logic</th><th>Needs</th></tr></thead>
                <tbody>
                  <For each={current().entries.filter((entry) => stateFilter() === 'all' || (entry.info?.state ?? 'unknown') === stateFilter())}>
                    {(entry) => {
                      const field = fieldFor(entry.variable);
                      const logic = field ? visibilityLogic(field) : { branching: '', tags: '' };
                      return (
                        <tr>
                          <td><button class="link" title="Edit this field" onClick={() => editField(entry.variable, resultsEvent())}>{entry.variable}</button></td>
                          <td>{field?.label ?? ''}</td>
                          <td><StateBadge info={entry.info} /></td>
                          <td class="expr">
                            <Show when={logic.branching}><div>{logic.branching}</div></Show>
                            <Show when={logic.tags}><div class="muted">{logic.tags}</div></Show>
                          </td>
                          <td class="small">{(entry.info?.missing ?? []).map((input) => missingText(input, resultsEvent())).join(', ')}</td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
              <Show when={current().needed.length}>
                <h4 class="wi-needed">Inputs still needed</h4>
                <div class="chips">
                  <For each={current().needed}>
                    {(entry) => (
                      <button class="chip" title={entry.count + ' unknown ' + (entry.count === 1 ? 'item needs' : 'items need') + ' this value'} onClick={() => pickMissing(entry.input)}>
                        {missingText(entry.input, resultsEvent())} ({entry.count})
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

export default function WhatIfTab() {
  return (
    <div class="whatif wi-tab">
      <ControlsRow />
      <ValuesSet />
      <div class="wi-section">
        <h4>Edit a field</h4>
        <FieldSearch />
        {/* keyed: a new editor per field, since the input captures the field it edits */}
        <Show when={fieldFor(whatIf.field())} keyed>{(field) => <FieldEditor field={field} />}</Show>
      </div>
      <FormResults />
    </div>
  );
}
