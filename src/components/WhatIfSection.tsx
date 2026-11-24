/* "What if…" section of the field detail: pick a value for the field and see which dependents it would show or hide. */
import { For, Show } from 'solid-js';
import { ANY_EVENT, dependentsOf, eventsToEvaluate } from '../lib/whatIf';
import type { MissingInput, VisibilityInfo, WhatIfValue } from '../lib/whatIf';
import type { Choice, Field } from '../lib/types';
import { need, model, selection, whatIf, visibility, visibilityIn, formLabel } from '../store';

const { setSelected } = selection;

const FORM_PREFIX = 'form:';
const SELECT_TYPES = new Set(['radio', 'select', 'dropdown', 'yesno', 'truefalse', 'form_status']);
const STATE_ORDER = [['shown', 'Shown'], ['hidden', 'Hidden'], ['unknown', 'Unknown']] as const;

function choicesFor(field: Field): Choice[] {
  if (field.choices.length) return field.choices;
  if (field.type === 'yesno') return [{ code: '1', label: 'Yes' }, { code: '0', label: 'No' }];
  if (field.type === 'truefalse') return [{ code: '1', label: 'True' }, { code: '0', label: 'False' }];
  return [];
}

/** The event's label, with its arm added when another event shares the label (Follow-up in arm 1 and arm 2). */
const eventLabel = (id: string): string => {
  const events = need(model()).parsed.events || [];
  const event = events.find((candidate) => candidate.id === id);
  if (!event) return id;
  const shared = events.some((other) => other.id !== id && other.label === event.label);
  return shared ? event.label + ' (' + (event.armName || 'arm ' + event.arm) + ')' : event.label;
};

function missingText(input: MissingInput): string {
  return input.event === null || input.event === whatIf.event() ? input.variable : input.variable + ' @ ' + eventLabel(input.event);
}

const selectedBucket = (): Readonly<Record<string, WhatIfValue>> => whatIf.values()[whatIf.event() ?? ANY_EVENT] ?? {};
const anyBucket = (): Readonly<Record<string, WhatIfValue>> => whatIf.values()[ANY_EVENT] ?? {};
/** True when the selected event's bucket or the any-event bucket holds a value for the variable. */
const hasValueFor = (variable: string): boolean => variable in selectedBucket() || variable in anyBucket();

function tooltipFor(info: VisibilityInfo | undefined): string {
  if (!info) return 'Set a value to evaluate';
  const lines = [...info.reasons];
  if (info.missing.length) lines.push('needs: ' + info.missing.map(missingText).join(', '));
  return lines.join('\n');
}

/** True when the section has something to show for this field: dependents, or a value already set. */
export function hasWhatIf(field: Field): boolean {
  return hasValueFor(field.variable) || dependentsOf(need(model()), field.variable).length > 0;
}

/** One-line badge for the field heading: this field's own state under the current what-if values. */
export function WhatIfBadge(props: { variable: string }) {
  const info = (): VisibilityInfo | undefined => visibility()?.get(props.variable);
  const worthShowing = (): boolean => hasValueFor(props.variable) || (info() !== undefined && info()?.state !== 'shown');
  return (
    <Show when={worthShowing() && info()}>
      <div class="small" style="margin:4px 0">What-if: <span class={'wi-state ' + info()?.state} title={tooltipFor(info())}>{info()?.state}</span></div>
    </Show>
  );
}

function ValueInput(props: { field: Field }) {
  const inherited = (): WhatIfValue | undefined => {
    if (whatIf.event() === null || props.field.variable in selectedBucket()) return undefined;
    return anyBucket()[props.field.variable];
  };
  /** Other events (not the selected one, nor any-event) holding a value for this field, as "label: value". */
  const setElsewhere = (): string[] => Object.entries(whatIf.values())
    .filter(([event, bucket]) => event !== ANY_EVENT && event !== whatIf.event() && props.field.variable in bucket)
    .map(([event, bucket]) => eventLabel(event) + ': ' + String(bucket[props.field.variable]));
  const formUnused = (): boolean => {
    const selected = whatIf.event();
    const definition = selected === null ? undefined : (need(model()).parsed.events || []).find((candidate) => candidate.id === selected);
    return !!definition && !definition.forms.includes(props.field.form);
  };
  return (
    <div>
      <Show when={formUnused()}><div class="muted small">This form is not used in the selected event</div></Show>
      <ValueControl field={props.field} />
      <Show when={inherited() !== undefined}>
        <div class="muted small">applies from (any event): {String(inherited())}</div>
      </Show>
      <Show when={setElsewhere().length}>
        <div class="muted small">also set in: {setElsewhere().join(', ')}</div>
      </Show>
    </div>
  );
}

