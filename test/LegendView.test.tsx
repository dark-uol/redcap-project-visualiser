import { describe, expect, it } from 'vitest';
import { LegendView } from '../src/components/LegendView';
import { TYPES } from '../src/lib/graph';
import { renderComponent } from './renderComponent';

describe('LegendView', () => {
  it('lists every dependency type', () => {
    const container = renderComponent(() => <LegendView lineWidths={false} />);
    for (const type of Object.values(TYPES)) expect(container.textContent).toContain(type.label);
  });

  it('shows the line-thickness note only when line widths apply', () => {
    expect(renderComponent(() => <LegendView lineWidths={false} />).textContent).not.toContain('Line thickness');
    expect(renderComponent(() => <LegendView lineWidths={true} />).textContent).toContain('Line thickness');
  });
});
