import { describe, expect, it, vi } from 'vitest';
import { NavigationSectionView } from '../src/components/sidebar/NavigationSectionView';
import type { NavigationSectionViewProps } from '../src/components/sidebar/NavigationSectionView';
import { renderComponent } from './renderComponent';

const BASE: Omit<NavigationSectionViewProps, 'children'> = {
  focus: '',
  focusLabel: '',
  exploring: null,
  pair: null,
  zoomedForms: [],
  zoomedEvents: [],
  fields: [{ variable: 'age', label: 'Age in years' }],
  forms: [{ id: 'demographics', label: 'Demographics' }],
  events: [{ id: 'baseline', label: 'Baseline' }],
  onFocusPick: () => true,
  onClearFocus: () => {},
  onExitExploring: () => {},
  onClearPair: () => {},
  onResetAll: () => {},
  onCollapseForm: () => {},
  onCollapseEvent: () => {},
};

/** Renders the view with the base props, overridden by `overrides`, and spies on every callback. */
function renderNav(overrides: Partial<NavigationSectionViewProps> = {}) {
  const handlers = {
    onFocusPick: vi.fn((_raw: string) => true),
    onClearFocus: vi.fn(),
    onExitExploring: vi.fn(),
    onClearPair: vi.fn(),
    onResetAll: vi.fn(),
    onCollapseForm: vi.fn((_formId: string) => {}),
    onCollapseEvent: vi.fn((_eventId: string) => {}),
  };
  const props = { ...BASE, ...handlers, ...overrides };
  const container = renderComponent(() => <NavigationSectionView {...props}><span class="kid">depth</span></NavigationSectionView>);
  const navItems = () => Array.from(container.querySelectorAll('.navstate li'));
  const focusInput = () => container.querySelector<HTMLInputElement>('input[list="fieldlist"]')!;
  const findButton = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === text)!;
  return { container, handlers, navItems, focusInput, findButton };
}

describe('NavigationSectionView: active list', () => {
  it('hides the list and reset button when nothing is narrowed', () => {
    const { container } = renderNav();
    expect(container.querySelector('.navstate')).toBeNull();
    expect(container.textContent).not.toContain('Reset to full graph');
  });

  it('lists the focus, exploration, form-link and zoomed items with their clear buttons', () => {
    const { navItems } = renderNav({
      focus: 'age',
      focusLabel: 'age (field)',
      exploring: 0,
      pair: { fromLabel: 'Demographics', toLabel: 'Labs' },
      zoomedForms: [{ id: 'labs@baseline', label: 'Labs @ Baseline' }],
      zoomedEvents: [{ id: 'week4', label: 'Week 4' }],
    });
    expect(navItems().map((item) => item.textContent)).toEqual([
      'Chain of age (field)✕ clear',
      'Exploring: 0 nodes✕ exit',
      'Links Demographics → Labs✕ clear',
      'Zoomed into Labs @ Baseline✕ back to form',
      'Zoomed into Week 4✕ back to event',
    ]);
  });

  it('shows the exploring row even when the exploration has no visible nodes', () => {
    expect(renderNav({ exploring: 0 }).navItems().length).toBe(1);
  });

  it('calls the matching callback from each clear button', async () => {
    const { navItems, handlers } = renderNav({
      focus: 'age',
      focusLabel: 'age (field)',
      exploring: 3,
      pair: { fromLabel: 'A', toLabel: 'B' },
      zoomedForms: [{ id: 'f', label: 'F' }],
      zoomedEvents: [{ id: 'e', label: 'E' }],
    });
    navItems().forEach((item) => (item.querySelector('button') as HTMLButtonElement).click());
    await Promise.resolve();
    expect(handlers.onClearFocus).toHaveBeenCalledOnce();
    expect(handlers.onExitExploring).toHaveBeenCalledOnce();
    expect(handlers.onClearPair).toHaveBeenCalledOnce();
    expect(handlers.onCollapseForm).toHaveBeenCalledWith('f');
    expect(handlers.onCollapseEvent).toHaveBeenCalledWith('e');
  });

  it('calls onResetAll from Reset to full graph', async () => {
    const { findButton, handlers } = renderNav({ focus: 'age', focusLabel: 'age (field)' });
    findButton('Reset to full graph').click();
    await Promise.resolve();
    expect(handlers.onResetAll).toHaveBeenCalledOnce();
  });
});

describe('NavigationSectionView: focus field', () => {
  it('passes a typed name to onFocusPick and keeps the typed text when it is accepted', () => {
    const { focusInput, handlers } = renderNav({ focus: 'age' });
    focusInput().value = ' Age ';
    focusInput().dispatchEvent(new Event('change', { bubbles: true }));
    expect(handlers.onFocusPick).toHaveBeenCalledWith(' Age ');
    expect(focusInput().value).toBe(' Age ');
  });

  it('restores the current focus when the name is rejected', () => {
    const { focusInput, handlers } = renderNav({ focus: 'age', onFocusPick: () => false });
    focusInput().value = 'nope';
    focusInput().dispatchEvent(new Event('change', { bubbles: true }));
    expect(handlers.onFocusPick).not.toHaveBeenCalled();
    expect(focusInput().value).toBe('age');
  });

  it('fills the datalist with fields, then forms and events', () => {
    const { container } = renderNav();
    const options = Array.from(container.querySelectorAll('#fieldlist option'));
    expect(options.map((option) => [option.getAttribute('value'), option.textContent])).toEqual([
      ['age', 'Age in years'],
      ['demographics', 'Form: Demographics'],
      ['baseline', 'Event: Baseline'],
    ]);
  });

  it('cuts field labels in the datalist to 70 characters', () => {
    const longLabel = 'x'.repeat(100);
    const { container } = renderNav({ fields: [{ variable: 'long', label: longLabel }] });
    expect(container.querySelector('#fieldlist option')?.textContent).toBe('x'.repeat(70));
  });

  it('calls onClearFocus from the ✕ beside the field', async () => {
    const { container, handlers } = renderNav({ focus: 'age' });
    const clearButton = container.querySelector<HTMLButtonElement>('button[title="Clear focus"]')!;
    clearButton.click();
    await Promise.resolve();
    expect(handlers.onClearFocus).toHaveBeenCalledOnce();
  });

  it('renders the focus controls slot after the focus field', () => {
    const { container } = renderNav();
    expect(container.querySelector('.kid')).not.toBeNull();
  });
});
