import { describe, expect, it } from 'vitest';
import { MAX_COLUMN_ROWS, layoutSwimlane, originShift, shiftLayoutContents, wrapLabel } from '../src/lib/layoutSwimlane';
import { layoutToSvg } from '../src/lib/layoutToSvg';
import { countEdgesThroughNodes, countNodeOverlaps, countOverlappingSegments, isAxisAligned } from '../src/lib/layoutMetrics';
import { TRACK_SPACING } from '../src/lib/swimlaneRouting';
import { nodeBoxHeight } from '../src/lib/nodeBox';
import { resolveClick } from '../src/components/hitTest';
import type { EventDef, View, ViewEdge, ViewOptions } from '../src/lib/types';
import type { LayoutEdge, Point } from '../src/lib/layout';
import { makeView, node, nodesWithOverflowingText } from './fixtures';

const eventDef = (id: string, over: Partial<EventDef> = {}): EventDef =>
  ({ id, label: id.toUpperCase(), arm: '1', armName: 'Main', repeating: false, forms: ['f1'], ...over });

const link = (from: string, to: string): ViewEdge => ({ from, to, types: ['branching'], count: 1, byType: { branching: 1 } });

const findNode = (layout: ReturnType<typeof layoutSwimlane>, id: string) => layout.nodes.find((placed) => placed.id === id)!;
const centerOf = (layout: ReturnType<typeof layoutSwimlane>, id: string): number => {
  const placed = findNode(layout, id);
  return placed.x + placed.width / 2;
};

/** Every edge a right-angle polyline from a side of its source to a side of its target, entering and leaving perpendicular
 * to the side; no two edges on top of each other (or closer than a track apart), none through a node, all inside the layout. */
const expectCleanRoutes = (layout: ReturnType<typeof layoutSwimlane>): void => {
  layout.edges.forEach((edge) => {
    const label = `${edge.from}>${edge.to}`;
    expect(edge.curve, label).toBeUndefined();
    const points = edge.points!;
    expect(points.length, label).toBeGreaterThanOrEqual(2);
    expect(isAxisAligned(points), label).toBe(true);
    const [first, second, beforeLast, last] = [points[0], points[1], points[points.length - 2], points[points.length - 1]];
    const source = findNode(layout, edge.from);
    const target = findNode(layout, edge.to);
    expect(first.x === source.x || first.x === source.x + source.width, `${label} leaves from a side`).toBe(true);
    expect(first.y > source.y && first.y < source.y + source.height, `${label} leaves within the side`).toBe(true);
    expect(last.x === target.x || last.x === target.x + target.width, `${label} ends on a side`).toBe(true);
    expect(last.y > target.y && last.y < target.y + target.height, `${label} ends within the side`).toBe(true);
    expect(second.y, `${label} leaves perpendicular`).toBe(first.y);
    expect(beforeLast.y, `${label} arrives perpendicular`).toBe(last.y);
    points.forEach((point) => {
      expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(layout.width);
      expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(layout.height);
    });
  });
  expect(countOverlappingSegments(layout, TRACK_SPACING - 1)).toBe(0);
  expect(countEdgesThroughNodes(layout)).toBe(0);
  expect(countNodeOverlaps(layout)).toBe(0);
};

