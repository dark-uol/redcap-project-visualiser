/* Pieces shared by the What if tab and the field detail: event labels, state badge and tooltip, the type-matched value input. */
import { For, Show } from 'solid-js';
import { ANY_EVENT, eventForField, eventsToEvaluate } from '../lib/whatIf';
import type { MissingInput, VisibilityInfo, WhatIfValue } from '../lib/whatIf';
import type { Choice, Field } from '../lib/types';
import { need, model, whatIf, visibility, visibilityIn } from '../store';

const SELECT_TYPES = new Set(['radio', 'select', 'dropdown', 'yesno', 'truefalse', 'form_status']);
export const STATE_ORDER = [['shown', 'Shown'], ['hidden', 'Hidden'], ['unknown', 'Unknown']] as const;

export function choicesFor(field: Field): Choice[] {
  if (field.choices.length) return field.choices;
  if (field.type === 'yesno') return [{ code: '1', label: 'Yes' }, { code: '0', label: 'No' }];
  if (field.type === 'truefalse') return [{ code: '1', label: 'True' }, { code: '0', label: 'False' }];
  return [];
}

/** The event's label, with its arm added when another event shares the label (Follow-up in arm 1 and arm 2). */
export const eventLabel = (id: string): string => {
  const events = need(model()).parsed.events || [];
  const event = events.find((candidate) => candidate.id === id);
  if (!event) return id;
  const shared = events.some((other) => other.id !== id && other.label === event.label);
  return shared ? event.label + ' (' + (event.armName || 'arm ' + event.arm) + ')' : event.label;
};

/** The input as text: the bare variable when it lives in `relativeTo` (or in no particular event), else `variable @ event label`. */
export function missingText(input: MissingInput, relativeTo: string | null): string {
  return input.event === null || input.event === relativeTo ? input.variable : input.variable + ' @ ' + eventLabel(input.event);
}

const bucketFor = (event: string | null): Readonly<Record<string, WhatIfValue>> => whatIf.values()[event ?? ANY_EVENT] ?? {};
/** True when a value is set for the variable in the selected event. */
export const hasValueFor = (variable: string): boolean => variable in bucketFor(whatIf.event());

/** Make a field the one being edited. Its event is `event` (the current one when omitted) if the field's form is used there, else the first event it is used in. */
export function editField(variable: string, event?: string | null): void {
  whatIf.setField(variable);
  whatIf.setEvent(eventForField(need(model()), variable, event === undefined ? whatIf.event() : event));
}

export function tooltipFor(info: VisibilityInfo | undefined): string {
  if (!info) return 'Set a value to evaluate';
  const lines = [...info.reasons];
  if (info.missing.length) lines.push('needs: ' + info.missing.map((input) => missingText(input, whatIf.event())).join(', '));
  return lines.join('\n');
}

/** A field's (or form's) state under the current what-if values, with the reasons as tooltip. */
export function StateBadge(props: { info: VisibilityInfo | undefined }) {
  return <span class={'wi-state ' + (props.info?.state ?? 'unknown')} title={tooltipFor(props.info)}>{props.info?.state ?? 'unknown'}</span>;
}

/** One-line badge for the field heading: this field's own state under the current what-if values. */
export function WhatIfBadge(props: { variable: string }) {
  // judged where the field lives: the selected event if its form is used there, else the first event it is used in
  const info = (): VisibilityInfo | undefined => {
    const event = eventsToEvaluate(need(model()), props.variable, whatIf.event())[0] ?? null;
    return visibilityIn(event)?.get(props.variable);
  };
  const worthShowing = (): boolean => hasValueFor(props.variable) || (info() !== undefined && info()?.state !== 'shown');
  return (
    <Show when={worthShowing() && info()}>
      <span class="small">What-if: <StateBadge info={info()} /></span>
    </Show>
  );
}

/** A text input for a smart variable's value (`variable` is its bracketed key, e.g. `[user-role-label]`); an empty value removes it. */
export function SmartValueInput(props: { variable: string; event: string | null; compact?: boolean }) {
  const currentText = (): string => { const value = bucketFor(props.event)[props.variable]; return Array.isArray(value) ? value.join(',') : value ?? ''; };
  const onTextChange = function onTextChange(event: Event & { currentTarget: HTMLInputElement }): void {
    const trimmed = event.currentTarget.value.trim();
    whatIf.setValueIn(props.event, props.variable, trimmed === '' ? null : trimmed);
  };
  return <input type="text" class={props.compact ? 'wi-compact' : ''} value={currentText()} onChange={onTextChange} placeholder="value" />;
}

/** The input for a field's value in one event's bucket (null = the project has no events), matched to the field's type. `compact` is for tables. */
export function ValueInput(props: { field: Field; event: string | null; compact?: boolean }) {
  const variable = (): string => props.field.variable;
  const current = (): WhatIfValue | undefined => bucketFor(props.event)[variable()];
  const currentText = (): string => { const value = current(); return typeof value === 'string' ? value : ''; };
  const checkedCodes = (): string[] => { const value = current(); return Array.isArray(value) ? value : []; };
  const formUnused = (): boolean => {
    const definition = props.event === null ? undefined : (need(model()).parsed.events || []).find((candidate) => candidate.id === props.event);
    return !!definition && !definition.forms.includes(props.field.form);
  };
  const onSelectChange = function onSelectChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    whatIf.setValueIn(props.event, variable(), event.currentTarget.value);
  };
  const onTextChange = function onTextChange(event: Event & { currentTarget: HTMLInputElement }): void {
    whatIf.setValueIn(props.event, variable(), event.currentTarget.value.trim());
  };
  const toggleCode = function toggleCode(code: string, on: boolean): void {
    const codes = checkedCodes().filter((checked) => checked !== code);
    if (on) codes.push(code);
    whatIf.setValueIn(props.event, variable(), codes);
  };
  const choices = (): Choice[] => choicesFor(props.field);
  const textInput = () => <input type="text" class={props.compact ? 'wi-compact' : ''} value={currentText()} onChange={onTextChange} placeholder="value" />;
  return (
    <div class="wi-value">
      <Show when={formUnused()}><div class="muted small">This form is not used in this event</div></Show>
      <Show
        when={!props.field.calc && choices().length > 0 && props.field.type === 'checkbox'}
        fallback={
          <Show when={!props.field.calc && choices().length > 0 && SELECT_TYPES.has(props.field.type)} fallback={textInput()}>
            <select class={props.compact ? 'wi-compact' : ''} onChange={onSelectChange}>
              <option value="" selected={currentText() === ''}>(not set)</option>
              <For each={choices()}>{(choice) => <option value={choice.code} selected={currentText() === choice.code}>{choice.code}, {choice.label}</option>}</For>
            </select>
          </Show>
        }
      >
        <div class="wi-checks">
          <For each={choices()}>
            {(choice) => (
              <label class="chk"><input type="checkbox" checked={checkedCodes().includes(choice.code)} onChange={(changed) => toggleCode(choice.code, changed.currentTarget.checked)} /> {choice.code}, {choice.label}</label>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.field.calc && !props.compact}><div class="muted small">Calculated field: the value you enter overrides the calculation.</div></Show>
    </div>
  );
}
