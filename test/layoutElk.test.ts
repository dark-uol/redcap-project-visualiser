// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { layoutElk } from '../src/lib/layoutElk';
import type { Layout, LayoutNode, Point } from '../src/lib/layout';
import type { EventDef, View, ViewEdge, ViewGroup } from '../src/lib/types';
import { makeView, node } from './fixtures';

const eventDef = (id: string, over: Partial<EventDef> = {}): EventDef =>
  ({ id, label: id.toUpperCase(), arm: '1', armName: 'Main', repeating: false, forms: ['f1'], ...over });

const link = (from: string, to: string): ViewEdge => ({ from, to, types: ['branching'], count: 1, byType: { branching: 1 } });

const group = (id: string, members: string[], over: Partial<ViewGroup> = {}): ViewGroup => ({ id, label: `Group ${id}`, nodes: members, ...over });

const layoutOf = (view: View, dir: 'LR' | 'TD' = 'TD', events: EventDef[] = []): Promise<Layout> => layoutElk(view, { dir }, events);

const placed = (layout: Layout, id: string): LayoutNode => layout.nodes.find((candidate) => candidate.id === id)!;

const overlaps = (first: LayoutNode, second: LayoutNode): boolean =>
  first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;

const containsBox = (outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }): boolean =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

/** The point lies on the border of the box (absolute coordinates), within a half pixel. */
const onBorder = (point: Point, box: { x: number; y: number; width: number; height: number }): boolean => {
  const tolerance = 0.5;
  const withinX = point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance;
  const withinY = point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance;
  const onVerticalSide = Math.abs(point.x - box.x) <= tolerance || Math.abs(point.x - (box.x + box.width)) <= tolerance;
  const onHorizontalSide = Math.abs(point.y - box.y) <= tolerance || Math.abs(point.y - (box.y + box.height)) <= tolerance;
  return withinX && withinY && (onVerticalSide || onHorizontalSide);
};

const expectEdgeEndsOnNodes = (layout: Layout, from: string, to: string): void => {
  const edge = layout.edges.find((candidate) => candidate.from === from && candidate.to === to);
  expect(edge, `edge ${from} -> ${to}`).toBeDefined();
  const points = edge!.points!;
  expect(points.length).toBeGreaterThanOrEqual(2);
  expect(onBorder(points[0], placed(layout, from)), `start of ${from} -> ${to}`).toBe(true);
  expect(onBorder(points[points.length - 1], placed(layout, to)), `end of ${from} -> ${to}`).toBe(true);
};

