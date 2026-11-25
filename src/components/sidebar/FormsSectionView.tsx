import { For } from 'solid-js';
import { createHint, HintToggle, HintText } from '../controls';
import { stopClick } from './stopClick';

/** One listed form, with its label already formatted for display. */
export type FormRow = { id: string; label: string; fieldCount: number };

export type FormsSectionViewProps = {
  /** The search box text. */
  query: string;
  /** The forms currently listed (already filtered by the query). */
  forms: FormRow[];
  /** Whether each form is ticked, keyed by form id. */
  checkedById: Record<string, boolean>;
  onQueryInput: (value: string) => void;
  /** Ticks every listed form. */
  onAllForms: () => void;
  /** Unticks every listed form. */
  onNoForms: () => void;
  onFormToggle: (formId: string, checked: boolean) => void;
};

/** Presentational: the form search box and the ticked list of forms. Owns only the hint's open/closed state. */
export function FormsSectionView(props: FormsSectionViewProps) {
  const help = createHint();
  const onAllForms = stopClick(function onAllForms(): void { props.onAllForms(); });
  const onNoForms = stopClick(function onNoForms(): void { props.onNoForms(); });
  const onFormSearchInput = function onFormSearchInput(event: Event & { currentTarget: HTMLInputElement }): void {
    props.onQueryInput(event.currentTarget.value);
  };

  const formToggleHandler = (formId: string) => function onFormToggle(event: Event & { currentTarget: HTMLInputElement }): void {
    props.onFormToggle(formId, event.currentTarget.checked);
  };

  return (
    <details class="sec">
      <summary><h2>Forms <button class="link" onClick={onAllForms}>all</button> <button class="link" onClick={onNoForms}>none</button> <HintToggle help={help} title="Forms" /></h2></summary>
      <HintText help={help}>Keeps only the ticked forms. All and none apply to the forms currently listed, so you can search first and then select the matches. The number is how many fields the form has.</HintText>
      <input type="search" class="formsearch" placeholder="Search forms…" value={props.query} onInput={onFormSearchInput} />
      <div id="forms">
        <For each={props.forms}>
          {(form) => (
            <label class="chk"><input type="checkbox" checked={props.checkedById[form.id]} onChange={formToggleHandler(form.id)} /> {form.label} <span class="muted small">({form.fieldCount})</span></label>
          )}
        </For>
      </div>
    </details>
  );
}
