import { describe, expect, it } from 'vitest';
import { layoutToSvg } from '../src/lib/layoutToSvg';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion } from '../src/lib/layout';
import type { ViewEdge, ViewOptions } from '../src/lib/types';
import { makeView, node } from './fixtures';

const options: ViewOptions = {
  level: 'field', eventSet: null, types: new Set(), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both',
  focusDepth: 0, showMissing: false, hideIsolated: false, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'var', group: false, groupBy: 'none', edgeLabels: false,
};

const link = (from: string, to: string, over: Partial<ViewEdge> = {}): ViewEdge =>
  ({ from, to, types: ['branching'], count: 1, byType: { branching: 1 }, ...over });

const placed = (id: string, x: number, y: number): LayoutNode => ({ id, x, y, width: 120, height: 28 });

const layoutOf = (over: Partial<Layout> = {}): Layout => ({ width: 300, height: 200, nodes: [], edges: [], regions: [], ...over });

const parse = (svg: string): Document => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('layoutToSvg', () => {
  it('writes a Graphviz-shaped svg with keyed nodes and edges', () => {
    const view = makeView({ nodes: [node('a', { label: 'Alpha' }), node('b', { label: 'Beta' })], edges: [link('a', 'b')] });
    const layout = layoutOf({
      nodes: [placed('a', 10, 10), placed('b', 170, 10)],
      edges: [{ from: 'a', to: 'b', curve: [{ x: 130, y: 24 }, { x: 150, y: 24 }, { x: 150, y: 24 }, { x: 170, y: 24 }], backward: false }],
    });
    const doc = parse(layoutToSvg(layout, view, options));
    const root = doc.documentElement;
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 300 200');
    expect(root.getAttribute('width')).toBe('300');
    expect(root.getAttribute('height')).toBe('200');
    expect(doc.querySelector('g.node[data-key="n0"] > title')!.textContent).toBe('Alpha');
    expect(doc.querySelector('g.node[data-key="n1"] > title')!.textContent).toBe('Beta');
    expect(doc.querySelector('g.edge[data-key="n0->n1"] > title')!.textContent).toBe('Alpha -> Beta');
    expect(doc.querySelectorAll('g.node')).toHaveLength(2);
    expect(doc.querySelectorAll('g.edge')).toHaveLength(1);
  });

  it('keys each node by its index in view.nodes, whatever the layout order', () => {
    const view = makeView({ nodes: [node('x'), node('a'), node('b')], edges: [link('b', 'a')] });
    const layout = layoutOf({
      nodes: [placed('b', 0, 0), placed('a', 150, 0)],
      edges: [{ from: 'b', to: 'a', points: [{ x: 120, y: 14 }, { x: 150, y: 14 }], backward: false }],
    });
    const doc = parse(layoutToSvg(layout, view, options));
    expect(doc.querySelector('g.node[data-key="n2"] > title')!.textContent).toBe('b');
    expect(doc.querySelector('g.node[data-key="n1"] > title')!.textContent).toBe('a');
    expect(doc.querySelector('g.edge[data-key="n2->n1"]')).not.toBeNull();
  });

  it('skips edges whose endpoints are not in the view', () => {
    const view = makeView({ nodes: [node('a'), node('b')], edges: [link('a', 'b'), link('a', 'gone')] });
    const layout = layoutOf({
      nodes: [placed('a', 0, 0), placed('b', 150, 0)],
      edges: [
        { from: 'a', to: 'b', points: [{ x: 120, y: 14 }, { x: 150, y: 14 }], backward: false },
        { from: 'a', to: 'gone', points: [{ x: 120, y: 14 }, { x: 200, y: 14 }], backward: false },
      ],
    });
    const doc = parse(layoutToSvg(layout, view, options));
    expect(doc.querySelectorAll('g.edge')).toHaveLength(1);
  });

  it('draws a column that has a groupIndex as a keyed cluster, still a column', () => {
    const regions: LayoutRegion[] = [
      { id: 'col:e1', kind: 'column', label: 'E1', labelLines: ['E1'], x: 120, y: 0, width: 120, height: 80, groupIndex: 2 },
    ];
    const doc = parse(layoutToSvg(layoutOf({ regions }), makeView(), options));
    const box = doc.querySelector('g.cluster[data-key="cluster_2"]')!;
    expect(box.classList.contains('column')).toBe(true);
    expect(box.textContent).toContain('E1');
  });

  it('keys clusters by groupIndex and keeps lanes and columns out of the cluster class', () => {
    const regions: LayoutRegion[] = [
      { id: 'lane:1', kind: 'lane', label: 'Arm 1: Main', x: 0, y: 0, width: 300, height: 80 },
      { id: 'col:e1', kind: 'column', label: 'E1', labelLines: ['E1'], sublabel: 'day 30', x: 120, y: 0, width: 120, height: 80 },
      { id: 'cluster:f1', kind: 'cluster', label: 'Form one', labelLines: ['Form one'], x: 130, y: 20, width: 100, height: 50, groupIndex: 3 },
    ];
    const doc = parse(layoutToSvg(layoutOf({ regions }), makeView(), options));
    expect(doc.querySelector('g.cluster[data-key="cluster_3"]')).not.toBeNull();
    expect(doc.querySelectorAll('g.cluster')).toHaveLength(1);
    expect(doc.querySelector('g.region.lane[data-region-id="lane:1"]')).not.toBeNull();
    expect(doc.querySelector('g.region.column[data-region-id="col:e1"]')).not.toBeNull();
    expect(doc.querySelector('g.region.column')!.textContent).toContain('day 30');
  });

  it('draws a group split over several boxes as one g.cluster plus g.cluster-part extras, all keyed alike', () => {
    const regions: LayoutRegion[] = [
      { id: 'cluster:f1:e1', kind: 'cluster', label: 'Form one', x: 130, y: 20, width: 100, height: 50, groupIndex: 1 },
      { id: 'cluster:f1:e2', kind: 'cluster', label: 'Form one', x: 330, y: 20, width: 100, height: 50, groupIndex: 1 },
    ];
    const doc = parse(layoutToSvg(layoutOf({ regions }), makeView(), options));
    expect(doc.querySelectorAll('g.cluster')).toHaveLength(1);
    expect(doc.querySelectorAll('g.cluster-part')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-key="cluster_1"]')).toHaveLength(2);
    expect(doc.querySelector('g.cluster-part rect')).not.toBeNull();
  });

  it('marks repeating columns with a dashed outline and a repeat mark on the last label line', () => {
    const regions: LayoutRegion[] = [
      { id: 'col:e2', kind: 'column', label: 'Visit', labelLines: ['Visit', 'two'], repeating: true, x: 0, y: 0, width: 120, height: 80 },
    ];
    const doc = parse(layoutToSvg(layoutOf({ regions }), makeView(), options));
    const column = doc.querySelector('g.region.column')!;
    expect(column.querySelector('rect')!.getAttribute('stroke-dasharray')).toBe('6 4');
    const texts = [...column.querySelectorAll('text')].map((text) => text.textContent);
    expect(texts).toEqual(['Visit', 'two ↻']);
  });

  it('draws a polyline route as M and L commands and a curve as M and C', () => {
    const view = makeView({ nodes: [node('a'), node('b'), node('c')], edges: [link('a', 'b'), link('b', 'c')] });
    const layout = layoutOf({
      nodes: [placed('a', 0, 0), placed('b', 100, 0), placed('c', 200, 0)],
      edges: [
        { from: 'a', to: 'b', points: [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 60, y: 40 }], backward: false },
        { from: 'b', to: 'c', curve: [{ x: 220, y: 14 }, { x: 240, y: 14 }, { x: 240, y: 14 }, { x: 260, y: 14 }], backward: false },
      ],
    });
    const doc = parse(layoutToSvg(layout, view, options));
    const polyline = doc.querySelector('g.edge[data-key="n0->n1"] > path')!.getAttribute('d');
    const curve = doc.querySelector('g.edge[data-key="n1->n2"] > path')!.getAttribute('d');
    expect(polyline).toBe('M 10 10 L 10 40 L 60 40');
    expect(curve).toBe('M 220 14 C 240 14 240 14 260 14');
  });

  it('escapes markup characters in labels, titles and region text', () => {
    const view = makeView({ nodes: [node('a', { label: 'A & <B> "C" \'D\'' })] });
    const layout = layoutOf({
      nodes: [placed('a', 0, 0)],
      regions: [{ id: 'lane:<1>', kind: 'lane', label: 'x & y', x: 0, y: 0, width: 300, height: 80 }],
    });
    const svg = layoutToSvg(layout, view, options);
    expect(svg).toContain('A &amp; &lt;B&gt; &quot;C&quot; &#39;D&#39;');
    expect(svg).toContain('x &amp; y');
    expect(svg).toContain('data-region-id="lane:&lt;1&gt;"');
    const doc = parse(svg);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('g.node > title')!.textContent).toBe('A & <B> "C" \'D\'');
  });

  it('defines one arrow marker per edge colour and points edges at an existing marker', () => {
    const view = makeView({
      nodes: [node('a'), node('b'), node('c')],
      edges: [link('a', 'b'), link('b', 'c', { types: ['calc'], byType: { calc: 1 } }), link('a', 'c')],
    });
    const layout = layoutOf({
      nodes: [placed('a', 0, 0), placed('b', 100, 0), placed('c', 200, 0)],
      edges: [
        { from: 'a', to: 'b', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], backward: false },
        { from: 'b', to: 'c', points: [{ x: 100, y: 0 }, { x: 200, y: 0 }], backward: false },
        { from: 'a', to: 'c', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], backward: false },
      ],
    });
    const doc = parse(layoutToSvg(layout, view, options));
    const markers = [...doc.querySelectorAll('defs > marker')];
    const ids = markers.map((marker) => marker.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThan(3);
    const references = [...doc.querySelectorAll('g.edge > path')].map((path) => path.getAttribute('marker-end'));
    references.forEach((reference) => expect(ids).toContain(reference!.replace(/^url\(#|\)$/g, '')));
  });

  it('draws a backward edge with the distinct dash cue unless its type is already dashed', () => {
    const view = makeView({ nodes: [node('a'), node('b')], edges: [link('a', 'b'), link('b', 'a', { types: ['piping'], byType: { piping: 1 } })] });
    const layout = layoutOf({
      nodes: [placed('a', 0, 0), placed('b', 100, 0)],
      edges: [
        { from: 'a', to: 'b', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], backward: false },
        { from: 'b', to: 'a', points: [{ x: 100, y: 0 }, { x: 0, y: 0 }], backward: true },
      ],
    });
    const doc = parse(layoutToSvg(layout, view, options));
    const forward = doc.querySelector('g.edge[data-key="n0->n1"] > path')!;
    expect(forward.getAttribute('stroke-dasharray')).toBeNull();
    const backward = doc.querySelector('g.edge[data-key="n1->n0"] > path')!;
    expect(backward.getAttribute('stroke-dasharray')).toBe('5 3');
    const solidBackward = layoutToSvg(
      layoutOf({ nodes: [placed('a', 0, 0), placed('b', 100, 0)], edges: [{ from: 'a', to: 'b', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], backward: true }] }),
      makeView({ nodes: [node('a'), node('b')], edges: [link('a', 'b')] }),
      options,
    );
    expect(parse(solidBackward).querySelector('g.edge > path')!.getAttribute('stroke-dasharray')).toBe('8 3 2 3');
  });

  it('writes the edge label at the route midpoint when labels are on', () => {
    const view = makeView({ nodes: [node('a'), node('b')], edges: [link('a', 'b', { types: ['branching', 'calc'], byType: { branching: 1, calc: 1 } })] });
    const layout = layoutOf({
      nodes: [placed('a', 0, 0), placed('b', 100, 0)],
      edges: [{ from: 'a', to: 'b', points: [{ x: 0, y: 10 }, { x: 100, y: 10 }], backward: false }],
    });
    const doc = parse(layoutToSvg(layout, view, { ...options, edgeLabels: true }));
    const label = doc.querySelector('g.edge > text')!;
    expect(label.textContent).toBe('branching+calc');
    expect(label.getAttribute('x')).toBe('50');
    const none = parse(layoutToSvg(layout, view, options));
    expect(none.querySelector('g.edge > text')).toBeNull();
  });

  it('draws missing nodes dashed and the focus node with a heavy stroke', () => {
    const view = makeView({ nodes: [node('a', { kind: 'missing' }), node('b', { focus: true })] });
    const layout = layoutOf({ nodes: [placed('a', 0, 0), placed('b', 150, 0)] });
    const doc = parse(layoutToSvg(layout, view, options));
    expect(doc.querySelector('g.node[data-key="n0"] > rect')!.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(doc.querySelector('g.node[data-key="n1"] > rect')!.getAttribute('stroke-width')).toBe('3');
  });

  it('truncates node label lines to the node width', () => {
    const view = makeView({ nodes: [node('a', { label: 'A very long variable label that cannot fit' })] });
    const layout = layoutOf({ nodes: [placed('a', 0, 0)] });
    const doc = parse(layoutToSvg(layout, view, options));
    const label = doc.querySelector('g.node[data-key="n0"] text')!.textContent!;
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(Math.floor((120 - 12) / 6.5));
  });
});
