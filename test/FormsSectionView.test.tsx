import { describe, expect, it, vi } from 'vitest';
import { FormsSectionView } from '../src/components/sidebar/FormsSectionView';
import type { FormRow } from '../src/components/sidebar/FormsSectionView';
import { renderComponent } from './renderComponent';

const FORMS: FormRow[] = [
  { id: 'demographics', label: 'Demographics', fieldCount: 4 },
  { id: 'labs', label: 'Lab results', fieldCount: 1 },
];

function renderForms(overrides: Partial<{ query: string; forms: FormRow[]; checkedById: Record<string, boolean> }> = {}) {
  const handlers = {
    onQueryInput: vi.fn((_value: string) => {}),
    onAllForms: vi.fn(),
    onNoForms: vi.fn(),
    onFormToggle: vi.fn((_formId: string, _checked: boolean) => {}),
  };
  const container = renderComponent(() => (
    <FormsSectionView
      query={overrides.query ?? ''}
      forms={overrides.forms ?? FORMS}
      checkedById={overrides.checkedById ?? { demographics: true, labs: true }}
      onQueryInput={handlers.onQueryInput}
      onAllForms={handlers.onAllForms}
      onNoForms={handlers.onNoForms}
      onFormToggle={handlers.onFormToggle}
    />
  ));
  return { container, handlers };
}

describe('FormsSectionView', () => {
  it('lists each form with its field count and tick state', () => {
    const { container } = renderForms({ checkedById: { demographics: true, labs: false } });
    const rows = Array.from(container.querySelectorAll<HTMLLabelElement>('#forms label'));
    expect(rows.map((row) => row.textContent)).toEqual([' Demographics (4)', ' Lab results (1)']);
    expect(rows.map((row) => row.querySelector('input')!.checked)).toEqual([true, false]);
  });

  it('shows the search box with the current query', () => {
    const { container } = renderForms({ query: 'lab' });
    expect((container.querySelector('input.formsearch') as HTMLInputElement).value).toBe('lab');
  });

  it('passes the typed search text to onQueryInput', () => {
    const { container, handlers } = renderForms();
    const search = container.querySelector('input.formsearch') as HTMLInputElement;
    search.value = 'demo';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(handlers.onQueryInput).toHaveBeenCalledWith('demo');
  });

  it('calls onFormToggle with the form id and the new checked state', () => {
    const { container, handlers } = renderForms();
    const box = container.querySelectorAll<HTMLInputElement>('#forms input')[1];
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(handlers.onFormToggle).toHaveBeenCalledWith('labs', false);
  });

  it('runs all and none without toggling the surrounding summary', () => {
    const { container, handlers } = renderForms();
    const [all, none] = Array.from(container.querySelectorAll<HTMLButtonElement>('summary button.link'));
    const allEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(all.dispatchEvent(allEvent)).toBe(false);
    none.click();
    expect(handlers.onAllForms).toHaveBeenCalledOnce();
    expect(handlers.onNoForms).toHaveBeenCalledOnce();
  });

  it('renders no rows for an empty list', () => {
    const { container } = renderForms({ forms: [], checkedById: {} });
    expect(container.querySelectorAll('#forms input').length).toBe(0);
  });
});
