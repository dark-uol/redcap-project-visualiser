import { describe, expect, it } from 'vitest';
import { layoutSwimlane, wrapLabel } from '../src/lib/layoutSwimlane';
import { layoutToSvg } from '../src/lib/layoutToSvg';
import { resolveClick } from '../src/components/hitTest';
import type { EventDef, View, ViewEdge, ViewOptions } from '../src/lib/types';
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
    expect(findNode(layout, 'y').y).toBe(lane.y + 26);
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
    expect(forward.curve![0]).toEqual({ x: findNode(layout, 'a').x + 120, y: findNode(layout, 'a').y + 14 });
    expect(forward.curve![3]).toEqual({ x: findNode(layout, 'b').x, y: findNode(layout, 'b').y + 14 });
    expect(backward.backward).toBe(true);
    expect(backward.curve![0].x).toBe(findNode(layout, 'b').x);
    expect(backward.curve![3].x).toBe(findNode(layout, 'a').x + 120);
    expect(backward.curve![1].y).toBeGreaterThan(backward.curve![0].y);
    expect(backward.curve![2].y).toBeGreaterThan(backward.curve![3].y);
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
    expect(edge.curve![0]).toEqual({ x: 60 + findNode(layout, 'a').x, y: findNode(layout, 'a').y + 28 });
    expect(edge.curve![3]).toEqual({ x: 60 + findNode(layout, 'b').x, y: findNode(layout, 'b').y });
    expect(edge.curve![1].x).toBe(edge.curve![0].x);
  });

  it('puts nodes with a missing or unknown event into one "(no event)" lane with a single column', () => {
    const events = [eventDef('e1')];
    const view = makeView({ level: 'form', nodes: [node('a', { event: 'e1' }), node('b', { event: null }), node('c'), node('d', { event: 'ghost' })] });
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

  it('bows a same-column edge sideways so it does not cross the nodes between its ends', () => {
    const events = [eventDef('e1', { forms: ['f1', 'f2', 'f3'] })];
    const view = makeView({
      nodes: [node('a', { event: 'e1', form: 'f1' }), node('b', { event: 'e1', form: 'f2' }), node('c', { event: 'e1', form: 'f3' })],
      edges: [link('c', 'a')],
    });
    const layout = layoutSwimlane(view, events);
    const middle = findNode(layout, 'b');
    const curve = layout.edges[0].curve!;
    for (let step = 1; step < 40; step++) {
      const t = step / 40, u = 1 - t;
      const x = u * u * u * curve[0].x + 3 * u * u * t * curve[1].x + 3 * u * t * t * curve[2].x + t * t * t * curve[3].x;
      const y = u * u * u * curve[0].y + 3 * u * u * t * curve[1].y + 3 * u * t * t * curve[2].y + t * t * t * curve[3].y;
      const inside = x > middle.x && x < middle.x + middle.width && y > middle.y && y < middle.y + middle.height;
      expect(inside).toBe(false);
    }
  });

  it('routes an edge between lanes that share a column x around every node in the way', () => {
    const events = [eventDef('e1', { dayOffset: 0, forms: ['f1', 'f2'] }), eventDef('e2', { arm: '2', dayOffset: 0, forms: ['f1'] })];
    const view = makeView({
      nodes: [node('a', { event: 'e1', form: 'f1' }), node('b', { event: 'e1', form: 'f2' }), node('c', { event: 'e2', form: 'f1' }), node('u', { event: null })],
      edges: [link('u', 'a')],
    });
    const layout = layoutSwimlane(view, events);
    const curve = layout.edges[0].curve!;
    ['b', 'c'].forEach((id) => {
      const blocker = findNode(layout, id);
      for (let step = 1; step < 40; step++) {
        const t = step / 40, u = 1 - t;
        const x = u * u * u * curve[0].x + 3 * u * u * t * curve[1].x + 3 * u * t * t * curve[2].x + t * t * t * curve[3].x;
        const y = u * u * u * curve[0].y + 3 * u * u * t * curve[1].y + 3 * u * t * t * curve[2].y + t * t * t * curve[3].y;
        expect(x > blocker.x && x < blocker.x + blocker.width && y > blocker.y && y < blocker.y + blocker.height).toBe(false);
      }
    });
  });

  it('keeps the two edges of a reciprocal same-column pair apart', () => {
    const view = makeView({ nodes: [node('a', { event: 'e1' }), node('b', { event: 'e1' })], edges: [link('a', 'b'), link('b', 'a')] });
    const layout = layoutSwimlane(view, [eventDef('e1')]);
    const [forward, back] = layout.edges;
    expect(forward.curve![0].x).not.toBe(back.curve![3].x);
    expect(forward.curve![0].x).toBeLessThan(back.curve![3].x);
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
      dir: 'LR', labelMode: 'var', group: true, groupBy: 'form', edgeLabels: false,
    };
    const document = new DOMParser().parseFromString(layoutToSvg(layout, view, options), 'image/svg+xml');
    const cluster = document.querySelector('g.cluster')!;
    expect(resolveClick(cluster, view, (id) => id === 'f2')).toEqual({ type: 'select', id: '@form:f2' });
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
