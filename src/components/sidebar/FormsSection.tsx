import { For, createMemo } from 'solid-js';
import { withFlags } from '../../lib/flags';
import { need, model, filters } from '../../store';
import { stopClick } from './stopClick';

const { formQ, setFormQ, formsOn, setFormsOn } = filters;

export default function FormsSection() {
  const shownForms = createMemo(() => {
    const query = formQ().toLowerCase().trim();
    return need(model()).parsed.forms.filter((form) => !query || (form.label + ' ' + form.id).toLowerCase().includes(query));
  });
  // all / none apply to the forms currently listed (so you can search, then select the matches)
  const setForms = (value: boolean): void => {
    setFormsOn(withFlags(formsOn(), shownForms().map((form) => form.id), value));
  };

  const onAllForms = stopClick(function onAllForms(): void { setForms(true); });
  const onNoForms = stopClick(function onNoForms(): void { setForms(false); });
  const onFormSearchInput = function onFormSearchInput(event: Event & { currentTarget: HTMLInputElement }): void {
    setFormQ(event.currentTarget.value);
  };

  const formToggleHandler = (formId: string) => function onFormToggle(event: Event & { currentTarget: HTMLInputElement }): void {
    setFormsOn(withFlags(formsOn(), [formId], event.currentTarget.checked));
  };

  return (
    <details class="sec">
      <summary><h2>Forms <button class="link" onClick={onAllForms}>all</button> <button class="link" onClick={onNoForms}>none</button></h2></summary>
      <input type="search" class="formsearch" placeholder="Search forms…" value={formQ()} onInput={onFormSearchInput} />
      <div id="forms">
        <For each={shownForms()}>
          {(form) => (
            <label class="chk"><input type="checkbox" checked={formsOn()[form.id] !== false} onChange={formToggleHandler(form.id)} /> {form.label} <span class="muted small">({form.fields.length})</span></label>
          )}
        </For>
      </div>
    </details>
  );
}