describe('layoutElk', () => {
  it('places every node without overlaps and returns the nodes in view order', async () => {
    const view = makeView({ nodes: [node('a'), node('b'), node('c'), node('d')], edges: [link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')] });
    const layout = await layoutOf(view);
    expect(layout.nodes.map((placedNode) => placedNode.id)).toEqual(['a', 'b', 'c', 'd']);
    for (const placedNode of layout.nodes) expect(placedNode.width).toBe(120);
    for (let first = 0; first < layout.nodes.length; first++) {
      for (let second = first + 1; second < layout.nodes.length; second++) {
        expect(overlaps(layout.nodes[first], layout.nodes[second])).toBe(false);
      }
    }
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('starts and ends every edge on its source and target boxes in absolute coordinates, also inside a group', async () => {
    const view = makeView({
      nodes: [node('a'), node('b'), node('c'), node('d')],
      edges: [link('a', 'b'), link('b', 'c'), link('c', 'a'), link('a', 'd')],
      groups: [group('g', ['b', 'c'])],
    });
    const layout = await layoutOf(view);
    expectEdgeEndsOnNodes(layout, 'a', 'b');
    expectEdgeEndsOnNodes(layout, 'b', 'c');
    expectEdgeEndsOnNodes(layout, 'c', 'a');
    expectEdgeEndsOnNodes(layout, 'a', 'd');
  });

  it('draws a group box that contains its member nodes', async () => {
    const view = makeView({
      nodes: [node('a'), node('b'), node('c')],
      edges: [link('a', 'b'), link('b', 'c')],
      groups: [group('g', ['a', 'b'])],
    });
    const layout = await layoutOf(view);
    const region = layout.regions.find((candidate) => candidate.groupIndex === 0)!;
    expect(region.kind).toBe('cluster');
    expect(region.id).toBe('g');
    expect(region.label).toBe('Group g');
    expect(containsBox(region, placed(layout, 'a'))).toBe(true);
    expect(containsBox(region, placed(layout, 'b'))).toBe(true);
    expect(containsBox(region, placed(layout, 'c'))).toBe(false);
  });

  it('nests a group inside its parent group, with both boxes containing their members', async () => {
    const view = makeView({
      nodes: [node('a'), node('b'), node('c')],
      edges: [link('a', 'b'), link('b', 'c'), link('c', 'a')],
      groups: [group('outer', ['a'], {}), group('inner', ['b'], { parent: 'outer' })],
    });
    const layout = await layoutOf(view);
    const outer = layout.regions.find((candidate) => candidate.id === 'outer')!;
    const inner = layout.regions.find((candidate) => candidate.id === 'inner')!;
    expect(containsBox(outer, inner)).toBe(true);
    expect(containsBox(outer, placed(layout, 'a'))).toBe(true);
    expect(containsBox(inner, placed(layout, 'b'))).toBe(true);
    expect(containsBox(inner, placed(layout, 'a'))).toBe(false);
    expectEdgeEndsOnNodes(layout, 'b', 'c');
    expectEdgeEndsOnNodes(layout, 'a', 'b');
    expectEdgeEndsOnNodes(layout, 'c', 'a');
  });

  it('flows along the dominant axis of the chosen direction', async () => {
    const view = makeView({ nodes: [node('a'), node('b'), node('c')], edges: [link('a', 'b'), link('b', 'c')] });
    const spanOf = (layout: Layout, axis: 'x' | 'y'): number => {
      const positions = layout.nodes.map((placedNode) => placedNode[axis]);
      return Math.max(...positions) - Math.min(...positions);
    };
    const down = await layoutOf(view, 'TD');
    expect(spanOf(down, 'y')).toBeGreaterThan(spanOf(down, 'x'));
    const right = await layoutOf(view, 'LR');
    expect(spanOf(right, 'x')).toBeGreaterThan(spanOf(right, 'y'));
    expect(placed(right, 'a').x).toBeLessThan(placed(right, 'b').x);
    expect(placed(right, 'b').x).toBeLessThan(placed(right, 'c').x);
  });

  it('partitions by event day: the earlier event is left of the later one', async () => {
    const events = [eventDef('e1', { dayOffset: 0 }), eventDef('e2', { dayOffset: 30 })];
    const view = makeView({
      level: 'form',
      nodes: [node('n1', { event: 'e1' }), node('n2', { event: 'e2' })],
      edges: [link('n1', 'n2')],
    });
    const layout = await layoutOf(view, 'LR', events);
    expect(placed(layout, 'n1').x).toBeLessThan(placed(layout, 'n2').x);
    expect(layout.edges[0].backward).toBe(false);
    expectEdgeEndsOnNodes(layout, 'n1', 'n2');
  });

  it('flags an edge from a later event back to an earlier one as backward and still routes it between the boxes', async () => {
    const events = [eventDef('e1', { dayOffset: 0 }), eventDef('e2', { dayOffset: 30 })];
    const view = makeView({
      level: 'form',
      nodes: [node('n1', { event: 'e1' }), node('n2', { event: 'e2' })],
      edges: [link('n1', 'n2'), link('n2', 'n1')],
    });
    const layout = await layoutOf(view, 'LR', events);
    const backwardEdge = layout.edges.find((edge) => edge.from === 'n2' && edge.to === 'n1')!;
    expect(backwardEdge.backward).toBe(true);
    expect(layout.edges.find((edge) => edge.from === 'n1' && edge.to === 'n2')!.backward).toBe(false);
    expectEdgeEndsOnNodes(layout, 'n2', 'n1');
    expectEdgeEndsOnNodes(layout, 'n1', 'n2');
  });

  it('keeps partitioned nodes inside their group box and their edges on the boxes', async () => {
    const events = [eventDef('e1', { dayOffset: 0 }), eventDef('e2', { dayOffset: 30 })];
    const view = makeView({
      level: 'form',
      nodes: [node('n1', { event: 'e1' }), node('n2', { event: 'e2' }), node('n3', { event: 'e2' })],
      edges: [link('n1', 'n2'), link('n3', 'n1')],
      groups: [group('g', ['n1', 'n3'])],
    });
    const layout = await layoutOf(view, 'LR', events);
    const region = layout.regions.find((candidate) => candidate.id === 'g')!;
    expect(containsBox(region, placed(layout, 'n1'))).toBe(true);
    expect(containsBox(region, placed(layout, 'n3'))).toBe(true);
    expect(containsBox(region, placed(layout, 'n2'))).toBe(false);
    expect(layout.edges.find((edge) => edge.from === 'n3' && edge.to === 'n1')!.backward).toBe(true);
    expectEdgeEndsOnNodes(layout, 'n1', 'n2');
    expectEdgeEndsOnNodes(layout, 'n3', 'n1');
  });

  it('gives equal days one partition, so nodes of both events on that day share a column', async () => {
    const events = [eventDef('e1', { dayOffset: 7 }), eventDef('e2', { dayOffset: 7 }), eventDef('e3', { dayOffset: 60 })];
    const view = makeView({
      level: 'form',
      nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' }), node('c', { event: 'e3' })],
      edges: [],
    });
    const layout = await layoutOf(view, 'LR', events);
    expect(placed(layout, 'a').x).toBe(placed(layout, 'b').x);
    expect(placed(layout, 'c').x).toBeGreaterThan(placed(layout, 'a').x);
  });
});
