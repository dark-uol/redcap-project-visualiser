import { describe, expect, it, vi } from 'vitest';
import { DepsTabView, type DependencyRow } from '../src/components/DepsTabView';
import { renderComponent } from './renderComponent';

const row = (overrides: Partial<DependencyRow> = {}): DependencyRow => ({
  from: 'age', fromFormLabel: 'Demographics', to: 'bmi', toFormLabel: 'Anthropometrics', type: 'calc', cross: false, expression: '[weight] / [age]', ...overrides,
});

const rowsOf = (container: HTMLElement) => [...container.querySelectorAll('tbody tr')];

describe('DepsTabView', () => {
  it('renders source, target, form labels and expression for each row', () => {
    const container = renderComponent(() => <DepsTabView rows={[row()]} totalCount={1} query="" onQueryChange={() => {}} />);
    const cells = [...container.querySelectorAll('tbody tr td')].map((td) => td.textContent);
    expect(cells).toEqual(['ageDemographics', '→', 'bmiAnthropometrics', 'calc', '[weight] / [age]']);
  });

  it('shows the dependency type as a tag', () => {
    const container = renderComponent(() => <DepsTabView rows={[row({ type: 'branching' })]} totalCount={1} query="" onQueryChange={() => {}} />);
    const tag = container.querySelector('td span.tag') as HTMLElement;
    expect(tag.textContent).toBe('branching');
    expect(tag.style.background).not.toBe('');
  });

  it('shows the cross-event badge only when the row is cross-event', () => {
    const container = renderComponent(() => <DepsTabView rows={[row({ cross: false }), row({ cross: true })]} totalCount={2} query="" onQueryChange={() => {}} />);
    const [plain, cross] = rowsOf(container);
    expect(plain.querySelectorAll('span.tag')).toHaveLength(1);
    expect(cross.querySelectorAll('span.tag')).toHaveLength(2);
    expect(cross.textContent).toContain('cross-event');
    expect(plain.textContent).not.toContain('cross-event');
  });

  it('reports the total count without the cap suffix at or below 1000', () => {
    const atLimit = renderComponent(() => <DepsTabView rows={[]} totalCount={1000} query="" onQueryChange={() => {}} />);
    expect(atLimit.querySelector('p.muted')!.textContent).toBe('1000 dependencies');
  });

  it('adds the showing-first-1000 suffix when the total is above 1000', () => {
    const container = renderComponent(() => <DepsTabView rows={[]} totalCount={1200} query="" onQueryChange={() => {}} />);
    expect(container.querySelector('p.muted')!.textContent).toBe('1200 dependencies (showing first 1000)');
  });

  it('renders at most 1000 rows even when given 1200', () => {
    const many = Array.from({ length: 1200 }, (_, index) => row({ from: `f${index}` }));
    const container = renderComponent(() => <DepsTabView rows={many} totalCount={1200} query="" onQueryChange={() => {}} />);
    expect(rowsOf(container)).toHaveLength(1000);
    expect(rowsOf(container)[999].querySelector('td')!.textContent).toContain('f999');
  });

  it('reports typed text via onQueryChange', async () => {
    const onQueryChange = vi.fn();
    const container = renderComponent(() => <DepsTabView rows={[]} totalCount={0} query="" onQueryChange={onQueryChange} />);
    const input = container.querySelector('input.filter') as HTMLInputElement;
    input.value = 'bmi';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(onQueryChange).toHaveBeenCalledWith('bmi');
  });
});
