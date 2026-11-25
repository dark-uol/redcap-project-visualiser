import { createMemo } from 'solid-js';
import { withFlags } from '../../lib/flags';
import { need, model, filters } from '../../store';
import { FormsSectionView } from './FormsSectionView';
import type { FormRow } from './FormsSectionView';

const { formQ, setFormQ, formsOn, setFormsOn } = filters;

/** Connector: the form list from the model, filtered by the search box, with ticks written back to the store. */
export default function FormsSection() {
  // Rows depend only on the model, so they keep their identity while the ticks and the search change.
  const forms = createMemo((): FormRow[] => need(model()).parsed.forms.map((form) => ({ id: form.id, label: form.label, fieldCount: form.fields.length })));
  const shownForms = createMemo((): FormRow[] => {
    const query = formQ().toLowerCase().trim();
    return forms().filter((form) => !query || (form.label + ' ' + form.id).toLowerCase().includes(query));
  });
  const checkedById = createMemo((): Record<string, boolean> => {
    const on = formsOn();
    return Object.fromEntries(forms().map((form) => [form.id, on[form.id] !== false]));
  });

  // all / none apply to the forms currently listed (so you can search, then select the matches)
  const setForms = (value: boolean): void => {
    setFormsOn(withFlags(formsOn(), shownForms().map((form) => form.id), value));
  };
  const onAllForms = function onAllForms(): void { setForms(true); };
  const onNoForms = function onNoForms(): void { setForms(false); };
  const onQueryInput = function onQueryInput(value: string): void {
    setFormQ(value);
  };
  const onFormToggle = function onFormToggle(formId: string, checked: boolean): void {
    setFormsOn(withFlags(formsOn(), [formId], checked));
  };

  return (
    <FormsSectionView
      query={formQ()}
      forms={shownForms()}
      checkedById={checkedById()}
      onQueryInput={onQueryInput}
      onAllForms={onAllForms}
      onNoForms={onNoForms}
      onFormToggle={onFormToggle}
    />
  );
}