function ValueControl(props: { field: Field }) {
  const variable = props.field.variable;
  const current = (): WhatIfValue | undefined => selectedBucket()[variable];
  const currentText = (): string => { const value = current(); return typeof value === 'string' ? value : ''; };
  const checkedCodes = (): string[] => { const value = current(); return Array.isArray(value) ? value : []; };
  const onSelectChange = function onSelectChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setValue(variable, event.currentTarget.value);
  };
  const onTextChange = function onTextChange(event: Event & { currentTarget: HTMLInputElement }): void {
    whatIf.setValue(variable, event.currentTarget.value.trim());
  };
  const toggleCode = function toggleCode(code: string, on: boolean): void {
    const codes = checkedCodes().filter((x) => x !== code);
    if (on) codes.push(code);
    whatIf.setValue(variable, codes);
  };
  const choices = choicesFor(props.field);
  if (props.field.calc) {
    return (
      <div>
        <input type="text" value={currentText()} onChange={onTextChange} placeholder="value" />
        <div class="muted small">Calculated field: the value you enter overrides the calculation.</div>
      </div>
    );
  }
  if (props.field.type === 'checkbox' && choices.length) {
    return (
      <div class="wi-checks">
        <For each={choices}>
          {(choice) => (
            <label class="chk"><input type="checkbox" checked={checkedCodes().includes(choice.code)} onChange={(e) => toggleCode(choice.code, e.currentTarget.checked)} /> {choice.code}, {choice.label}</label>
          )}
        </For>
      </div>
    );
  }
  if (SELECT_TYPES.has(props.field.type) && choices.length) {
    return (
      <select onChange={onSelectChange}>
        <option value="" selected={currentText() === ''}>(not set)</option>
        <For each={choices}>{(choice) => <option value={choice.code} selected={currentText() === choice.code}>{choice.code}, {choice.label}</option>}</For>
      </select>
    );
  }
  return <input type="text" value={currentText()} onChange={onTextChange} placeholder="value" />;
}

function DependentChip(props: { id: string; event: string | null }) {
  const isForm = props.id.startsWith(FORM_PREFIX);
  const label = isForm ? formLabel(props.id.slice(FORM_PREFIX.length)) : props.id;
  const target = isForm ? props.id.slice(FORM_PREFIX.length) : props.id;
  const info = (): VisibilityInfo | undefined => visibilityIn(props.event)?.get(props.id);
  const state = (): string => info()?.state ?? 'unknown';
  const tip = (): string => (visibility() ? tooltipFor(info()) : 'Set a value to evaluate');
  return <button class={'chip wi-chip ' + state()} title={tip()} onClick={() => setSelected(target)}>{label}</button>;
}

interface EventSection {
  /** The event the dependents are judged in (null = no event selected). */
  event: string | null;
  groups: { title: string; ids: string[] }[];
}

export default function WhatIfSection(props: { field: Field }) {
  const events = () => need(model()).parsed.events || [];
  const dependents = () => dependentsOf(need(model()), props.field.variable);
  // each dependent is judged where it lives: the selected event if its form is used there, else each event its form is used in
  const sections = (): EventSection[] => {
    const loadedModel = need(model());
    const selected = whatIf.event();
    const byEvent = new Map<string | null, string[]>();
    dependents().forEach((id) => eventsToEvaluate(loadedModel, id, selected).forEach((event) => {
      byEvent.set(event, [...(byEvent.get(event) ?? []), id]);
    }));
    const order = (event: string | null): number => (event === selected ? -1 : events().findIndex((candidate) => candidate.id === event));
    return [...byEvent.entries()].sort((left, right) => order(left[0]) - order(right[0])).map(([event, ids]) => {
      const info = visibilityIn(event);
      const groups = STATE_ORDER
        .map(([state, title]) => ({ title, ids: ids.filter((id) => (info?.get(id)?.state ?? 'unknown') === state) }))
        .filter((group) => group.ids.length);
      return { event, groups };
    });
  };
  const sectionTitle = (section: EventSection): string =>
    section.event === null ? '' : (section.event === whatIf.event() ? 'In this event' : 'In ' + eventLabel(section.event));
  const showSectionTitles = (): boolean => sections().some((section) => section.event !== whatIf.event());
  const valueCount = (): number => whatIf.valueCount();
  const onModeChange = function onModeChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setMode(event.currentTarget.value === 'survey' ? 'survey' : 'form');
  };
  const onEventChange = function onEventChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setEvent(event.currentTarget.value || null);
  };
  return (
    <div class="whatif">
      <h4>What if…</h4>
      <ValueInput field={props.field} />
      <div class="wi-row small">
        <Show when={events().length}>
          <span class="muted">Event</span>
          <select title="Event the values are entered in" onChange={onEventChange}>
            <option value="" selected={whatIf.event() === null}>(any event)</option>
            <For each={events()}>{(event) => <option value={event.id} selected={whatIf.event() === event.id}>{eventLabel(event.id)}</option>}</For>
          </select>
        </Show>
        <select title="Evaluate as a survey or as data entry" onChange={onModeChange}>
          <option value="form" selected={whatIf.mode() === 'form'}>data entry</option>
          <option value="survey" selected={whatIf.mode() === 'survey'}>survey</option>
        </select>
        <Show when={valueCount()}>
          <button class="btn sm" onClick={() => whatIf.clearValues()}>Clear all ({valueCount()})</button>
        </Show>
      </div>
      <Show when={!visibility() && dependents().length}>
        <div class="muted small">Set a value to evaluate</div>
      </Show>
      <For each={sections()}>
        {(section) => (
          <div class="wi-event">
            <Show when={showSectionTitles()}><div class="small wi-event-title">{sectionTitle(section)}</div></Show>
            <For each={section.groups}>
              {(group) => (
                <div class="wi-group"><div class="small muted">{group.title} ({group.ids.length})</div>
                  <div class="chips"><For each={group.ids}>{(id) => <DependentChip id={id} event={section.event} />}</For></div></div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