describe('layoutSwimlane', () => {
  it('makes one lane per arm in order of first appearance, labelled with number and name', () => {
    const events = [eventDef('a1', { arm: '2', armName: 'Control' }), eventDef('b1', { arm: '1', armName: 'Treat' }), eventDef('a2', { arm: '2', armName: 'Control' })];
    const view = makeView({ nodes: [node('n1', { event: 'a1' }), node('n2', { event: 'b1' }), node('n3', { event: 'a2' })] });
    const layout = layoutSwimlane(view, events);
    const lanes = layout.regions.filter((region) => region.kind === 'lane');
    expect(lanes.map((lane) => lane.label)).toEqual(['Arm 2: Control', 'Arm 1: Treat']);
    expect(lanes[1].y).toBeGreaterThan(lanes[0].y + lanes[0].height - 1);
    expect(findNode(layout, 'n2').y).toBeGreaterThanOrEqual(lanes[1].y);
    expect(layout.regions.filter((region) => region.kind === 'column')).toHaveLength(3);
  });

  it('only creates columns for events that contain nodes', () => {
    const events = [eventDef('e1'), eventDef('e2'), eventDef('e3', { arm: '2' })];
    const layout = layoutSwimlane(makeView({ nodes: [node('n', { event: 'e2' })] }), events);
    expect(layout.regions.filter((region) => region.kind === 'lane')).toHaveLength(1);
    expect(layout.regions.filter((region) => region.kind === 'column').map((region) => region.label)).toEqual(['E2']);
  });

  it('scales x by day offset when every drawn event has one', () => {
    const events = [eventDef('e1', { dayOffset: 0 }), eventDef('e2', { dayOffset: 30 }), eventDef('e3', { dayOffset: 90 })];
    const view = makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' }), node('c', { event: 'e3' })] });
    const layout = layoutSwimlane(view, events);
    expect(centerOf(layout, 'b') - centerOf(layout, 'a')).toBe(300);
    expect(centerOf(layout, 'c') - centerOf(layout, 'b')).toBe(600);
  });

  it('falls back to event order when a drawn event lacks a day offset', () => {
    const events = [eventDef('e1', { dayOffset: 0 }), eventDef('e2'), eventDef('e3', { dayOffset: 1 })];
    const view = makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' }), node('c', { event: 'e3' })] });
    const layout = layoutSwimlane(view, events);
    expect(centerOf(layout, 'b') - centerOf(layout, 'a')).toBe(160);
    expect(centerOf(layout, 'c') - centerOf(layout, 'b')).toBe(160);
  });

  it('enforces the minimum column pitch without reordering', () => {
    const events = [eventDef('e1', { dayOffset: 0 }), eventDef('e2', { dayOffset: 2 }), eventDef('e3', { dayOffset: 3 })];
    const view = makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' }), node('c', { event: 'e3' })] });
    const layout = layoutSwimlane(view, events);
    expect(centerOf(layout, 'b') - centerOf(layout, 'a')).toBe(160);
    expect(centerOf(layout, 'c') - centerOf(layout, 'b')).toBe(160);
  });

  it('lets equal-day events in different arms share an x, but not within one arm', () => {
    const events = [eventDef('a', { dayOffset: 5 }), eventDef('b', { dayOffset: 5, arm: '2', armName: 'Other' }), eventDef('c', { dayOffset: 5 })];
    const view = makeView({ nodes: [node('na', { event: 'a' }), node('nb', { event: 'b' }), node('nc', { event: 'c' })] });
    const layout = layoutSwimlane(view, events);
    expect(centerOf(layout, 'nb')).toBe(centerOf(layout, 'na'));
    expect(centerOf(layout, 'nc')).toBe(centerOf(layout, 'na') + 160);
  });

  it('fills column labels: sublabel from day and window, repeating copied', () => {
    const events = [
      eventDef('e1', { dayOffset: 30, offsetMin: 7, offsetMax: 7, repeating: true }),
      eventDef('e2', { dayOffset: 60, offsetMin: 3, offsetMax: 5 }),
      eventDef('e3', { dayOffset: 90 }),
      eventDef('e4'),
    ];
    const view = makeView({ nodes: events.map((event, index) => node(`n${index}`, { event: event.id })) });
    const columns = layoutSwimlane(view, events).regions.filter((region) => region.kind === 'column');
    expect(columns.map((column) => column.sublabel)).toEqual(['day 30 (±7)', 'day 60 (-3/+5)', 'day 90', undefined]);
    expect(columns[0].repeating).toBe(true);
    expect(columns[1].repeating).toBe(false);
  });

  it('stacks nodes in a column with a gap and reserves a header', () => {
    const events = [eventDef('e1', { forms: ['f2', 'f1'] })];
    const view = makeView({ nodes: [node('x', { event: 'e1', form: 'f1' }), node('y', { event: 'e1', form: 'f2' })] });
    const layout = layoutSwimlane(view, events);
    const lane = layout.regions.find((region) => region.kind === 'lane')!;
    expect(findNode(layout, 'y').y).toBe(lane.y + 26);
    expect(findNode(layout, 'x').y).toBe(findNode(layout, 'y').y + 28 + 18);
    expect(layout.height).toBeGreaterThanOrEqual(lane.y + lane.height + 20);
    expect(layout.width).toBeGreaterThanOrEqual(findNode(layout, 'x').x + 120 + 20);
  });

  it('flags backward edges, and routes both directions of a pair between the facing sides, apart', () => {
    const events = [eventDef('e1'), eventDef('e2')];
    const view = makeView({
      nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' })],
      edges: [link('a', 'b'), link('b', 'a')],
    });
    const layout = layoutSwimlane(view, events);
    const forward = layout.edges.find((edge) => edge.from === 'a')!;
    const backward = layout.edges.find((edge) => edge.from === 'b')!;
    const [a, b] = [findNode(layout, 'a'), findNode(layout, 'b')];
    expect(forward.backward).toBe(false);
    expect(forward.points![0].x).toBe(a.x + 120);
    expect(forward.points!.at(-1)!.x).toBe(b.x);
    expect(backward.backward).toBe(true);
    expect(backward.points![0].x).toBe(b.x);
    expect(backward.points!.at(-1)!.x).toBe(a.x + 120);
    expect(forward.points![0].y).not.toBe(backward.points!.at(-1)!.y);
    expectCleanRoutes(layout);
  });

  it('connects nodes in the same column through the gutter beside them', () => {
    const events = [eventDef('e1', { forms: ['f1', 'f2'] })];
    const view = makeView({
      nodes: [node('a', { event: 'e1', form: 'f1' }), node('b', { event: 'e1', form: 'f2' })],
      edges: [link('a', 'b')],
    });
    const layout = layoutSwimlane(view, events);
    const [edge] = layout.edges;
    const a = findNode(layout, 'a');
    expect(edge.backward).toBe(false);
    expect(edge.points!.length).toBe(4);
    // out of a side, along the gutter, into the same side of b
    expect(edge.points![0].x).toBe(edge.points![3].x);
    expect(edge.points![1].x < a.x || edge.points![1].x > a.x + a.width).toBe(true);
    expectCleanRoutes(layout);
  });

  it('puts nodes with a missing or unknown event into one "(no event)" lane with a single column', () => {
    const events = [eventDef('e1')];
    const view = makeView({
      level: 'form',
      nodes: [node('a', { event: 'e1' }), node('b', { event: null, form: 'none' }), node('c', { form: 'none' }), node('d', { event: 'ghost', form: 'none' })],
    });
    const layout = layoutSwimlane(view, events);
    const lanes = layout.regions.filter((region) => region.kind === 'lane');
    expect(lanes.map((lane) => lane.label)).toEqual(['Arm 1: Main', '(no event)']);
    const noEventColumns = layout.regions.filter((region) => region.kind === 'column' && region.y === lanes[1].y);
    expect(noEventColumns).toHaveLength(1);
    expect(new Set(['b', 'c', 'd'].map((id) => findNode(layout, id).x)).size).toBe(1);
    expect(findNode(layout, 'b').y).toBeGreaterThanOrEqual(lanes[1].y);
  });

  it('skips edges whose endpoints are not laid out', () => {
    const events = [eventDef('e1')];
    const view = makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: 'e1' })], edges: [link('a', 'b'), link('a', 'missing'), link('missing', 'b')] });
    const layout = layoutSwimlane(view, events);
    expect(layout.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(['a>b']);
  });

  it('reduces crossings with a barycentre sweep and is deterministic', () => {
    const events = [eventDef('e1', { forms: ['f1', 'f2'] }), eventDef('e2', { forms: ['f3', 'f4'] })];
    const view = makeView({
      nodes: [
        node('a', { event: 'e1', form: 'f1' }), node('b', { event: 'e1', form: 'f2' }),
        node('c', { event: 'e2', form: 'f3' }), node('d', { event: 'e2', form: 'f4' }),
      ],
      edges: [link('a', 'd'), link('b', 'c')],
    });
    const layout = layoutSwimlane(view, events);
    expect(findNode(layout, 'd').y).toBeLessThan(findNode(layout, 'c').y);
    expect(layoutSwimlane(view, events)).toEqual(layout);
  });

  it('routes a same-column edge around the nodes between its ends', () => {
    const events = [eventDef('e1', { forms: ['f1', 'f2', 'f3'] })];
    const view = makeView({
      nodes: [node('a', { event: 'e1', form: 'f1' }), node('b', { event: 'e1', form: 'f2' }), node('c', { event: 'e1', form: 'f3' })],
      edges: [link('c', 'a')],
    });
    const layout = layoutSwimlane(view, events);
    expect(routeHitCount(layout, layout.edges[0])).toBe(0);
    expectCleanRoutes(layout);
  });

  it('routes an edge between lanes that share a column x around every node in the way', () => {
    const events = [eventDef('e1', { dayOffset: 0, forms: ['f1', 'f2'] }), eventDef('e2', { arm: '2', dayOffset: 0, forms: ['f1'] })];
    const view = makeView({
      nodes: [node('a', { event: 'e1', form: 'f1' }), node('b', { event: 'e1', form: 'f2' }), node('c', { event: 'e2', form: 'f1' }), node('u', { event: null })],
      edges: [link('u', 'a')],
    });
    const layout = layoutSwimlane(view, events);
    expect(routeHitCount(layout, layout.edges[0])).toBe(0);
    expectCleanRoutes(layout);
  });

  it('keeps the two edges of a reciprocal same-column pair apart', () => {
    const view = makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: 'e1' })], edges: [link('a', 'b'), link('b', 'a')] });
    const layout = layoutSwimlane(view, [eventDef('e1')]);
    const [forward, back] = layout.edges;
    expect(forward.points![0]).not.toEqual(back.points!.at(-1));
    expect(forward.points!.at(-1)).not.toEqual(back.points![0]);
    expectCleanRoutes(layout);
  });

  it('wraps a long event name in the column header and grows the header to fit', () => {
    const longName = 'Long-term outcome assessment, twelve months after delivery';
    const events = [eventDef('e1', { label: longName, dayOffset: 365 })];
    const layout = layoutSwimlane(makeView({ nodes: [node('x', { event: 'e1' })] }), events);
    const column = layout.regions.find((region) => region.kind === 'column')!;
    expect(column.label).toBe(longName);
    expect(column.labelLines!.length).toBeGreaterThan(1);
    expect(column.labelLines!.length).toBeLessThanOrEqual(3);
    const lane = layout.regions.find((region) => region.kind === 'lane')!;
    expect(findNode(layout, 'x').y).toBeGreaterThanOrEqual(lane.y + 12 + 14 * column.labelLines!.length + 14);
  });

  it('places event-level nodes, whose ids are event ids, in their event columns', () => {
    const events = [eventDef('e1', { dayOffset: 0 }), eventDef('e2', { dayOffset: 30 })];
    const view = makeView({ level: 'event', nodes: [node('e1'), node('e2')], edges: [link('e1', 'e2')] });
    const layout = layoutSwimlane(view, events);
    expect(layout.regions.filter((region) => region.kind === 'column')).toHaveLength(2);
    expect(centerOf(layout, 'e2') - centerOf(layout, 'e1')).toBe(300);
  });
});

