import { describe, expect, it, vi } from 'vitest';
import { LayoutSvgView, type LayoutSvgViewProps } from '../src/components/LayoutSvgView';
import type { Layout } from '../src/lib/layout';
import { renderComponent } from './renderComponent';

/** Four nodes in two lanes and two columns. a->b and b->c run forward, c->a runs backward, d is unlinked. */
const layout: Layout = {
  width: 400,
  height: 300,
  nodes: [
    { id: 'a', x: 20, y: 60, width: 100, height: 36 },
    { id: 'b', x: 160, y: 60, width: 100, height: 36 },
    { id: 'c', x: 20, y: 160, width: 100, height: 36 },
    { id: 'd', x: 300, y: 160, width: 80, height: 36 },
  ],
  edges: [
    { from: 'a', to: 'b', curve: [{ x: 120, y: 78 }, { x: 140, y: 78 }, { x: 140, y: 78 }, { x: 160, y: 78 }], backward: false },
    { from: 'b', to: 'c', curve: [{ x: 210, y: 96 }, { x: 210, y: 140 }, { x: 70, y: 140 }, { x: 70, y: 160 }], backward: false },
    { from: 'c', to: 'a', curve: [{ x: 20, y: 178 }, { x: 0, y: 178 }, { x: 0, y: 78 }, { x: 20, y: 78 }], backward: true },
  ],
  regions: [
    { id: 'lane:1', kind: 'lane', label: 'Arm 1', x: 0, y: 40, width: 400, height: 100 },
    { id: 'lane:2', kind: 'lane', label: 'Arm 2', x: 0, y: 140, width: 400, height: 100 },
    { id: 'col:baseline', kind: 'column', label: 'Baseline', sublabel: 'day 0', x: 0, y: 0, width: 200, height: 300 },
    { id: 'col:visit', kind: 'column', label: 'Visit', sublabel: 'day 30 (±7)', x: 200, y: 0, width: 200, height: 300, repeating: true },
  ],
};

function makeProps(overrides: Partial<LayoutSvgViewProps> = {}): LayoutSvgViewProps {
  return {
    layout,
    nodeLabel: (id) => `Node ${id}`,
    selected: null,
    selectedEdge: null,
    onSelectNode: () => {},
    onSelectEdge: () => {},
    onClear: () => {},
    ...overrides,
  };
}

const render = (props: LayoutSvgViewProps): HTMLElement => renderComponent(() => <LayoutSvgView {...props} />);

const nodeElement = (container: HTMLElement, id: string): Element => {
  const element = container.querySelector(`g.node[data-node-id="${id}"]`);
  if (!element) throw new Error('No node ' + id);
  return element;
};

const edgeHitElement = (container: HTMLElement, from: string, to: string): Element => {
  const element = container.querySelector(`g.edge[data-from="${from}"][data-to="${to}"] path.hit`);
  if (!element) throw new Error(`No edge ${from}->${to}`);
  return element;
};

const click = (element: Element): void => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('LayoutSvgView', () => {
  it('renders one group per node, edge and region', () => {
    const container = render(makeProps());
    expect(container.querySelectorAll('g.node')).toHaveLength(4);
    expect(container.querySelectorAll('g.edge')).toHaveLength(3);
    expect(container.querySelectorAll('g.region')).toHaveLength(4);
    expect(container.querySelectorAll('g.edge > path:not(.hit)')).toHaveLength(3);
  });

  it('labels nodes and draws column labels from the region data, with a repeat mark', () => {
    const container = render(makeProps());
    expect(nodeElement(container, 'a').textContent).toContain('Node a');
    expect(container.textContent).toContain('Arm 1');
    expect(container.textContent).toContain('Baseline');
    expect(container.textContent).toContain('day 30 (±7)');
    const visit = container.querySelector('g.region[data-region-id="col:visit"]');
    expect(visit?.textContent).toContain('↻');
    expect(container.querySelector('g.region[data-region-id="col:baseline"]')?.textContent).not.toContain('↻');
  });

  it('calls onSelectNode with the node id when a node is clicked', () => {
    const onSelectNode = vi.fn();
    const onClear = vi.fn();
    const container = render(makeProps({ onSelectNode, onClear }));
    click(nodeElement(container, 'b'));
    expect(onSelectNode).toHaveBeenCalledWith('b');
    expect(onClear).not.toHaveBeenCalled();
  });

  it('calls onSelectEdge with from and to when an edge hit path is clicked', () => {
    const onSelectEdge = vi.fn();
    const onSelectNode = vi.fn();
    const container = render(makeProps({ onSelectEdge, onSelectNode }));
    click(edgeHitElement(container, 'b', 'c'));
    expect(onSelectEdge).toHaveBeenCalledWith('b', 'c');
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('calls onClear when the background is clicked', () => {
    const onClear = vi.fn();
    const container = render(makeProps({ onClear }));
    click(container.querySelector('svg')!);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('marks the selected node and its neighbours on, and an unrelated node dim', () => {
    const container = render(makeProps({ selected: 'a' }));
    expect(nodeElement(container, 'a').classList).toContain('on');
    expect(nodeElement(container, 'b').classList).toContain('on');
    expect(nodeElement(container, 'c').classList).toContain('on');
    expect(nodeElement(container, 'd').classList).toContain('dim');
    expect(container.querySelector('g.edge[data-from="a"][data-to="b"]')!.classList).toContain('on');
    expect(container.querySelector('g.edge[data-from="b"][data-to="c"]')!.classList).toContain('dim');
  });

  it('marks nothing on or dim when no node is selected', () => {
    const container = render(makeProps());
    expect(container.querySelectorAll('.on, .dim')).toHaveLength(0);
  });

  it('marks the selected edge with class selected', () => {
    const container = render(makeProps({ selectedEdge: { from: 'b', to: 'c' } }));
    expect(container.querySelector('g.edge[data-from="b"][data-to="c"]')!.classList).toContain('selected');
    expect(container.querySelector('g.edge[data-from="a"][data-to="b"]')!.classList).not.toContain('selected');
  });

  it('gives the backward edge class backward on its visible path', () => {
    const container = render(makeProps());
    const backward = container.querySelector('g.edge[data-from="c"][data-to="a"] path:not(.hit)');
    expect(backward!.classList).toContain('backward');
    expect(container.querySelector('g.edge[data-from="a"][data-to="b"] path:not(.hit)')!.classList).not.toContain('backward');
  });
});
