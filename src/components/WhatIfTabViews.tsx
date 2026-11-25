/*
 * Presentational parts of the What if tab: the values table, the explored field's heading and the shown-when / affects
 * tables. They take row view-models, callbacks and render-prop slots for the connected cells, and never touch the store.
 */
import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Accessor, Element as SolidElement } from 'solid-js';
import type { MissingInput, Visibility, VisibilityInfo } from '../lib/whatIf';
import { countByState, distinctOf, filterVisibilityRows } from '../lib/whatIfRows';
import type { ChooserMatch } from '../lib/whatIfRows';
import { STATE_ORDER } from './whatIfViews';

export type { ChooserMatch };

// ---- the values table ----

/** One row of the values table, ready to show. */
export type ValuesRow = {
  key: string;
  variable: string;
  event: string | null;
  /** Whether this is the row of the field being explored. */
  explored: boolean;
  /** Whether the variable is a field of the project (so the row can be explored). */
  explorable: boolean;
  isSmart: boolean;
  /** Whether the event cell is a choice of events (else it is plain text). */
  showEventSelect: boolean;
  /** The ids of the events to choose from (labels come from `eventLabelOf`, so the ids keep their identity between updates). */
  eventOptionIds: string[];
  eventText: string;
  /** The label cell: a field's label, or why there is none. */
  labelKind: 'label' | 'smart' | 'undefined';
  label: string;
};

export type ValuesTableViewProps = {
  rows: ValuesRow[];
  showEventColumn: boolean;
  eventLabelOf: (eventId: string) => string;
  /** The row count shown on the "Clear all" button, or null when there is nothing to clear. */
  clearCount: number | null;
  mode: 'form' | 'survey';
  query: string;
  matches: ChooserMatch[];
  listOpen: boolean;
  onModeChange: (mode: 'form' | 'survey') => void;
  onClearAll: () => void;
  onExploreRow: (row: ValuesRow) => void;
  onChangeEvent: (row: ValuesRow, eventId: string) => void;
  onRemoveRow: (row: ValuesRow) => void;
  onQueryChange: (query: string) => void;
  onChooseMatch: (match: ChooserMatch) => void;
  /**
   * The connected value input and state badge for a row. They get the row as an accessor and read it inside their own
   * reactive gates, so a change to the row updates the cell without rebuilding the input (which would lose its focus).
   */
  renderValue: (row: Accessor<ValuesRow>) => SolidElement;
  renderState: (row: Accessor<ValuesRow>) => SolidElement;
};

