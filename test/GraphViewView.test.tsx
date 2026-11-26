import { describe, expect, it, vi } from 'vitest';
import { render } from '@solidjs/web';
import { GraphViewView, type GraphViewViewProps } from '../src/components/GraphViewView';
import { graphvizSvg, makeView } from './fixtures';
import { renderComponent, tick } from './renderComponent';

function baseProps(over: Partial<GraphViewViewProps> = {}): GraphViewViewProps {
  return {
    svg: null,
    drawnView: null,
    view: null,
    selected: null,
    activeTab: 'graph',
    busy: false,
    renderMessage: '',
    tooBig: false,
    lineWidths: false,
    isForm: () => false,
    onClickAction: vi.fn(),
    onRenderAnyway: vi.fn(),
    onAnchorCapture: vi.fn(),
    children: <aside id="detail-slot">detail</aside>,
    ...over,
  };
}

describe('GraphViewView', () => {
  it('shows node and edge counts for the view and renders the children slot', () => {
    const container = renderComponent(() => <GraphViewView {...baseProps({ view: makeView() })} />);
    expect(container.querySelector('.graphbar .muted')!.textContent).toBe('3 nodes · 0 edges');
    expect(container.querySelector('#graphwrap #detail-slot')).not.toBeNull();
  });

  it('mounts the rendered svg into the canvas', async () => {
    const svg = graphvizSvg();
    const container = renderComponent(() => <GraphViewView {...baseProps({ svg, drawnView: makeView(), view: makeView() })} />);
    await tick();
    expect(container.querySelector('#canvas')!.contains(svg)).toBe(true);
  });

  it('reports what a click on a node means, using the drawn view', async () => {
    const onClickAction = vi.fn();
    const svg = graphvizSvg();
    renderComponent(() => <GraphViewView {...baseProps({ svg, drawnView: makeView(), view: makeView(), onClickAction })} />);
    await tick();
    svg.querySelector('g.node text')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClickAction).toHaveBeenCalledWith({ type: 'select', id: 'a' });
  });

  it('marks the stage busy while rendering', () => {
    const container = renderComponent(() => <GraphViewView {...baseProps({ busy: true })} />);
    expect(container.querySelector('#stage')!.classList).toContain('busy');
    expect(renderComponent(() => <GraphViewView {...baseProps()} />).querySelector('#stage')!.classList).not.toContain('busy');
  });

  it('shows a render message, and the large-graph notice with a Render anyway button', () => {
    expect(renderComponent(() => <GraphViewView {...baseProps({ renderMessage: 'Rendering failed' })} />).querySelector('#msg')!.textContent).toBe('Rendering failed');

    const onRenderAnyway = vi.fn();
    const container = renderComponent(() => <GraphViewView {...baseProps({ tooBig: true, view: makeView(), renderMessage: 'ignored', onRenderAnyway })} />);
    expect(container.querySelector('#msg')!.textContent).toContain('Large graph (0 edges)');
    expect(container.querySelector('#msg')!.textContent).not.toContain('ignored');
    (container.querySelector('#msg button') as HTMLButtonElement).click();
    expect(onRenderAnyway).toHaveBeenCalledOnce();
  });

  it('shows the line-thickness legend note only when lineWidths is set', () => {
    expect(renderComponent(() => <GraphViewView {...baseProps({ lineWidths: true })} />).querySelector('.legend')!.textContent).toContain('Line thickness');
    expect(renderComponent(() => <GraphViewView {...baseProps()} />).querySelector('.legend')!.textContent).not.toContain('Line thickness');
  });

  it('hands out the anchor-capture function on mount and withdraws it on dispose', () => {
    const onAnchorCapture = vi.fn();
    const container = document.createElement('div');
    const dispose = render(() => <GraphViewView {...baseProps({ onAnchorCapture })} />, container);
    expect(onAnchorCapture).toHaveBeenCalledTimes(1);
    expect(onAnchorCapture.mock.calls[0][0]).toBeTypeOf('function');
    dispose();
    expect(onAnchorCapture).toHaveBeenLastCalledWith(null);
  });
});
