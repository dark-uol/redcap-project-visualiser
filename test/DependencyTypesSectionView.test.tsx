import { describe, expect, it, vi } from 'vitest';
import { DependencyTypesSectionView } from '../src/components/sidebar/DependencyTypesSectionView';
import { TYPES } from '../src/lib/graph';
import type { DepType } from '../src/lib/types';
import { renderComponent } from './renderComponent';

const ALL_ON = Object.fromEntries(Object.keys(TYPES).map((kind) => [kind, true])) as Record<DepType, boolean>;

function renderSection(typesOn: Record<DepType, boolean> = ALL_ON) {
  const onTypeChange = vi.fn((_kind: DepType, _checked: boolean) => {});
  const container = renderComponent(() => <DependencyTypesSectionView typesOn={typesOn} onTypeChange={onTypeChange} />);
  const boxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('.typerow input'));
  return { container, onTypeChange, boxes };
}

describe('DependencyTypesSectionView', () => {
  it('renders one row per dependency type, labelled from TYPES', () => {
    const { container } = renderSection();
    const rows = Array.from(container.querySelectorAll('.typerow'));
    expect(rows.map((row) => row.textContent)).toEqual(Object.values(TYPES).map((type) => type.label));
  });

  it('shows each checkbox as ticked or not from typesOn', () => {
    const { boxes } = renderSection({ ...ALL_ON, calc: false });
    const kinds = Object.keys(TYPES);
    expect(boxes().map((box) => box.checked)).toEqual(kinds.map((kind) => kind !== 'calc'));
  });

  it('calls onTypeChange with the type and the new checked state', () => {
    const { boxes, onTypeChange } = renderSection();
    const kinds = Object.keys(TYPES) as DepType[];
    const piping = boxes()[kinds.indexOf('piping')];
    piping.checked = false;
    piping.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onTypeChange).toHaveBeenCalledWith('piping', false);
  });

  it('shows the explanation only after the section hint is toggled', async () => {
    const { container } = renderSection();
    expect(container.textContent).not.toContain('Which kinds of link are drawn');
    (container.querySelector('.hint-toggle') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(container.textContent).toContain('Which kinds of link are drawn');
  });
});
