import { describe, expect, it } from 'vitest';
import { layoutSwimlane } from '../src/lib/layoutSwimlane';
import type { EventDef, ViewEdge } from '../src/lib/types';
import { makeView, node } from './fixtures';

const eventDef = (id: string, over: Partial<EventDef> = {}): EventDef =>
  ({ id, label: id.toUpperCase(), arm: '1', armName: 'Main', repeating: false, forms: ['f1'], ...over });

const link = (from: string, to: string): ViewEdge => ({ from, to, types: ['branching'], count: 1, byType: { branching: 1 } });

const findNode = (layout: ReturnType<typeof layoutSwimlane>, id: string) => layout.nodes.find((placed) => placed.id === id)!;
const centerOf = (layout: ReturnType<typeof layoutSwimlane>, id: string): number => {
  const placed = findNode(layout, id);
  return placed.x + placed.width / 2;
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
    expect(findNode(layout, 'y').y).toBe(lane.y + 40);
    expect(findNode(layout, 'x').y).toBe(findNode(layout, 'y').y + 28 + 18);
    expect(layout.height).toBeGreaterThanOrEqual(lane.y + lane.height + 20);
    expect(layout.width).toBeGreaterThanOrEqual(findNode(layout, 'x').x + 120 + 20);
  });

  it('flags backward edges and routes them below, right-to-left', () => {
    const events = [eventDef('e1'), eventDef('e2')];
    const view = makeView({
      nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' })],
      edges: [link('a', 'b'), link('b', 'a')],
    });
    const layout = layoutSwimlane(view, events);
    const forward = layout.edges.find((edge) => edge.from === 'a')!;
    const backward = layout.edges.find((edge) => edge.from === 'b')!;
    expect(forward.backward).toBe(false);
    expect(forward.curve[0]).toEqual({ x: findNode(layout, 'a').x + 120, y: findNode(layout, 'a').y + 14 });
    expect(forward.curve[3]).toEqual({ x: findNode(layout, 'b').x, y: findNode(layout, 'b').y + 14 });
    expect(backward.backward).toBe(true);
    expect(backward.curve[0].x).toBe(findNode(layout, 'b').x);
    expect(backward.curve[3].x).toBe(findNode(layout, 'a').x + 120);
    expect(backward.curve[1].y).toBeGreaterThan(backward.curve[0].y);
    expect(backward.curve[2].y).toBeGreaterThan(backward.curve[3].y);
  });

  it('connects nodes in the same column bottom-to-top', () => {
    const events = [eventDef('e1', { forms: ['f1', 'f2'] })];
    const view = makeView({
      nodes: [node('a', { event: 'e1', form: 'f1' }), node('b', { event: 'e1', form: 'f2' })],
      edges: [link('a', 'b')],
    });
    const layout = layoutSwimlane(view, events);
    const [edge] = layout.edges;
    expect(edge.backward).toBe(false);
    expect(edge.curve[0]).toEqual({ x: 60 + findNode(layout, 'a').x, y: findNode(layout, 'a').y + 28 });
    expect(edge.curve[3]).toEqual({ x: 60 + findNode(layout, 'b').x, y: findNode(layout, 'b').y });
    expect(edge.curve[1].x).toBe(edge.curve[0].x);
  });

  it('puts nodes with a missing or unknown event into one "(no event)" lane with a single column', () => {
    const events = [eventDef('e1')];
    const view = makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: null }), node('c'), node('d', { event: 'ghost' })] });
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
});
