/* Pieces shared by the What if tab and the field detail: event labels, state badge and tooltip, the type-matched value input. */
import { For, Show } from 'solid-js';
import { ANY_EVENT, eventsToEvaluate } from '../lib/whatIf';
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

const selectedBucket = (): Readonly<Record<string, WhatIfValue>> => whatIf.values()[whatIf.event() ?? ANY_EVENT] ?? {};
const anyBucket = (): Readonly<Record<string, WhatIfValue>> => whatIf.values()[ANY_EVENT] ?? {};
/** True when the selected event's bucket or the any-event bucket holds a value for the variable. */
export const hasValueFor = (variable: string): boolean => variable in selectedBucket() || variable in anyBucket();

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

export function ValueInput(props: { field: Field }) {
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
