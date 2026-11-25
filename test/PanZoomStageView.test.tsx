import { describe, expect, it } from 'vitest';
import { PanZoomStageView, type PanZoomStageViewProps } from '../src/components/PanZoomStageView';
import { buttonLabelled, renderComponent, tick } from './renderComponent';

function baseProps(over: Partial<PanZoomStageViewProps> = {}): PanZoomStageViewProps {
  return {
    contentWidth: 400,
    contentHeight: 300,
    children: <p class="content-child">content</p>,
    ...over,
  };
}

describe('PanZoomStageView', () => {
  it('renders the children inside the stage canvas', () => {
    const container = renderComponent(() => <PanZoomStageView {...baseProps()} />);
    expect(container.querySelector('#stage #canvas .content-child')).not.toBeNull();
  });

  it('shows zoom in, zoom out and fit buttons', () => {
    const container = renderComponent(() => <PanZoomStageView {...baseProps()} />);
    expect(container.querySelectorAll('.graphbar button').length).toBe(3);
    expect(buttonLabelled(container, '+')).toBeTruthy();
    expect(buttonLabelled(container, '−')).toBeTruthy();
    expect(buttonLabelled(container, 'Fit')).toBeTruthy();
  });

  it('applies a transform to the canvas after clicking +', async () => {
    const container = renderComponent(() => <PanZoomStageView {...baseProps()} />);
    const canvas = container.querySelector<HTMLDivElement>('#canvas')!;
    buttonLabelled(container, '+').click();
    await tick();
    expect(canvas.style.transform).toContain('scale(');
  });
});
