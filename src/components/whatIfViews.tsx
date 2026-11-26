/* Presentational what-if widgets: state badge, coloured logic text and the type-matched value inputs. They take plain values and callbacks and never touch the store. */
import { For, Show } from 'solid-js';
import type { ExplainedPart, Visibility, WhatIfValue } from '../lib/whatIf';
import type { Choice, Field } from '../lib/types';

const SELECT_TYPES = new Set(['radio', 'select', 'dropdown', 'yesno', 'truefalse', 'form_status']);
export const STATE_ORDER = [['shown', 'Shown'], ['hidden', 'Hidden'], ['unknown', 'Unknown']] as const;

export function choicesFor(field: Field): Choice[] {
  if (field.choices.length) return field.choices;
  if (field.type === 'yesno') return [{ code: '1', label: 'Yes' }, { code: '0', label: 'No' }];
  if (field.type === 'truefalse') return [{ code: '1', label: 'True' }, { code: '0', label: 'False' }];
  return [];
}

export type StateBadgeViewProps = { state: Visibility; tooltip: string };

/** Presentational: a state word coloured by state, with the reasons as its tooltip. */
export function StateBadgeView(props: StateBadgeViewProps) {
  return <span class={'wi-state ' + props.state} title={props.tooltip}>{props.state}</span>;
}

/** Presentational: a note beside the state of a hidden field that has a value set, saying the value counts for nothing while it is hidden. */
export function IgnoredValueHintView() {
  return (
    <span class="wi-ignored muted small" title="This field is hidden, so other logic reads it as blank. The value set here is not used.">
      value ignored
    </span>
  );
}

const PART_TITLES ={ true: 'true', false: 'false', unknown: 'not decided yet' } as const;

export type LogicTextViewProps = { parts: ExplainedPart[] };

/** Presentational: a condition with each top-level and/or operand coloured by its result. */
export function LogicTextView(props: LogicTextViewProps) {
  const outcome = (part: ExplainedPart): keyof typeof PART_TITLES => (part.result === undefined ? 'unknown' : part.result ? 'true' : 'false');
  return (
    <div>
      <For each={props.parts}>
        {(part) => (
          <>
            <Show when={part.joiner}><span class="wi-joiner"> {part.joiner} </span></Show>
            <span class={'wi-part ' + outcome(part)} title={PART_TITLES[outcome(part)]}>{part.text}</span>
          </>
        )}
      </For>
    </div>
  );
}

export type SmartValueInputViewProps = {
  value: string;
  compact?: boolean;
  /** Called with the trimmed text, or null when it is empty (which removes the value). */
  onChange: (value: string | null) => void;
};

/** Presentational: a text input for a smart variable's value. */
export function SmartValueInputView(props: SmartValueInputViewProps) {
  const onTextChange = function onTextChange(event: Event & { currentTarget: HTMLInputElement }): void {
    const trimmed = event.currentTarget.value.trim();
    props.onChange(trimmed === '' ? null : trimmed);
  };
  return <input type="text" class={props.compact ? 'wi-compact' : ''} value={props.value} onChange={onTextChange} placeholder="value" />;
}

export type ValueInputViewProps = {
  field: Field;
  /** The value set for the field: a string, the checked codes of a checkbox field, or undefined when unset. */
  value: WhatIfValue | undefined;
  /** Whether the field's form is not used in the event the value is for. */
  formUnused: boolean;
  /** Compact is for tables. */
  compact?: boolean;
  onChange: (value: WhatIfValue) => void;
};

/** Presentational: the input for a field's value, matched to the field's type (checkboxes, a select, or text). */
export function ValueInputView(props: ValueInputViewProps) {
  const currentText = (): string => (typeof props.value === 'string' ? props.value : '');
  const checkedCodes = (): string[] => (Array.isArray(props.value) ? props.value : []);
  const onSelectChange = function onSelectChange(event: Event & { currentTarget: HTMLSelectElement }): void {
    props.onChange(event.currentTarget.value);
  };
  const onTextChange = function onTextChange(event: Event & { currentTarget: HTMLInputElement }): void {
    props.onChange(event.currentTarget.value.trim());
  };
  const toggleCode = function toggleCode(code: string, on: boolean): void {
    const codes = checkedCodes().filter((checked) => checked !== code);
    if (on) codes.push(code);
    props.onChange(codes);
  };
  const choices = (): Choice[] => choicesFor(props.field);
  const textInput = () => <input type="text" class={props.compact ? 'wi-compact' : ''} value={currentText()} onChange={onTextChange} placeholder="value" />;
  return (
    <div class="wi-value">
      <Show when={props.formUnused}><div class="muted small">This form is not used in this event</div></Show>
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