/** Presentational: every value set (field or smart variable, with its event, label, value and state), and the chooser that adds another. */
export function ValuesTableView(props: ValuesTableViewProps) {
  const onModeSelectChange = function onModeSelectChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    props.onModeChange(event.currentTarget.value === 'survey' ? 'survey' : 'form');
  };
  const onInput = function onInput(event: Event & { currentTarget: HTMLInputElement }): void {
    props.onQueryChange(event.currentTarget.value);
  };
  // Enter picks the first match
  const onKeyDown = function onKeyDown(event: KeyboardEvent): void {
    const first = props.matches[0];
    if (event.key !== 'Enter' || !first) return;
    event.preventDefault();
    props.onChooseMatch(first);
  };
  // a click anywhere on a field's row explores it, except on its inputs and buttons, which do their own thing
  const onRowClick = function onRowClick(row: ValuesRow, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('input, select, button, label') || !row.explorable) return;
    props.onExploreRow(row);
  };
  const columnCount = (): number => (props.showEventColumn ? 6 : 5);
  return (
    <div class="wi-section">
      <div class="wi-row">
        <h4>Values</h4>
        <Show when={props.clearCount !== null}>
          <button class="btn sm" onClick={() => props.onClearAll()}>Clear all ({props.clearCount})</button>
        </Show>
        <label class="wi-mode small">
          <span class="muted">Show as</span>
          <select onChange={onModeSelectChange}>
            <option value="form" selected={props.mode === 'form'}>data entry form</option>
            <option value="survey" selected={props.mode === 'survey'}>survey</option>
          </select>
        </label>
      </div>
      <table class="wi-table">
        <thead><tr>
          <th>Field</th><Show when={props.showEventColumn}><th>Event</th></Show><th>Label</th><th>Value</th><th>State</th><th></th>
        </tr></thead>
        <tbody>
          <For each={props.rows} keyed={(row) => row.key}>
            {(row) => (
              <tr class={{ 'wi-current': row().explored, 'wi-explorable': row().explorable }} onClick={(clicked) => onRowClick(row(), clicked)}>
                <td>
                  <Show when={row().explorable} fallback={<code>{row().variable}</code>}>
                    <button class="link" title="Explore this field" onClick={() => props.onExploreRow(row())}>{row().variable}</button>
                  </Show>
                </td>
                <Show when={props.showEventColumn}>
                  <td>
                    <Show when={row().showEventSelect} fallback={<span>{row().eventText}</span>}>
                      <select title="Event the value is entered in" onChange={(changed) => props.onChangeEvent(row(), changed.currentTarget.value)}>
                        <Show when={row().isSmart}><option value="" selected={row().event === null}>all events</option></Show>
                        <For each={row().eventOptionIds}>{(id) => <option value={id} selected={row().event === id}>{props.eventLabelOf(id)}</option>}</For>
                      </select>
                    </Show>
                  </td>
                </Show>
                <td>
                  <Show when={row().labelKind === 'undefined'} fallback={row().labelKind === 'smart' ? 'smart variable' : row().label}>
                    <span class="muted small">not defined in this project</span>
                  </Show>
                </td>
                <td>{props.renderValue(row)}</td>
                <td>{props.renderState(row)}</td>
                <td><button class="link wi-remove" title="Remove this row" onClick={() => props.onRemoveRow(row())}>✕</button></td>
              </tr>
            )}
          </For>
          <tr class="wi-chooser">
            <td colspan={columnCount()}>
              <input class="filter" placeholder="Add a field or smart variable…" value={props.query} onInput={onInput} onKeyDown={onKeyDown} />
              <Show when={props.listOpen && props.matches.length}>
                <div class="wi-matches">
                  <For each={props.matches}>{(match) => <button class="wi-match small" onClick={() => props.onChooseMatch(match)}>{match.text}</button>}</For>
                </div>
              </Show>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---- the explored field's heading ----

export type FieldEditorViewProps = {
  variable: string;
  label: string;
  /** The event's label when the project has events, else null. */
  eventLabel: string | null;
  stateBadge: SolidElement;
  onShowInGraph: () => void;
};

/** Presentational: the explored field's heading: its event, its own state and the link to the graph. */
export function FieldEditorView(props: FieldEditorViewProps) {
  return (
    <div class="wi-editor">
      <h4>
        Exploring {props.variable}{props.label ? ' — ' + props.label : ''}
        <Show when={props.eventLabel} keyed>{(label) => <span class="small muted"> in {label}</span>}</Show>
        {' '}<span class="small">State: {props.stateBadge}</span>
        {' '}<button class="link" onClick={() => props.onShowInGraph()}>Show in graph</button>
      </h4>
    </div>
  );
}

// ---- the shown-when and affects tables ----

/** One row of a shown-when / affects table, ready to show. */
export type VisibilityRow = {
  key: string;
  id: string;
  event: string | null;
  eventLabel: string;
  state: Visibility;
  /** The state's reasons and missing inputs, which the state badge turns into its tooltip. */
  info: VisibilityInfo | undefined;
  /** Distance upstream of the chosen field in "Shown when"; unused in "Affects". */
  step: number;
  /** The form this row belongs to (for the form filter), or undefined for an id the project does not define. */
  formId: string | undefined;
  formLabel: string;
  /** What the first cell shows: a form node, a field (a link), or an id the project does not define. */
  kind: 'form' | 'field' | 'undefined';
  /** The label cell: a field's label ('' for a form), shown unless the id is undefined. */
  label: string;
  defined: boolean;
  /** The logic that decides this row, and a note on action tags, for the slots. */
  logicTexts: string[];
  logicNote: string;
  needs: MissingInput[];
};

export type VisibilityTableViewProps = {
  title: string;
  emptyText: string;
  rows: VisibilityRow[];
  showStep?: boolean;
  showEventColumn: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onEditField: (row: VisibilityRow) => void;
  /** The connected logic text (coloured by result), needed-value control and state badge. Rows are accessors, as for the values table. */
  renderLogicText: (text: string, row: Accessor<VisibilityRow>) => SolidElement;
  renderNeed: (input: Accessor<MissingInput>, row: Accessor<VisibilityRow>) => SolidElement;
  renderState: (row: Accessor<VisibilityRow>) => SolidElement;
};

const inputKey = (input: MissingInput): string => input.variable + '|' + (input.event ?? '');

/** Presentational: a foldable table of fields/forms with their state: counts, state/event/form filters, logic, and what each still needs. */
export function VisibilityTableView(props: VisibilityTableViewProps) {
  const [stateFilter, setStateFilter] = createSignal<'all' | Visibility>('all');
  const [eventFilter, setEventFilter] = createSignal('');
  const [formFilter, setFormFilter] = createSignal('');
  const eventOptions = createMemo(() => distinctOf<string>(props.rows.map((row) => row.event)));
  const formOptions = createMemo(() => distinctOf<string>(props.rows.map((row) => row.formId)));
  const eventLabels = createMemo(() => new Map(props.rows.map((row) => [row.event, row.eventLabel])));
  const formLabels = createMemo(() => new Map(props.rows.map((row) => [row.formId, row.formLabel])));
  const eventLabelOf = (id: string): string => eventLabels().get(id) ?? id;
  const formLabelOf = (id: string): string => formLabels().get(id) ?? id;
  // a filter whose value has left the options (the rows changed with the event) no longer applies
  const activeEvent = () => (eventOptions().includes(eventFilter()) ? eventFilter() : '');
  const activeForm = () => (formOptions().includes(formFilter()) ? formFilter() : '');
  const showEventFilter = () => props.showEventColumn && eventOptions().length > 1;
  const onStateFilterChange = function onStateFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setStateFilter(event.currentTarget.value as 'all' | Visibility);
  };
  const onEventFilterChange = function onEventFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setEventFilter(event.currentTarget.value);
  };
  const onFormFilterChange = function onFormFilterChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    setFormFilter(event.currentTarget.value);
  };
  const visibleRows = () => filterVisibilityRows(props.rows, { state: stateFilter(), event: activeEvent(), form: activeForm() });
  const countOf = (state: Visibility): number => countByState(props.rows, state);
  return (
    <div class="wi-section">
      {/* the heading folds the section away; the counts stay in view so a collapsed section still says how things stand */}
      <button class="wi-fold" aria-expanded={props.collapsed ? 'false' : 'true'} onClick={() => props.onToggleCollapsed()}>
        <h4>{props.title}</h4>
        <span class={{ 'wi-fold-mark': true, collapsed: props.collapsed }} aria-hidden="true" />
        <Show when={props.rows.length}><span class="small muted">{STATE_ORDER.map(([state, title]) => title + ' (' + countOf(state) + ')').join(' · ')}</span></Show>
      </button>
      <Show when={!props.collapsed}>
      <Show when={props.rows.length} fallback={<div class="muted small">{props.emptyText}</div>}>
        <div class="wi-row small">
          <select title="Show rows in this state" onChange={onStateFilterChange}>
            <option value="all" selected={stateFilter() === 'all'}>all</option>
            <For each={STATE_ORDER}>{([state, title]) => <option value={state} selected={stateFilter() === state}>{title.toLowerCase()} only</option>}</For>
          </select>
          <Show when={showEventFilter()}>
            <select title="Show rows in this event" onChange={onEventFilterChange}>
              <option value="" selected={activeEvent() === ''}>all events</option>
              <For each={eventOptions()}>{(id) => <option value={id} selected={activeEvent() === id}>{eventLabelOf(id)}</option>}</For>
            </select>
          </Show>
          <select title="Show rows in this form" onChange={onFormFilterChange}>
            <option value="" selected={activeForm() === ''}>all forms</option>
            <For each={formOptions()}>{(id) => <option value={id} selected={activeForm() === id}>{formLabelOf(id)}</option>}</For>
          </select>
          <Show when={visibleRows().length !== props.rows.length}><span class="muted">{visibleRows().length} of {props.rows.length}</span></Show>
        </div>
        <table class="wi-table">
          <thead><tr>
            <Show when={props.showStep}><th>Step</th></Show>
            <th>Field</th><Show when={props.showEventColumn}><th>Event</th></Show><th>Label</th><th>State</th><th>Logic</th><th>Needs</th>
          </tr></thead>
          <tbody>
            <For each={visibleRows()} keyed={(row) => row.key}>
              {(row) => (
                <tr>
                  <Show when={props.showStep}><td>{row().step}</td></Show>
                  <td>
                    <Show when={row().kind === 'form'} fallback={
                      <Show when={row().kind === 'field'} fallback={<code>{row().id}</code>}>
                        <button class="link" title="Edit this field" onClick={() => props.onEditField(row())}>{row().id}</button>
                      </Show>
                    }>
                      Form: {row().formLabel}
                    </Show>
                  </td>
                  <Show when={props.showEventColumn}><td>{row().eventLabel}</td></Show>
                  <td>
                    <Show when={row().defined} fallback={<span class="muted small">not defined in this project</span>}>
                      {row().label}
                    </Show>
                  </td>
                  <td>{props.renderState(row)}</td>
                  <td class="expr">
                    <For each={row().logicTexts}>{(text) => props.renderLogicText(text, row)}</For>
                    <Show when={row().logicNote}><div class="muted">{row().logicNote}</div></Show>
                  </td>
                  <td>
                    <For each={row().needs} keyed={inputKey}>{(input) => props.renderNeed(input, row)}</For>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      </Show>
    </div>
  );
}