describe('layoutSwimlane expanded events', () => {
  it('gives the column of an expanded event the index of its group, and no other column one', () => {
    const events = [eventDef('e1', { forms: ['f1'] }), eventDef('e2')];
    const view = makeView({
      level: 'event',
      nodes: [node('f1@e1', { event: 'e1', form: 'f1', kind: 'form' }), node('e2', { kind: 'form' })],
      groups: [{ id: 'e1', label: 'E1', nodes: ['f1@e1'] }],
    });
    const columns = layoutSwimlane(view, events).regions.filter((region) => region.kind === 'column');
    expect(columns.find((column) => column.id === 'column:e1')!.groupIndex).toBe(0);
    expect(columns.find((column) => column.id === 'column:e2')!.groupIndex).toBeUndefined();
  });
});

describe('layoutSwimlane clusters', () => {
  it('boxes the fields of a zoomed-in form and keeps them together', () => {
    const events = [eventDef('e1', { forms: ['f1', 'f2'] })];
    const fieldNode = (id: string) => node(id, { event: 'e1', form: 'f1', field: id });
    const view = makeView({
      nodes: [fieldNode('a'), node('other', { event: 'e1', form: 'f2' }), fieldNode('b')],
      groups: [{ id: 'f1@e1', label: 'Form 1 @ E1', nodes: ['a', 'b'] }],
      expandedNodes: [node('f1@e1', { event: 'e1', form: 'f1' })],
    });
    const layout = layoutSwimlane(view, events);
    const cluster = layout.regions.find((region) => region.kind === 'cluster')!;
    const [a, b, other] = ['a', 'b', 'other'].map((id) => findNode(layout, id));
    expect(Math.abs(a.y - b.y)).toBe(28 + 18);
    for (const member of [a, b]) {
      expect(member.y).toBeGreaterThan(cluster.y);
      expect(member.y + member.height).toBeLessThan(cluster.y + cluster.height);
    }
    expect(other.y >= cluster.y + cluster.height || other.y + other.height <= cluster.y).toBe(true);
  });
});

describe('layoutSwimlane at field level', () => {
  const events = [eventDef('e1', { forms: ['f1', 'f2'] }), eventDef('e2', { forms: ['f2', 'f3'] })];
  const fieldNode = (id: string, form: string) => node(id, { form, field: id });
  const fieldView = (groups: View['groups'] = []) => makeView({
    level: 'field',
    nodes: [fieldNode('a', 'f1'), fieldNode('b', 'f2'), fieldNode('c', 'f2'), fieldNode('d', 'f3'), fieldNode('lonely', 'f9')],
    groups,
  });
  const columnOf = (layout: ReturnType<typeof layoutSwimlane>, id: string): string => {
    const placed = findNode(layout, id);
    const column = layout.regions.find((region) => region.kind === 'column' && placed.x >= region.x && placed.x < region.x + region.width && placed.y >= region.y && placed.y < region.y + region.height)!;
    return column.label;
  };

  it('puts each field in the column of the first event that collects its form, once', () => {
    const layout = layoutSwimlane(fieldView(), events);
    expect(columnOf(layout, 'a')).toBe('E1');
    expect(columnOf(layout, 'b')).toBe('E1'); // f2 is in both events: first only
    expect(columnOf(layout, 'c')).toBe('E1');
    expect(columnOf(layout, 'd')).toBe('E2');
    expect(layout.nodes.map((placed) => placed.id).sort()).toEqual(['a', 'b', 'c', 'd', 'lonely']);
  });

  it('sends a field whose form is in no event to the (no event) lane', () => {
    const layout = layoutSwimlane(fieldView(), events);
    expect(columnOf(layout, 'lonely')).toBe('(no event)');
  });

  it('boxes a form around its contiguous fields with the form group index', () => {
    const groups = [
      { id: 'f1', label: 'Form 1', nodes: ['a'] },
      { id: 'f2', label: 'Form 2', nodes: ['b', 'c'] },
    ];
    const layout = layoutSwimlane(fieldView(groups), events);
    const clusters = layout.regions.filter((region) => region.kind === 'cluster');
    expect(clusters.map((region) => region.groupIndex)).toEqual([0, 1]);
    const box = clusters[1];
    for (const id of ['b', 'c']) {
      const member = findNode(layout, id);
      expect(member.y).toBeGreaterThan(box.y);
      expect(member.y + member.height).toBeLessThan(box.y + box.height);
    }
    expect(Math.abs(findNode(layout, 'b').y - findNode(layout, 'c').y)).toBe(28 + 18);
  });

  it('draws no boxes for event or arm groups, which are the columns and lanes', () => {
    const groups = [
      { id: 'event:e1', label: 'E1', nodes: ['a', 'b', 'c'], noSelect: true },
      { id: 'arm:1', label: 'Arm 1', nodes: ['d'], noSelect: true },
    ];
    expect(layoutSwimlane(fieldView(groups), events).regions.filter((region) => region.kind === 'cluster')).toEqual([]);
  });

  it('draws one box per column when a form lands in several columns', () => {
    const groups = [{ id: 'mixed', label: 'Mixed', nodes: ['a', 'd'] }];
    const layout = layoutSwimlane(fieldView(groups), events);
    const clusters = layout.regions.filter((region) => region.kind === 'cluster');
    expect(clusters).toHaveLength(2);
    expect(clusters.every((region) => region.groupIndex === 0)).toBe(true);
    expect(new Set(clusters.map((region) => region.id)).size).toBe(2);
  });

  it('resolves a click on a form box to a form selection', () => {
    const groups = [{ id: 'f2', label: 'Form 2', nodes: ['b', 'c'] }];
    const view = fieldView(groups);
    const layout = layoutSwimlane(view, events);
    const options: ViewOptions = {
      level: 'field', eventSet: null, types: new Set(), forms: null, formsNone: false, crossOnly: false, instOnly: false,
      instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both',
      focusDepth: 0, showMissing: false, hideIsolated: false, hideIsolatedNodes: false,
      dir: 'LR', labelMode: 'var', group: true, groupBy: 'form', edgeLabels: false, lineWidths: true,
    };
    const document = new DOMParser().parseFromString(layoutToSvg(layout, view, options), 'image/svg+xml');
    const cluster = document.querySelector('g.cluster')!;
    expect(resolveClick(cluster, view, (id) => id === 'f2')).toEqual({ type: 'select', id: '@form:f2' });
  });
});

