import { describe, expect, it } from 'vitest';
import { KIND_FILL, KIND_STROKE } from '../src/lib/exporters';
import { TYPES } from '../src/lib/graph';
import { EMITTABLE_CLASSES, HOOK_CLASSES, layoutStyleSheet, layoutToSvg, widthClass } from '../src/lib/layoutToSvg';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion } from '../src/lib/layout';
import type { DepType, NodeKind, ViewEdge, ViewOptions } from '../src/lib/types';
import { makeView, node } from './fixtures';

const options: ViewOptions = {
  level: 'field', eventSet: null, types: new Set(), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both',
  focusDepth: 0, showMissing: false, hideIsolated: false, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'var', group: false, groupBy: 'none', edgeLabels: false, lineWidths: true,
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
    expect(column.classList.contains('repeating')).toBe(true);
    expect(parse(layoutToSvg(layoutOf({ regions: [{ ...regions[0], repeating: false }] }), makeView(), options)).querySelector('g.region.column')!.classList.contains('repeating')).toBe(false);
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

  it('defines one arrow marker per edge colour class and a style rule that points each type at its marker', () => {
    const doc = parse(layoutToSvg(layoutOf(), makeView(), options));
    const ids = [...doc.querySelectorAll('defs > marker')].map((marker) => marker.getAttribute('id')!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...Object.keys(TYPES), 'cross-arm'].map((name) => `arrow-${name}`));
    const css = doc.querySelector('style')!.textContent!;
    for (const name of Object.keys(TYPES)) expect(css).toContain(`g.edge.type-${name}>path.edge-line{marker-end:url(#arrow-${name})}`);
    expect(css).toContain('g.edge.cross-arm>path.edge-line{marker-end:url(#arrow-cross-arm)}');
  });

  it('classes an edge by primary type and modifiers, with a quantised width class', () => {
    const view = makeView({
      instances: true,
      nodes: [node('a'), node('b'), node('c'), node('d')],
      edges: [
        link('a', 'b', { types: ['calc', 'branching'], byType: { calc: 1, branching: 1 }, crossArm: true, count: 5 }),
        link('b', 'c', { mismatch: true, relative: true, count: 2 }),
        link('c', 'd', { relative: true, count: 1 }),
      ],
    });
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const layout = layoutOf({
      nodes: [placed('a', 0, 0), placed('b', 100, 0), placed('c', 200, 0), placed('d', 300, 0)],
      edges: [
        { from: 'a', to: 'b', points: route, backward: true },
        { from: 'b', to: 'c', points: route, backward: false },
        { from: 'c', to: 'd', points: route, backward: false },
      ],
    });
    const doc = parse(layoutToSvg(layout, { ...view, level: 'form' }, options));
    const classesOf = (key: string): string[] => [...doc.querySelector(`g.edge[data-key="${key}"]`)!.classList];
    expect(classesOf('n0->n1')).toEqual(expect.arrayContaining(['edge', 'type-branching', 'cross-arm', 'backward']));
    expect(classesOf('n1->n2')).toEqual(expect.arrayContaining(['type-branching', 'mismatch']));
    expect(classesOf('n1->n2')).not.toContain('relative');
    expect(classesOf('n2->n3')).toEqual(expect.arrayContaining(['relative']));
    expect(classesOf('n0->n1').filter((name) => name.startsWith('w-'))).toEqual([`w-${String(Math.round((1 + 1.6 * Math.log2(5)) * 2) / 2).replace('.', '-')}`]);
  });

  it('quantises widths to half pixels and names the class by the width', () => {
    expect(widthClass(1)).toBe('w-1');
    expect(widthClass(3.54)).toBe('w-3-5');
    expect(widthClass(2.6)).toBe('w-2-5');
    expect(widthClass(5.8)).toBe('w-6');
    expect(widthClass(99)).toBe('w-10');
    expect(widthClass(0.1)).toBe('w-1');
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
    expect(doc.querySelector('g.edge[data-key="n0->n1"]')!.classList.contains('backward')).toBe(false);
    expect(doc.querySelector('g.edge[data-key="n1->n0"]')!.classList.contains('backward')).toBe(true); // type no longer implies a dash, so piping gets the backward cue too
    const css = doc.querySelector('style')!.textContent!;
    expect(css).toContain('g.edge.backward{--edge-dash:var(--dash-backward)}');
    expect(css).toContain('--dash-backward:8 3 2 3');
    // an explicit dash class comes later in the sheet, so it wins over the backward cue as before
    expect(css.indexOf('g.edge.backward{')).toBeLessThan(css.indexOf('g.edge.dash-dashed{'));
    expect(css.indexOf('g.edge.backward{')).toBeLessThan(css.indexOf('g.edge.dash-dotted{'));
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

  describe('viewBox', () => {
    const longLabelView = makeView({
      nodes: [node('a'), node('b')],
      edges: [link('a', 'b', { types: ['branching', 'calc'], byType: { branching: 1, calc: 1 } })],
    });
    const viewBoxOf = (svg: string): number[] => parse(svg).documentElement.getAttribute('viewBox')!.split(' ').map(Number);

    it('grows to include a label box left of 0 and right of the layout width', () => {
      const layout = layoutOf({
        width: 200, height: 60,
        nodes: [placed('a', 0, 0), placed('b', 0, 30)],
        edges: [{ from: 'a', to: 'b', points: [{ x: 0, y: 20 }, { x: 40, y: 20 }], backward: false }],
      });
      const svg =layoutToSvg(layout, longLabelView, { ...options, edgeLabels: true });
      const [minX, minY, width, height] = viewBoxOf(svg);
      const labelWidth = 'branching+calc'.length * 6.5;
      expect(minX).toBeLessThan(0);
      expect(minX).toBeLessThanOrEqual(20 - labelWidth / 2);
      expect(minX + width).toBeGreaterThanOrEqual(200);
      expect(minY).toBeLessThanOrEqual(0);
      expect(minY + height).toBeGreaterThanOrEqual(60);
      const root = parse(svg).documentElement;
      expect(root.getAttribute('width')).toBe(String(width));
      expect(root.getAttribute('height')).toBe(String(height));
    });

    it('includes a label past the right edge', () => {
      const layout = layoutOf({
        width: 200, height: 60,
        nodes: [placed('a', 0, 0), placed('b', 0, 30)],
        edges: [{ from: 'a', to: 'b', points: [{ x: 190, y: 20 }, { x: 200, y: 20 }], backward: false }],
      });
      const [minX, , width] = viewBoxOf(layoutToSvg(layout, longLabelView, { ...options, edgeLabels: true }));
      expect(minX).toBe(0);
      expect(minX + width).toBeGreaterThanOrEqual(195 + (14 * 6.5) / 2);
    });

    it('keeps 0 0 W H when nothing sticks out', () => {
      const layout = layoutOf({
        nodes: [placed('a', 10, 10), placed('b', 170, 10)],
        edges: [{ from: 'a', to: 'b', points: [{ x: 130, y: 24 }, { x: 170, y: 24 }], backward: false }],
      });
      expect(parse(layoutToSvg(layout, longLabelView, { ...options, edgeLabels: true })).documentElement.getAttribute('viewBox')).toBe('0 0 300 200');
    });

    it('ignores edges without labels, so the layout box stays', () => {
      const layout = layoutOf({
        width: 200, height: 60,
        nodes: [placed('a', 0, 0), placed('b', 0, 30)],
        edges: [{ from: 'a', to: 'b', points: [{ x: 0, y: 20 }, { x: 40, y: 20 }], backward: false }],
      });
      expect(parse(layoutToSvg(layout, longLabelView, options)).documentElement.getAttribute('viewBox')).toBe('0 0 200 60');
    });
  });

  it('classes nodes by kind and marks the focus node and nothing else', () => {
    const view = makeView({ nodes: [node('a', { kind: 'missing' }), node('b', { focus: true })] });
    const layout = layoutOf({ nodes: [placed('a', 0, 0), placed('b', 150, 0)] });
    const doc = parse(layoutToSvg(layout, view, options));
    expect([...doc.querySelector('g.node[data-key="n0"]')!.classList]).toEqual(['node', 'kind-missing']);
    expect([...doc.querySelector('g.node[data-key="n1"]')!.classList]).toEqual(['node', 'kind-field', 'focus']);
    expect(doc.querySelector('g.node[data-key="n0"] > text')!.getAttribute('class')).toBe('node-label');
  });

  describe('styling is css', () => {
    const KINDS = Object.keys(KIND_FILL) as NodeKind[];
    const TYPE_NAMES = Object.keys(TYPES) as DepType[];
    /** A drawing that exercises every kind, type, modifier, region and label the writer can emit. */
    const richSvg = (): string => {
      const nodes = Array.from({ length: TYPE_NAMES.length + 1 }, (_, index) => node(`k${index}`, { kind: KINDS[index % KINDS.length], focus: index === 0, extra: ['second line'] }));
      const edges = TYPE_NAMES.map((type, index) => link(`k${index}`, `k${index + 1}`, {
        types: [type], byType: { [type]: 1 }, count: index + 1, crossArm: index === 0, mismatch: index === 1, relative: index === 2,
      }));
      const view = makeView({ level: 'form', instances: true, nodes, edges });
      const layout = layoutOf({
        nodes: nodes.map((viewNode, index) => placed(viewNode.id, 10 + index * 130, 40)),
        edges: edges.map((viewEdge, index) => ({ from: viewEdge.from, to: viewEdge.to, points: [{ x: 10, y: 60 + index }, { x: 100, y: 60 + index }], backward: index % 2 === 0 })),
        regions: [
          { id: 'lane:1', kind: 'lane', label: 'Arm', x: 0, y: 0, width: 300, height: 80 },
          { id: 'col:e1', kind: 'column', label: 'E1', sublabel: 'day 1', repeating: true, x: 0, y: 0, width: 100, height: 80, groupIndex: 1 },
          { id: 'cluster:f1', kind: 'cluster', label: 'Form', x: 5, y: 5, width: 50, height: 50, groupIndex: 2 },
        ],
      });
      return layoutToSvg(layout, view, { ...options, edgeLabels: true });
    };
    const STYLING_ATTRIBUTES = ['style', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-weight', 'font-family', 'opacity', 'text-anchor', 'marker-end'];

    it('has exactly one <style> element and no styling attribute on any other element', () => {
      const doc = parse(richSvg());
      expect(doc.querySelectorAll('style')).toHaveLength(1);
      const offenders = [...doc.querySelectorAll('*')]
        .filter((element) => element.tagName !== 'style')
        .flatMap((element) => STYLING_ATTRIBUTES.filter((name) => element.hasAttribute(name)).map((name) => `${element.tagName}[${name}]`));
      expect(offenders).toEqual([]);
    });

    it('scopes every rule under the root class', () => {
      const css = layoutStyleSheet('#dc2626');
      css.split('\n').forEach((rule) => expect(rule.startsWith('svg.layout')).toBe(true));
      expect(parse(richSvg()).documentElement.getAttribute('class')).toBe('layout');
    });

    it('emits only classes the writer declares, and every declared class has a rule', () => {
      const doc = parse(richSvg());
      const used = new Set([...doc.querySelectorAll('[class]')].flatMap((element) => [...element.classList]));
      used.forEach((name) => expect(EMITTABLE_CLASSES, name).toContain(name));
      ['kind-field', 'kind-missing', 'focus', 'type-calc', 'cross-arm', 'backward', 'mismatch', 'relative', 'repeating', 'lane', 'column', 'cluster', 'region',
        'node-label', 'node-sublabel', 'region-label', 'region-sublabel', 'edge-label'].forEach((name) => expect(used, name).toContain(name));
      const defined = new Set([...layoutStyleSheet('#dc2626').matchAll(/\.([a-z][\w-]*)/g)].map((match) => match[1]));
      EMITTABLE_CLASSES.filter((name) => !HOOK_CLASSES.includes(name)).forEach((name) => expect(defined, name).toContain(name));
    });

    it('defines the palette as custom properties on the root class, from the colour exports', () => {
      const css = layoutStyleSheet('#abcdef');
      expect(css.split('\n')[0]).toMatch(/^svg\.layout\{/);
      TYPE_NAMES.forEach((type) => expect(css).toContain(`--type-${type}:${TYPES[type].color}`));
      KINDS.forEach((kind) => {
        expect(css).toContain(`--kind-${kind}-fill:${KIND_FILL[kind]}`);
        expect(css).toContain(`--kind-${kind}-stroke:${KIND_STROKE[kind]}`);
      });
      expect(css).toContain('--cross-arm:#abcdef');
      expect(css).toContain('g.edge>path.edge-line{fill:none;stroke:var(--edge-color)');
    });

    it('writes the cross-arm colour edgeAppearance gives, so a saved svg carries it', () => {
      const svg = richSvg();
      expect(svg).toContain('<style>');
      expect(svg).toContain('--type-calc:');
      expect(parse(svg).querySelector('style')!.textContent).toContain('--cross-arm:');
    });

    it('defines every quantised width class', () => {
      const css = layoutStyleSheet('#dc2626');
      for (let width = 1; width <= 10; width += 0.5) expect(css).toContain(`g.edge.${widthClass(width)}{--edge-line-width:${width}px}`);
    });
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
