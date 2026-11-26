/* What if tab: one editable table of the values set (fields and smart variables, each with the event its value is for), then the explored field's state, what decides whether it is shown and what it affects. */
import { Show, createMemo, createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';
import { ANY_EVENT, controllersOf, dependentsOf, derivedValue, eventForField, eventsForField, eventsToEvaluate, isSmartKey, valueIsIgnored } from '../lib/whatIf';
import type { MissingInput, Visibility, VisibilityInfo } from '../lib/whatIf';
import type { Field, Model, WhatIfEngine } from '../lib/types';
import { computeVisibilityLogic, chooserMatches, derivationOf, displayRows, nextExploredRow, rowKeyOf, setValueText, smartVariableNames } from '../lib/whatIfRows';
import type { ChooserMatch, TableRow } from '../lib/whatIfRows';
import { need, model, selection, whatIf, visibilityIn, formLabel } from '../store';
import { IgnoredValueHintView } from './whatIfViews';
import { LogicText, SmartValueInput, StateBadge, ValueInput, editField, eventLabel, missingText } from './whatIfParts';
import { FieldEditorView, ValuesTableView, VisibilityTableView } from './WhatIfTabViews';
import type { ValuesRow, VisibilityRow } from './WhatIfTabViews';

const FORM_PREFIX = 'form:';
const MAX_MATCHES = 20;

const loadedEvents = () => need(model()).parsed.events || [];
const fieldFor = (variable: string | null): Field | undefined => (variable === null ? undefined : need(model()).byVar.get(variable));

/** The logic depends only on the model, so it is worked out once per row and event and reused while values change. */
const visibilityLogicCache = new WeakMap<Model, Map<string, { main: string[]; note: string }>>();
function visibilityLogic(id: string, event: string | null): { main: string[]; note: string } {
  const loadedModel = need(model());
  let cache = visibilityLogicCache.get(loadedModel);
  if (!cache) visibilityLogicCache.set(loadedModel, cache = new Map());
  const key = id + '|' + (event ?? '');
  let logic = cache.get(key);
  if (!logic) cache.set(key, logic = computeVisibilityLogic(loadedModel, id, event));
  return logic;
}

const isExploredRow = (row: TableRow): boolean => row.variable === whatIf.field() && row.event === whatIf.event();

/** The rows as listed: the ones the user added, in order, then any value set elsewhere (the Needs inputs) that no row lists yet. */
function displayRowsOf(): TableRow[] {
  return displayRows(whatIf.rows(), whatIf.values(), loadedEvents().map((event) => event.id));
}

/** The values table: wires the rows, the chooser and the mode to the what-if state, and renders ValuesTableView. */
function ValuesTable() {
  const [query, setQuery] = createSignal('');
  const [listOpen, setListOpen] = createSignal(true);
  // smart variables the project's logic uses (the derived ones follow from the event and are not offered)
  const smartNames = createMemo(() => smartVariableNames(need(model())));
  const matches = createMemo<ChooserMatch[]>(() => chooserMatches(need(model()), query(), smartNames(), formLabel, MAX_MATCHES));
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
  const changeQuery = function changeQuery(next: string): void {
    setQuery(next);
    setListOpen(true);
  };
  const onClearAll = function onClearAll(): void {
    whatIf.clearValues();
    whatIf.setField(null);
  };
  const exploreRow = function exploreRow(row: TableRow): void {
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
      ? nextExploredRow(displayRowsOf(), row, (variable) => fieldFor(variable) !== undefined)
      : undefined;
    const explored = isExploredRow(row);
    whatIf.removeRow(row.variable, row.event);
    // the explored row is gone: explore the next field still listed, so the sections below never go blank while rows remain
    if (explored) {
      if (next) editField(next.variable, next.event);
      else whatIf.setField(null);
    }
  };
  const setMode = function setMode(mode: 'form' | 'survey'): void { whatIf.setMode(mode); };
  const setEngine = function setEngine(engine: WhatIfEngine): void { whatIf.setEngine(engine); };
  const engineStatus = function engineStatus(): string {
    if (whatIf.engine() !== 'python') return '';
    const status = whatIf.pythonStatus();
    if (status.kind === 'loading') return 'Loading Python…';
    if (status.kind === 'ready') return 'Python ' + status.version;
    if (status.kind === 'error') return 'Python failed to load: ' + status.message;
    return '';
  };
  const rows = (): ValuesRow[] => displayRowsOf().map((row): ValuesRow => {
    const field = fieldFor(row.variable);
    const isSmart = isSmartKey(row.variable);
    const eventIds = isSmart ? loadedEvents().map((event) => event.id) : eventsForField(need(model()), row.variable);
    return {
      key: rowKeyOf(row),
      variable: row.variable,
      event: row.event,
      explored: isExploredRow(row),
      explorable: field !== undefined,
      isSmart,
      showEventSelect: isSmart || eventIds.length > 1,
      eventOptionIds: eventIds,
      eventText: row.event === null ? '' : eventLabel(row.event),
      labelKind: isSmart ? 'smart' : field ? 'label' : 'undefined',
      label: field?.label ?? '',
    };
  });
  const renderValue = (row: Accessor<ValuesRow>) => (
    <Show when={!row().isSmart} fallback={<SmartValueInput variable={row().variable} event={row().event} compact />}>
      <Show when={fieldFor(row().variable)} keyed>{(defined) => <ValueInput field={defined} event={row().event} compact />}</Show>
    </Show>
  );
  const hasValueInRow = (row: ValuesRow): boolean => whatIf.values()[row.event ?? ANY_EVENT]?.[row.variable] !== undefined;
  const renderState = (row: Accessor<ValuesRow>) => (
    <Show when={!row().isSmart && row().explorable}>
      <StateBadge info={visibilityIn(row().event, true)?.get(row().variable)} />
      <Show when={hasValueInRow(row()) && valueIsIgnored(visibilityIn(row().event, true)?.get(row().variable))}><IgnoredValueHintView /></Show>
    </Show>
  );
  return (
    <ValuesTableView
      rows={rows()}
      showEventColumn={loadedEvents().length > 0}
      eventLabelOf={eventLabel}
      clearCount={whatIf.valueCount() || whatIf.rows().length ? displayRowsOf().length : null}
      mode={whatIf.mode()}
      engine={whatIf.engine()}
      engineStatus={engineStatus()}
      derive={whatIf.derive()}
      onDeriveChange={whatIf.setDerive}
      query={query()}
      matches={matches()}
      listOpen={listOpen()}
      onModeChange={setMode}
      onEngineChange={setEngine}
      onClearAll={onClearAll}
      onExploreRow={exploreRow}
      onChangeEvent={changeEvent}
      onRemoveRow={removeTableRow}
      onQueryChange={changeQuery}
      onChooseMatch={choose}
      renderValue={renderValue}
      renderState={renderState}
    />
  );
}

/** The explored field's heading, wired to the what-if event and the graph tab. */
function FieldEditor(props: { field: Field }) {
  const showInGraph = function showInGraph(): void {
    selection.setSelected(props.field.variable);
    selection.setTab('graph');
  };
  return (
    <FieldEditorView
      variable={props.field.variable}
      label={props.field.label}
      eventLabel={loadedEvents().length && whatIf.event() ? eventLabel(whatIf.event() as string) : null}
      stateBadge={<StateBadge info={visibilityIn(whatIf.event(), true)?.get(props.field.variable)} />}
      onShowInGraph={showInGraph}
    />
  );
}

interface AffectedRow {
  id: string;
  event: string | null;
  info: VisibilityInfo | undefined;
  /** The value worked out for a calculated or defaulted field in this row's event, when there is one. */
  derived: string | undefined;
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
      const results = visibilityIn(event, true);
      const info = results?.get(entry.id);
      return { id: entry.id, event, info, derived: derivedValue(results, entry.id), state: info?.state ?? 'unknown', step: entry.step };
    }));
}
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