describe('layoutSwimlane at form level without instances', () => {
  const events = [eventDef('e1', { forms: ['f1', 'f2'] }), eventDef('e2', { forms: ['f2', 'f3'] })];
  const formNode = (id: string, form: string) => node(id, { form, kind: 'form' });

  it('places each form node in the first event that collects the form, and forms in no event in "(no event)"', () => {
    const view = makeView({ level: 'form', nodes: [formNode('f1', 'f1'), formNode('f2', 'f2'), formNode('f3', 'f3'), formNode('f9', 'f9')] });
    const layout = layoutSwimlane(view, events);
    const columns = layout.regions.filter((region) => region.kind === 'column');
    const columnLabelOf = (id: string): string => {
      const placed = findNode(layout, id);
      return columns.find((column) => placed.x >= column.x && placed.x < column.x + column.width && placed.y >= column.y && placed.y < column.y + column.height)!.label;
    };
    expect(columnLabelOf('f1')).toBe('E1');
    expect(columnLabelOf('f2')).toBe('E1');
    expect(columnLabelOf('f3')).toBe('E2');
    expect(columnLabelOf('f9')).toBe('(no event)');
  });

  it('still places form instances by their own event when instances are on', () => {
    const view = makeView({ level: 'form', nodes: [node('f2@e1', { form: 'f2', event: 'e1', kind: 'form' }), node('f2@e2', { form: 'f2', event: 'e2', kind: 'form' })] });
    const layout = layoutSwimlane(view, events);
    expect(findNode(layout, 'f2@e2').x).toBeGreaterThan(findNode(layout, 'f2@e1').x);
  });
});

type SwimlaneLayout = ReturnType<typeof layoutSwimlane>;
const overlaps = (first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }): boolean =>
  first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;

describe('layoutSwimlane tall columns', () => {
  const count = 60;
  const events = [eventDef('e1', { dayOffset: 0, forms: ['f1', 'f2'] }), eventDef('e2', { dayOffset: 1, forms: ['f3'] })];
  const manyNodes = (total: number, form: (index: number) => string) =>
    Array.from({ length: total }, (_, index) => node(`n${index}`, { form: form(index), field: `n${index}` }));
  const tallView = (groups: View['groups'] = [], edges: ViewEdge[] = []) =>
    makeView({ level: 'field', nodes: [...manyNodes(count, (index) => (index < 40 ? 'f1' : 'f2')), node('later', { form: 'f3', field: 'later' })], groups, edges });
  const columnRegion = (layout: SwimlaneLayout, id: string) => layout.regions.find((region) => region.id === `column:${id}`)!;

  it('flows more than MAX_COLUMN_ROWS nodes into several sub-columns of at most that many rows', () => {
    const layout = layoutSwimlane(tallView(), events);
    const firstColumn = columnRegion(layout, 'e1');
    const members = layout.nodes.filter((placed) => placed.id.startsWith('n'));
    const xs = [...new Set(members.map((placed) => placed.x))].sort((first, second) => first - second);
    expect(xs).toHaveLength(Math.ceil(count / MAX_COLUMN_ROWS));
    xs.forEach((x) => expect(members.filter((placed) => placed.x === x).length).toBeLessThanOrEqual(MAX_COLUMN_ROWS));
    expect(firstColumn.width).toBe(xs.length * 160);
    members.forEach((placed) => {
      expect(placed.x).toBeGreaterThanOrEqual(firstColumn.x);
      expect(placed.x + placed.width).toBeLessThanOrEqual(firstColumn.x + firstColumn.width);
    });
  });

  it('keeps one sub-column unwrapped at the limit, and grows the width and shrinks the height when wrapped', () => {
    const atLimit = layoutSwimlane(makeView({ level: 'field', nodes: manyNodes(MAX_COLUMN_ROWS, () => 'f1') }), events);
    expect(columnRegion(atLimit, 'e1').width).toBe(160);
    const single = layoutSwimlane(makeView({ level: 'field', nodes: manyNodes(count, () => 'f1').slice(0, MAX_COLUMN_ROWS) }), events);
    const wrapped = layoutSwimlane(tallView(), events);
    expect(wrapped.width).toBeGreaterThan(single.width);
    const unwrappedHeight = 20 + 26 + (count + 1) * 28 + count * 18; // roughly one column of every node
    expect(wrapped.height).toBeLessThan(unwrappedHeight / 2);
  });

  it('has unique ids, no overlapping nodes, and a later column that starts right of the wide one', () => {
    const layout = layoutSwimlane(tallView(), events);
    expect(new Set(layout.nodes.map((placed) => placed.id)).size).toBe(count + 1);
    layout.nodes.forEach((first, index) => layout.nodes.slice(index + 1).forEach((second) => expect(overlaps(first, second)).toBe(false)));
    const first = columnRegion(layout, 'e1');
    const second = columnRegion(layout, 'e2');
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
    expect(layout.width).toBeGreaterThanOrEqual(second.x + second.width);
  });

  it('shares an x between equal-day columns of different arms, and pushes the next one past the widest', () => {
    const shared = [
      eventDef('a', { dayOffset: 5, forms: ['f1'] }), eventDef('b', { dayOffset: 5, arm: '2', armName: 'Other', forms: ['f2'] }), eventDef('c', { dayOffset: 6, forms: ['f3'] }),
    ];
    const view = makeView({
      level: 'field',
      nodes: [...manyNodes(60, () => 'f1'), node('b1', { form: 'f2', field: 'b1' }), node('c1', { form: 'f3', field: 'c1' })],
    });
    const layout = layoutSwimlane(view, shared);
    const [wide, narrow, next] = ['a', 'b', 'c'].map((id) => columnRegion(layout, id));
    expect(narrow.x + narrow.width / 2).toBe(wide.x + wide.width / 2);
    expect(next.x).toBeGreaterThanOrEqual(wide.x + wide.width);
  });

  it('does not overlap nodes when a wide column shares an x with a column of another arm that follows its own arm\'s previous column', () => {
    const shared = [
      eventDef('p', { dayOffset: 4, forms: ['f0'] }),
      eventDef('a', { dayOffset: 5, arm: '2', armName: 'Other', forms: ['f2'] }),
      eventDef('b', { dayOffset: 5, forms: ['f1'] }),
    ];
    const view = makeView({
      level: 'field',
      nodes: [node('p1', { form: 'f0', field: 'p1' }), node('a1', { form: 'f2', field: 'a1' }), ...manyNodes(60, () => 'f1')],
    });
    const layout = layoutSwimlane(view, shared);
    layout.nodes.forEach((first, index) => layout.nodes.slice(index + 1).forEach((second) => expect(overlaps(first, second)).toBe(false)));
    const columns = layout.regions.filter((region) => region.kind === 'column');
    columns.forEach((first, index) => columns.slice(index + 1).forEach((second) => {
      if (first.y === second.y) expect(first.x < second.x + second.width && second.x < first.x + first.width).toBe(false);
    }));
  });

  it('centres the column header over the full width', () => {
    const layout = layoutSwimlane(tallView(), events);
    const column = columnRegion(layout, 'e1');
    expect(column.width).toBeGreaterThan(160);
    expect(column.labelLines).toBeDefined();
    const svg = layoutToSvg(layout, tallView(), {
      level: 'field', eventSet: null, types: new Set(), forms: null, formsNone: false, crossOnly: false, instOnly: false,
      instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both',
      focusDepth: 0, showMissing: false, hideIsolated: false, hideIsolatedNodes: false,
      dir: 'LR', labelMode: 'var', group: true, groupBy: 'form', edgeLabels: false, lineWidths: true,
    });
    expect(svg).toContain(`x="${column.x + column.width / 2}"`);
  });

  it('fills column-major and draws one box per sub-column for a form, enclosing its members, with one group index', () => {
    const groups = [
      { id: 'f1', label: 'Form 1', nodes: Array.from({ length: 40 }, (_, index) => `n${index}`) },
      { id: 'f2', label: 'Form 2', nodes: Array.from({ length: 20 }, (_, index) => `n${40 + index}`) },
    ];
    const layout = layoutSwimlane(tallView(groups), events);
    const boxes = layout.regions.filter((region) => region.kind === 'cluster');
    expect(new Set(boxes.map((box) => box.id)).size).toBe(boxes.length);
    expect(boxes.filter((box) => box.groupIndex === 0).length).toBeGreaterThan(1);
    groups.forEach((group, groupIndex) => {
      const own = boxes.filter((box) => box.groupIndex === groupIndex);
      group.nodes.forEach((id) => {
        const member = findNode(layout, id);
        expect(own.some((box) => member.x >= box.x && member.x + member.width <= box.x + box.width && member.y >= box.y && member.y + member.height <= box.y + box.height)).toBe(true);
      });
    });
    // contiguity: within a sub-column the nodes run in order, and the next sub-column continues the sequence
    const order = layout.nodes.filter((placed) => placed.id.startsWith('n')).sort((first, second) => first.x - second.x || first.y - second.y).map((placed) => placed.id);
    expect(order).toEqual(order.slice().sort((first, second) => Number(first.slice(1)) - Number(second.slice(1))));
  });

  it('routes edges between neighbouring sub-columns and within one around the nodes in the way', () => {
    const edges = [link('n0', 'n30'), link('n30', 'n3'), link('n10', 'n11'), link('n5', 'n12'), link('n40', 'n25')];
    const layout = layoutSwimlane(tallView([], edges), events);
    expect(layout.edges).toHaveLength(edges.length);
    const crossing = layout.edges.filter((edge) => routeHitCount(layout, edge) > 0);
    expect(crossing.map((edge) => `${edge.from}>${edge.to}`)).toEqual([]);
  });
});

