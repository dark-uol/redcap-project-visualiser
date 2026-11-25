import { describe, expect, it } from 'vitest';
import { LegendView } from '../src/components/LegendView';
import { TYPES } from '../src/lib/graph';
import { renderComponent } from './renderComponent';

describe('LegendView', () => {
  it('lists every dependency type', () => {
    const container = renderComponent(() => <LegendView formLevel={false} />);
    for (const type of Object.values(TYPES)) expect(container.textContent).toContain(type.label);
  });

  it('shows the line-thickness note only at form level', () => {
    expect(renderComponent(() => <LegendView formLevel={false} />).textContent).not.toContain('Line thickness');
    expect(renderComponent(() => <LegendView formLevel={true} />).textContent).toContain('Line thickness');
  });
});