/** A table of fields/forms with their state under the current values. Rows stay in the order given, so none jump when a value changes. */
function VisibilityTable(props: { title: string; emptyText: string; rows: AffectedRow[]; excludedInput: Field; showStep?: boolean }) {
  /** The inputs a row still needs, minus the edited field itself in its own event, which has its input above. */
  const needsOf = (row: AffectedRow): MissingInput[] =>
    (row.info?.missing ?? []).filter((input) => !(input.variable === props.excludedInput.variable && input.event === whatIf.event()));
  const viewRows = createMemo((): VisibilityRow[] => props.rows.map((row): VisibilityRow => {
    const isForm = row.id.startsWith(FORM_PREFIX);
    const formId = formOf(row.id);
    const logic = visibilityLogic(row.id, row.event);
    const how = whatIf.derive() ? derivationOf(fieldFor(row.id)) : { kind: '' as const, text: '' };
    // a value you set wins over one worked out, as it does in the evaluation
    const setValue = isForm ? undefined : setValueText(whatIf.values()[row.event ?? ANY_EVENT]?.[row.id] ?? whatIf.values()[ANY_EVENT]?.[row.id]);
    return {
      key: rowKey(row),
      id: row.id,
      event: row.event,
      eventLabel: row.event === null ? '' : eventLabel(row.event),
      state: row.state,
      info: row.info,
      step: row.step,
      formId,
      formLabel: formId === undefined ? '' : formLabel(isForm ? row.id.slice(FORM_PREFIX.length) : formId),
      kind: isForm ? 'form' : isDefined(row.id) ? 'field' : 'undefined',
      label: isForm ? '' : fieldFor(row.id)?.label ?? '',
      defined: isDefined(row.id),
      logicTexts: logic.main,
      logicNote: logic.note,
      needs: needsOf(row),
      value: setValue ?? row.derived ?? '',
      valueKind: setValue !== undefined ? 'set' : row.derived !== undefined && how.kind !== '' ? how.kind : '',
      derivation: how.text,
    };
  }));
  const editRow = function editRow(row: VisibilityRow): void {
    editField(row.id, row.event);
  };
  const toggleCollapsed = function toggleCollapsed(): void {
    whatIf.toggleSection(props.title);
  };
  const renderLogicText = (text: string, row: Accessor<VisibilityRow>) => <LogicText text={text} event={row().event} />;
  const renderNeed = (input: Accessor<MissingInput>, row: Accessor<VisibilityRow>) => <NeedControl input={input()} rowEvent={row().event} />;
  const renderState = (row: Accessor<VisibilityRow>) => <StateBadge info={row().info} />;
  return (
    <VisibilityTableView
      title={props.title}
      emptyText={props.emptyText}
      rows={viewRows()}
      showStep={props.showStep}
      showEventColumn={loadedEvents().length > 0}
      collapsed={!!whatIf.collapsed()[props.title]}
      onToggleCollapsed={toggleCollapsed}
      onEditField={editRow}
      renderLogicText={renderLogicText}
      renderNeed={renderNeed}
      renderState={renderState}
    />
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
      // with Calculate on, a calculated controller is followed into its inputs, so the steps of a chain show
      ...controllersOf(loadedModel, props.field.variable, whatIf.derive()).map((controller) => ({ id: controller.variable, step: controller.depth })),
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