/** Points every 4 px along an edge's polyline. */
const routeSamples = (edge: LayoutEdge): Point[] => {
  const samples: Point[] = [];
  const points = edge.points!;
  for (let index = 1; index < points.length; index++) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    const steps = Math.max(1, Math.ceil(length / 4));
    for (let step = 0; step <= steps; step++) {
      samples.push({ x: points[index - 1].x + (points[index].x - points[index - 1].x) * step / steps, y: points[index - 1].y + (points[index].y - points[index - 1].y) * step / steps });
    }
  }
  return samples;
};

/** How many nodes other than the edge's endpoints the route passes through. */
const routeHitCount = (layout: SwimlaneLayout, edge: LayoutEdge): number => {
  const samples = routeSamples(edge);
  return layout.nodes.filter((placed) => placed.id !== edge.from && placed.id !== edge.to
    && samples.some((point) => point.x > placed.x && point.x < placed.x + placed.width && point.y > placed.y && point.y < placed.y + placed.height)).length;
};

describe('layoutSwimlane gutter routing', () => {
  // One column of 25 stacked nodes with a wall of blockers: n0 (top) to n24 (bottom) in the same sub-column, plus a second
  // sub-column so Beziers bowing sideways hit it. Every Bezier candidate of the far edge hits something; the gutter is free.
  const events = [eventDef('e1', { dayOffset: 0, forms: ['f1'] }), eventDef('e2', { dayOffset: 1, forms: ['f2'] }), eventDef('e3', { dayOffset: 2, forms: ['f3'] })];
  const fieldNodes = (prefix: string, form: string, total: number) => Array.from({ length: total }, (_, index) => node(`${prefix}${index}`, { form, field: `${prefix}${index}` }));
  const wallView = (edges: ViewEdge[]) => makeView({ level: 'field', nodes: [...fieldNodes('a', 'f1', 25), ...fieldNodes('b', 'f2', 25), ...fieldNodes('c', 'f3', 25)], edges });
  const wallEdges = [link('a0', 'c24'), link('a24', 'c0'), link('a10', 'c12'), link('c3', 'a20'), link('b0', 'b24'), link('a5', 'a20')];

  it('draws every edge as a polyline that clears every node, curves nowhere', () => {
    const layout = layoutSwimlane(wallView(wallEdges), events);
    expect(layout.edges).toHaveLength(wallEdges.length);
    layout.edges.forEach((edge) => {
      expect(edge.curve).toBeUndefined();
      expect(routeHitCount(layout, edge)).toBe(0);
    });
  });

  it('starts and ends a polyline on the sides of its own boxes', () => {
    const layout = layoutSwimlane(wallView(wallEdges), events);
    layout.edges.forEach((edge) => {
      const points = edge.points!;
      const onSide = (point: Point, id: string): boolean => {
        const placed = findNode(layout, id);
        return (point.x === placed.x || point.x === placed.x + placed.width) && point.y > placed.y && point.y < placed.y + placed.height;
      };
      expect(onSide(points[0], edge.from)).toBe(true);
      expect(onSide(points[points.length - 1], edge.to)).toBe(true);
    });
  });

  it('never hits more nodes than the first candidate, and strictly fewer on seeded random layouts', () => {
    let state = 99;
    const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    let routedHits = 0;
    let routed = 0;
    for (let trial = 0; trial < 6; trial++) {
      const edges: ViewEdge[] = [];
      for (let count = 0; count < 120; count++) {
        const from = `${'abc'[Math.floor(random() * 3)]}${Math.floor(random() * 25)}`;
        const to = `${'abc'[Math.floor(random() * 3)]}${Math.floor(random() * 25)}`;
        if (from !== to) edges.push(link(from, to));
      }
      const layout = layoutSwimlane(wallView(edges), events);
      layout.edges.forEach((edge) => { routed++; routedHits += routeHitCount(layout, edge) > 0 ? 1 : 0; });
    }
    expect(routed).toBeGreaterThan(500);
    expect(routedHits / routed).toBeLessThan(0.02);
  });

  it('keeps every route inside the layout bounds, and leaves the width alone when nothing sticks out', () => {
    const sticksOut = layoutSwimlane(makeView({
      level: 'field', nodes: [node('a', { form: 'f1', field: 'a' }), node('b', { form: 'f1', field: 'b' }), node('c', { form: 'f1', field: 'c' })],
      edges: [link('c', 'a'), link('a', 'c')],
    }), [eventDef('e1', { forms: ['f1'] })]);
    sticksOut.edges.forEach((edge) => routeSamples(edge).forEach((point) => {
      expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(sticksOut.width);
      expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(sticksOut.height);
    }));
    sticksOut.regions.filter((region) => region.kind === 'lane').forEach((lane) => expect(lane.width).toBe(sticksOut.width));
    const withoutEdges = layoutSwimlane(makeView({ level: 'field', nodes: [node('a', { form: 'f1', field: 'a' })] }), [eventDef('e1', { forms: ['f1'] })]);
    expect(layoutSwimlane(makeView({ level: 'field', nodes: [node('a', { form: 'f1', field: 'a' })], edges: [] }), [eventDef('e1', { forms: ['f1'] })]).width).toBe(withoutEdges.width);
  });

  it('grows the height for a backward edge that bows below the last lane', () => {
    const layout = layoutSwimlane(makeView({
      nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' })], edges: [link('b', 'a')],
    }), [eventDef('e1'), eventDef('e2')]);
    layout.edges.forEach((edge) => routeSamples(edge).forEach((point) => expect(point.y).toBeLessThanOrEqual(layout.height)));
    const base = layoutSwimlane(makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' })] }), [eventDef('e1'), eventDef('e2')]);
    expect(layout.width).toBe(base.width);
  });

  it('shifts the drawing right when a route would leave the left edge', () => {
    // a same-column edge bowed to the left of the first column
    const layout = layoutSwimlane(makeView({
      level: 'field', nodes: ['a', 'b', 'c', 'd'].map((id) => node(id, { form: 'f1', field: id })),
      edges: [link('d', 'a'), link('a', 'd'), link('c', 'a'), link('b', 'd')],
    }), [eventDef('e1', { forms: ['f1'] })]);
    layout.edges.forEach((edge) => routeSamples(edge).forEach((point) => expect(point.x).toBeGreaterThanOrEqual(0)));
  });
});

describe('wrapLabel', () => {
  it('wraps on words, splits long words and ends in an ellipsis when cut', () => {
    expect(wrapLabel('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapLabel('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapLabel('aaa bbb ccc ddd', 3, 2)).toEqual(['aaa', 'bb…']);
    expect(wrapLabel('', 5)).toEqual(['']);
  });
});

const drawOptions = (labelMode: ViewOptions['labelMode'] = 'var'): ViewOptions => ({
  level: 'field', eventSet: null, types: new Set(), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both',
  focusDepth: 0, showMissing: false, hideIsolated: false, hideIsolatedNodes: false,
  dir: 'LR', labelMode, group: false, groupBy: 'none', edgeLabels: false, lineWidths: true,
});

describe('layoutSwimlane node heights', () => {
  const events = [eventDef('e1', { forms: ['f1'] })];
  const undefinedNode = node('undef', { form: 'f1', field: 'undef', kind: 'missing', extra: ['alpha', 'beta', 'gamma', 'delta'] });

  it('gives a node with extra lines a taller box than a single-line node, and label mode adds the sub-label line', () => {
    const view = makeView({ nodes: [node('plain'), undefinedNode, node('described', { sub: 'A longer description' })] });
    const layout = layoutSwimlane(view, events, drawOptions());
    expect(findNode(layout, 'plain').height).toBe(28);
    expect(findNode(layout, 'undef').height).toBe(nodeBoxHeight(undefinedNode, drawOptions()));
    expect(findNode(layout, 'undef').height).toBe(5 * 14 + 14);
    expect(findNode(layout, 'described').height).toBe(28);
    expect(findNode(layoutSwimlane(view, events, drawOptions('label')), 'described').height).toBe(42);
  });

  it('keeps the plain 28 px box when no options are passed', () => {
    expect(findNode(layoutSwimlane(makeView({ nodes: [undefinedNode] }), events), 'undef').height).toBe(nodeBoxHeight(undefinedNode, {}));
  });

  it('draws every text line inside its rect', () => {
    const view = makeView({ nodes: [node('plain'), undefinedNode, node('described', { sub: 'A longer description', extra: ['x'] })] });
    [drawOptions(), drawOptions('label')].forEach((options) => {
      expect(nodesWithOverflowingText(layoutToSvg(layoutSwimlane(view, events, options), view, options))).toEqual([]);
    });
  });

  it('stacks nodes of different heights with the usual gap and without overlap', () => {
    const view = makeView({ nodes: [undefinedNode, node('plain'), node('described', { extra: ['x', 'y'] })] });
    const layout = layoutSwimlane(view, events, drawOptions());
    const stacked = layout.nodes.slice().sort((first, second) => first.y - second.y);
    stacked.slice(1).forEach((placed, index) => expect(placed.y).toBe(stacked[index].y + stacked[index].height + 18));
    const lane = layout.regions.find((region) => region.kind === 'lane')!;
    stacked.forEach((placed) => expect(placed.y + placed.height).toBeLessThanOrEqual(lane.y + lane.height));
  });

  it('wraps by row count with mixed heights: no overlaps, each sub-column as tall as its nodes, the lane tall enough for the tallest', () => {
    const total = MAX_COLUMN_ROWS * 2 + 5;
    const nodes = Array.from({ length: total }, (_, index) => node(`n${index}`, { form: 'f1', field: `n${index}`, ...(index % 3 === 0 ? { extra: ['one', 'two'] } : {}) }));
    const view = makeView({ level: 'field', nodes });
    const layout = layoutSwimlane(view, events, drawOptions());
    layout.nodes.forEach((first, index) => layout.nodes.slice(index + 1).forEach((second) => expect(overlaps(first, second)).toBe(false)));
    const xs = [...new Set(layout.nodes.map((placed) => placed.x))];
    expect(xs).toHaveLength(3);
    const lane = layout.regions.find((region) => region.kind === 'lane')!;
    xs.forEach((x) => {
      const column = layout.nodes.filter((placed) => placed.x === x).sort((first, second) => first.y - second.y);
      expect(column.length).toBeLessThanOrEqual(MAX_COLUMN_ROWS);
      column.slice(1).forEach((placed, index) => expect(placed.y).toBe(column[index].y + column[index].height + 18));
      const last = column[column.length - 1];
      expect(last.y + last.height).toBeLessThanOrEqual(lane.y + lane.height);
    });
    const tallest = Math.max(...xs.map((x) => { const column = layout.nodes.filter((placed) => placed.x === x); return Math.max(...column.map((placed) => placed.y + placed.height)); }));
    expect(lane.y + lane.height).toBeGreaterThanOrEqual(tallest);
  });

  it('encloses tall nodes in their form box', () => {
    const view = makeView({
      level: 'field', nodes: [undefinedNode, node('plain', { form: 'f1', field: 'plain' })],
      groups: [{ id: 'f1', label: 'Form 1', nodes: ['undef', 'plain'] }],
    });
    const layout = layoutSwimlane(view, events, drawOptions());
    const box = layout.regions.find((region) => region.kind === 'cluster')!;
    layout.nodes.forEach((placed) => {
      expect(placed.y).toBeGreaterThanOrEqual(box.y);
      expect(placed.y + placed.height).toBeLessThanOrEqual(box.y + box.height);
    });
  });

  it('keeps routes clear of mixed-height nodes on a seeded random layout', () => {
    const wallEvents = [eventDef('e1', { dayOffset: 0, forms: ['f1'] }), eventDef('e2', { dayOffset: 1, forms: ['f2'] }), eventDef('e3', { dayOffset: 2, forms: ['f3'] })];
    const fieldNodes = (prefix: string, form: string) => Array.from({ length: 25 }, (_, index) =>
      node(`${prefix}${index}`, { form, field: `${prefix}${index}`, ...(index % 4 === 0 ? { extra: ['one', 'two'] } : {}) }));
    let state = 99;
    const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    let routed = 0;
    let routedHits = 0;
    for (let trial = 0; trial < 4; trial++) {
      const edges: ViewEdge[] = [];
      for (let count = 0; count < 120; count++) {
        const from = `${'abc'[Math.floor(random() * 3)]}${Math.floor(random() * 25)}`;
        const to = `${'abc'[Math.floor(random() * 3)]}${Math.floor(random() * 25)}`;
        if (from !== to) edges.push(link(from, to));
      }
      const view = makeView({ level: 'field', nodes: [...fieldNodes('a', 'f1'), ...fieldNodes('b', 'f2'), ...fieldNodes('c', 'f3')], edges });
      const layout = layoutSwimlane(view, wallEvents, drawOptions());
      layout.nodes.forEach((first, index) => layout.nodes.slice(index + 1).forEach((second) => expect(overlaps(first, second)).toBe(false)));
      layout.edges.forEach((edge) => { routed++; routedHits += routeHitCount(layout, edge) > 0 ? 1 : 0; });
    }
    expect(routed).toBeGreaterThan(300);
    expect(routedHits / routed).toBeLessThan(0.02);
  });
});

describe('layoutSwimlane orthogonal channel routing', () => {
  const seeded = (seed: number): (() => number) => {
    let state = seed;
    return function nextRandom(): number { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  };
  const randomEdges = (ids: string[], count: number, random: () => number, reciprocalShare = 0.2): ViewEdge[] => {
    const edges: ViewEdge[] = [];
    const seen = new Set<string>();
    while (edges.length < count) {
      const from = ids[Math.floor(random() * ids.length)];
      const to = ids[Math.floor(random() * ids.length)];
      if (from === to || seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`);
      edges.push(link(from, to));
      if (random() < reciprocalShare && !seen.has(`${to}>${from}`) && edges.length < count) {
        seen.add(`${to}>${from}`);
        edges.push(link(to, from));
      }
    }
    return edges;
  };

  it('keeps every route clean on seeded random instance views over two arms with shared days', () => {
    const events = [
      eventDef('a1', { dayOffset: 0 }), eventDef('b1', { dayOffset: 0, arm: '2', armName: 'Other' }),
      eventDef('a2', { dayOffset: 7 }), eventDef('b2', { dayOffset: 14, arm: '2', armName: 'Other' }), eventDef('a3', { dayOffset: 30 }),
    ];
    for (let trial = 0; trial < 5; trial++) {
      const random = seeded(31 + trial);
      const nodes = events.flatMap((event) => Array.from({ length: 3 + Math.floor(random() * 8) }, (_, index) => node(`${event.id}_${index}`, { event: event.id, form: `f${index}`, kind: 'form' })));
      nodes.push(node('loose', { event: null, form: 'none', kind: 'form' }));
      const view = makeView({ level: 'form', nodes, edges: randomEdges(nodes.map((placed) => placed.id), 60, random) });
      const layout = layoutSwimlane(view, events);
      expect(layout.edges).toHaveLength(60);
      expectCleanRoutes(layout);
    }
  });

  it('spreads many edges into one node over distinct ports and grows the node, keeping its text inside', () => {
    const events = [eventDef('e1', { forms: ['f1'] }), eventDef('e2', { forms: ['f2'] }), eventDef('e3', { forms: ['f3'] })];
    const sources = ['e1', 'e2', 'e3'].flatMap((eventId, eventIndex) => Array.from({ length: 8 }, (_, index) => node(`s${eventIndex}_${index}`, { form: `f${eventIndex + 1}`, field: `s${eventIndex}_${index}` })));
    const hub = node('hub', { form: 'f2', field: 'hub' });
    const view = makeView({ level: 'field', nodes: [...sources, hub], edges: [...sources.map((source) => link(source.id, 'hub')), link('hub', 's0_0'), link('hub', 's2_7')] });
    const layout = layoutSwimlane(view, events, drawOptions());
    expectCleanRoutes(layout);
    const placedHub = findNode(layout, 'hub');
    expect(placedHub.height).toBeGreaterThan(nodeBoxHeight(hub, drawOptions()));
    const ports = layout.edges.flatMap((edge) => [
      ...(edge.from === 'hub' ? [`${edge.points![0].x},${edge.points![0].y}`] : []),
      ...(edge.to === 'hub' ? [`${edge.points!.at(-1)!.x},${edge.points!.at(-1)!.y}`] : []),
    ]);
    expect(new Set(ports).size).toBe(ports.length);
    expect(nodesWithOverflowingText(layoutToSvg(layout, view, drawOptions()))).toEqual([]);
  });

  it('keeps every route clean on wrapped sub-columns with form boxes', () => {
    const events = [eventDef('e1', { dayOffset: 0, forms: ['f1', 'f2'] }), eventDef('e2', { dayOffset: 1, forms: ['f3'] })];
    const fields = Array.from({ length: 70 }, (_, index) => node(`n${index}`, { form: index < 40 ? 'f1' : index < 60 ? 'f2' : 'f3', field: `n${index}` }));
    const groups = ['f1', 'f2', 'f3'].map((formId) => ({ id: formId, label: `Form ${formId}`, nodes: fields.filter((field) => field.form === formId).map((field) => field.id) }));
    for (let trial = 0; trial < 3; trial++) {
      const view = makeView({ level: 'field', nodes: fields, groups, edges: randomEdges(fields.map((field) => field.id), 120, seeded(5 + trial)) });
      const layout = layoutSwimlane(view, events);
      expect(new Set(layout.nodes.filter((placed) => placed.id !== 'n69').map((placed) => placed.x)).size).toBeGreaterThan(2);
      expectCleanRoutes(layout);
      // the form boxes still enclose their fields
      const boxes = layout.regions.filter((region) => region.kind === 'cluster');
      layout.nodes.forEach((placed) => expect(boxes.some((box) => placed.x >= box.x && placed.x + placed.width <= box.x + box.width
        && placed.y >= box.y && placed.y + placed.height <= box.y + box.height)).toBe(true));
    }
  });

  it('keeps every route clean at event level, where every pair of events may link both ways', () => {
    const events = ['e1', 'e2', 'e3', 'e4'].map((id, index) => eventDef(id, { dayOffset: index * 10, arm: index === 3 ? '2' : '1' }));
    const ids = events.map((event) => event.id);
    const edges = ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => link(from, to)));
    const layout = layoutSwimlane(makeView({ level: 'event', nodes: ids.map((id) => node(id)), edges }), events);
    expect(layout.edges).toHaveLength(12);
    expectCleanRoutes(layout);
  });

  it('keeps every route clean on seeded random field views with mixed node heights and label mode', () => {
    const events = [eventDef('e1', { dayOffset: 0, forms: ['f1'] }), eventDef('e2', { dayOffset: 1, forms: ['f2'] }), eventDef('e3', { dayOffset: 2, forms: ['f3'] })];
    for (let trial = 0; trial < 4; trial++) {
      const random = seeded(77 + trial);
      const nodes = ['f1', 'f2', 'f3'].flatMap((formId) => Array.from({ length: 10 + Math.floor(random() * 30) }, (_, index) =>
        node(`${formId}_${index}`, { form: formId, field: `${formId}_${index}`, sub: 'A description', ...(index % 4 === 0 ? { extra: ['one', 'two'] } : {}) })));
      const view = makeView({ level: 'field', nodes, edges: randomEdges(nodes.map((placed) => placed.id), 150, random) });
      expectCleanRoutes(layoutSwimlane(view, events, drawOptions(trial % 2 ? 'label' : 'var')));
    }
  });

  it('leaves the geometry of a view without edges as it was', () => {
    const events = [eventDef('e1', { forms: ['f1', 'f2'] }), eventDef('e2', { forms: ['f3'] })];
    const view = makeView({ level: 'field', nodes: ['a', 'b', 'c'].map((id, index) => node(id, { form: `f${index + 1}`, field: id })) });
    const layout = layoutSwimlane(view, events);
    expect(findNode(layout, 'a').y).toBe(layout.regions[0].y + 26);
    expect(findNode(layout, 'b').y).toBe(findNode(layout, 'a').y + 28 + 18);
    expect(centerOf(layout, 'c') - centerOf(layout, 'a')).toBe(160);
  });
});

describe('layoutSwimlane shift into the drawing bounds', () => {
  const curve = (...points: Point[]): LayoutEdge => ({ from: 'a', to: 'b', curve: points as LayoutEdge['curve'], backward: false });

  it('computes no shift while every route keeps the arrow margin from the origin, and the missing distance otherwise', () => {
    expect(originShift(10, 10)).toEqual({ x: 0, y: 0 });
    expect(originShift(150, 40)).toEqual({ x: 0, y: 0 });
    expect(originShift(-30, 25)).toEqual({ x: 40, y: 0 });
    expect(originShift(5, -12)).toEqual({ x: 5, y: 22 });
    expect(originShift(-3, -4)).toEqual({ x: 13, y: 14 });
  });

  it('moves nodes, routes and regions by the same amount, keeping relative geometry, and lanes stay at x = 0', () => {
    const contents = {
      nodes: [{ id: 'a', x: 20, y: 30, width: 120, height: 28 }, { id: 'b', x: 20, y: 100, width: 120, height: 42 }],
      edges: [
        curve({ x: 20, y: 44 }, { x: -50, y: 44 }, { x: -50, y: 121 }, { x: 20, y: 121 }),
        { from: 'a', to: 'b', points: [{ x: 20, y: 44 }, { x: -20, y: 44 }, { x: -20, y: 121 }, { x: 20, y: 121 }], backward: false },
      ],
      regions: [
        { id: 'lane', kind: 'lane' as const, label: 'L', x: 0, y: 10, width: 300, height: 200 },
        { id: 'column', kind: 'column' as const, label: 'C', x: 10, y: 10, width: 160, height: 200 },
      ],
    };
    const before = structuredClone(contents);
    shiftLayoutContents(contents, { x: 60, y: 7 });
    contents.nodes.forEach((placed, index) => {
      expect(placed).toEqual({ ...before.nodes[index], x: before.nodes[index].x + 60, y: before.nodes[index].y + 7 });
    });
    expect(contents.edges[0].curve).toEqual(before.edges[0].curve!.map((point) => ({ x: point.x + 60, y: point.y + 7 })));
    expect(contents.edges[1].points).toEqual(before.edges[1].points!.map((point) => ({ x: point.x + 60, y: point.y + 7 })));
    expect(contents.regions[0]).toEqual({ ...before.regions[0], y: 17 });
    expect(contents.regions[1]).toEqual({ ...before.regions[1], x: 70, y: 17 });
    // a route that left the origin by 50 now starts inside it, and the gap between node and route is unchanged
    const leftmost = Math.min(...contents.edges[0].curve!.map((point) => point.x));
    expect(leftmost).toBe(10);
    expect(contents.nodes[0].x - leftmost).toBe(before.nodes[0].x - Math.min(...before.edges[0].curve!.map((point) => point.x)));
    expect(contents.nodes[1].y - contents.nodes[0].y).toBe(before.nodes[1].y - before.nodes[0].y);
  });

  it('shifts a whole layout so a route that starts left of x = 0 ends up inside, with its shape unchanged', () => {
    // the real layout never bows far enough left of the first column to need the shift, so apply the computed shift to a laid-out view
    const view = makeView({
      level: 'field', nodes: ['a', 'b', 'c', 'd'].map((id) => node(id, { form: 'f1', field: id })),
      edges: [link('d', 'a'), link('a', 'd'), link('c', 'a'), link('b', 'd')],
    });
    const layout = layoutSwimlane(view, [eventDef('e1', { forms: ['f1'] })]);
    const before = structuredClone(layout);
    const leftmost = Math.min(...layout.edges.flatMap((edge) => routeSamples(edge).map((point) => point.x)));
    const shift = originShift(leftmost - 500, 30); // as if the routes reached 500 px further left
    expect(shift.x).toBe(10 - (leftmost - 500));
    shiftLayoutContents(layout, shift);
    layout.nodes.forEach((placed) => expect(placed.x).toBeGreaterThan(0));
    layout.nodes.forEach((placed, index) => {
      expect(placed.x - before.nodes[index].x).toBe(shift.x);
      expect(placed.y - before.nodes[index].y).toBe(shift.y);
    });
    layout.edges.forEach((edge, index) => {
      const original = before.edges[index];
      const moved = (edge.curve ?? edge.points)!;
      const first = (original.curve ?? original.points)!;
      moved.forEach((point, pointIndex) => {
        expect(point.x - first[pointIndex].x).toBe(shift.x);
        expect(point.y - first[pointIndex].y).toBe(shift.y);
      });
    });
    layout.regions.forEach((region, index) => {
      expect(region.x - before.regions[index].x).toBe(region.kind === 'lane' ? 0 : shift.x);
      expect(region.y - before.regions[index].y).toBe(shift.y);
    });
  });
});
