import { describe, expect, it, vi } from 'vitest';
import { FieldsTabView, type FieldRow } from '../src/components/FieldsTabView';
import { renderComponent } from './renderComponent';

const row = (overrides: Partial<FieldRow> = {}): FieldRow => ({
  variable: 'age', formLabel: 'Demographics', type: 'text', label: 'Age in years', dependsOn: 1, usedBy: 2, chainLength: 3, ...overrides,
});

describe('FieldsTabView', () => {
  it('renders one table row per field with its cell text', () => {
    const container = renderComponent(() => <FieldsTabView rows={[row()]} query="" onQueryChange={() => {}} onSelectField={() => {}} />);
    const cells = [...container.querySelectorAll('tbody tr td')].map((td) => td.textContent);
    expect(cells).toEqual(['age', 'Demographics', 'text', 'Age in years', '1', '2', '3']);
  });

  it('truncates labels to 80 characters', () => {
    const longLabel = 'x'.repeat(100);
    const container = renderComponent(() => <FieldsTabView rows={[row({ label: longLabel })]} query="" onQueryChange={() => {}} onSelectField={() => {}} />);
    expect(container.querySelectorAll('tbody td')[3].textContent).toBe('x'.repeat(80));
  });

  it('calls onSelectField with the variable when a row is clicked', async () => {
    const onSelectField = vi.fn();
    const container = renderComponent(() => <FieldsTabView rows={[row({ variable: 'bmi' })]} query="" onQueryChange={() => {}} onSelectField={onSelectField} />);
    (container.querySelector('tbody tr') as HTMLElement).click();
    await Promise.resolve();
    expect(onSelectField).toHaveBeenCalledWith('bmi');
  });

  it('shows the query in the filter input and reports typed text via onQueryChange', async () => {
    const onQueryChange = vi.fn();
    const container = renderComponent(() => <FieldsTabView rows={[]} query="sex" onQueryChange={onQueryChange} onSelectField={() => {}} />);
    const input = container.querySelector('input.filter') as HTMLInputElement;
    expect(input.value).toBe('sex');
    input.value = 'height';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(onQueryChange).toHaveBeenCalledWith('height');
  });

  it('sorts by a column on click: ascending, then descending, with aria-sort on the header', async () => {
    const rows = [row({ variable: 'b', chainLength: 1 }), row({ variable: 'a', chainLength: 3 }), row({ variable: 'c', chainLength: 2 })];
    const container = renderComponent(() => <FieldsTabView rows={rows} query="" onQueryChange={() => {}} onSelectField={() => {}} />);
    const variables = () => [...container.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent);
    const header = (title: string) => [...container.querySelectorAll('th')].find((th) => th.textContent?.startsWith(title)) as HTMLElement;
    expect(variables()).toEqual(['b', 'a', 'c']);
    (header('Dependent chain').querySelector('button') as HTMLElement).click();
    await Promise.resolve();
    expect(variables()).toEqual(['b', 'c', 'a']);
    expect(header('Dependent chain').getAttribute('aria-sort')).toBe('ascending');
    (header('Dependent chain').querySelector('button') as HTMLElement).click();
    await Promise.resolve();
    expect(variables()).toEqual(['a', 'c', 'b']);
    expect(header('Dependent chain').getAttribute('aria-sort')).toBe('descending');
    (header('Variable').querySelector('button') as HTMLElement).click();
    await Promise.resolve();
    expect(variables()).toEqual(['a', 'b', 'c']);
    expect(header('Dependent chain').getAttribute('aria-sort')).toBe('none');
  });
});
