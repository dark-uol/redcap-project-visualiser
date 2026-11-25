/* Connected what-if pieces shared by the What if tab and the field detail: event labels, state badge, logic text and value inputs, wired to the store and rendered by the views in whatIfViews. */
import { Show } from 'solid-js';
import { ANY_EVENT, eventForField, eventsToEvaluate, explainLogic } from '../lib/whatIf';
import type { ExplainedPart, MissingInput, VisibilityInfo, WhatIfValue } from '../lib/whatIf';
import type { Field } from '../lib/types';
import { need, model, whatIf, visibilityIn } from '../store';
import { LogicTextView, SmartValueInputView, StateBadgeView, ValueInputView } from './whatIfViews';

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
  return <StateBadgeView state={props.info?.state ?? 'unknown'} tooltip={tooltipFor(props.info)} />;
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

/** A condition with each top-level and/or operand coloured by its result in `event`, so the part that decides it stands out. */
export function LogicText(props: { text: string; event: string | null }) {
  const parts = (): ExplainedPart[] => {
    const results = visibilityIn(props.event, true);
    if (!results) return [{ joiner: '', text: props.text, result: undefined }];
    return explainLogic(need(model()), { values: whatIf.values(), mode: whatIf.mode(), event: props.event }, results, props.text);
  };
  return <LogicTextView parts={parts()} />;
}

/** A text input for a smart variable's value (`variable` is its bracketed key, e.g. `[user-role-label]`); an empty value removes it. */
export function SmartValueInput(props: { variable: string; event: string | null; compact?: boolean }) {
  const currentText = (): string => { const value = bucketFor(props.event)[props.variable]; return Array.isArray(value) ? value.join(',') : value ?? ''; };
  const setValue = function setValue(value: string | null): void {
    whatIf.setValueIn(props.event, props.variable, value);
  };
  return <SmartValueInputView value={currentText()} compact={props.compact} onChange={setValue} />;
}

/** The input for a field's value in one event's bucket (null = the project has no events), matched to the field's type. `compact` is for tables. */
export function ValueInput(props: { field: Field; event: string | null; compact?: boolean }) {
  const formUnused = (): boolean => {
    const definition = props.event === null ? undefined : (need(model()).parsed.events || []).find((candidate) => candidate.id === props.event);
    return !!definition && !definition.forms.includes(props.field.form);
  };
  const setValue = function setValue(value: WhatIfValue): void {
    whatIf.setValueIn(props.event, props.field.variable, value);
  };
  return <ValueInputView field={props.field} value={bucketFor(props.event)[props.field.variable]} formUnused={formUnused()} compact={props.compact} onChange={setValue} />;
}
