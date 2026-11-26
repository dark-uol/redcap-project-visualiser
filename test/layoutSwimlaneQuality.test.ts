import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel, buildView } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import { layoutSwimlane } from '../src/lib/layoutSwimlane';
import {
  countBends, countEdgeCrossings, countEdgesThroughNodes, countNodeOverlaps, countOverlappingSegments, isAxisAligned,
} from '../src/lib/layoutMetrics';
import { TRACK_SPACING } from '../src/lib/swimlaneRouting';
import type { DepType, EventDef, View, ViewEdge, ViewOptions } from '../src/lib/types';
import { node } from './fixtures';

/* Regression guards for how tangled the Swimlane routes are. The ceilings are the values measured before the bend penalty, the
 * routing order and the track order within gutters were tuned, plus a small tolerance (the field level measured 2.56 bends
 * per edge and 289 crossings since). */

const ALL_TYPES: DepType[] = ['branching', 'calc', 'piping', 'embedding', 'actiontag', 'formlogic', 'logicsrc'];
const options = (over: Partial<ViewOptions>): ViewOptions => ({
  level: 'field', eventSet: null, types: new Set(ALL_TYPES), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both', focusDepth: 1,
  showMissing: false, hideIsolated: true, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'label', group: false, groupBy: 'none', edgeLabels: false, lineWidths: true, ...over,
});

const expectClean = (layout: ReturnType<typeof layoutSwimlane>): void => {
  expect(layout.edges.every((edge) => edge.points && isAxisAligned(edge.points))).toBe(true);
  expect(countOverlappingSegments(layout, TRACK_SPACING - 1)).toBe(0);
  expect(countEdgesThroughNodes(layout)).toBe(0);
  expect(countNodeOverlaps(layout)).toBe(0);
};

const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  return function nextRandom(): number {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

describe('swimlane route quality on the sample project', () => {
  const model = buildModel(parseODM(sampleXml));
  // [name, view options, bends per edge before tuning -> ceiling, crossings before tuning -> ceiling]
  const configurations: [string, Partial<ViewOptions>, number, number][] = [
    ['field', { level: 'field' }, 2.62, 310],
    ['form', { level: 'form' }, 1.72, 5],
    ['form with instances', { level: 'form', instances: true }, 2.5, 25],
    ['event', { level: 'event' }, 2.67, 9],
  ];
  configurations.forEach(([name, over, maximumBends, maximumCrossings]) => {
    it(`keeps bends and crossings at or below the measured ceiling at ${name} level`, () => {
      const layout = layoutSwimlane(buildView(model, options(over)), model.parsed.events);
      expectClean(layout);
      expect(countBends(layout).mean).toBeLessThanOrEqual(maximumBends);
      expect(countEdgeCrossings(layout)).toBeLessThanOrEqual(maximumCrossings);
    });
  });
});

describe('swimlane route quality on built views', () => {
  it('draws two nodes on one row in adjacent events with a single straight segment', () => {
    const events: EventDef[] = ['e1', 'e2'].map((id, index) => ({
      id, label: id, arm: '1', armName: 'Main', repeating: false, dayOffset: index * 14, forms: ['f1'],
    }));
    const view: View = {
      level: 'form', nodes: [node('a', { event: 'e1' }), node('b', { event: 'e2' })],
      edges: [{ from: 'a', to: 'b', types: ['branching'], count: 1, byType: { branching: 1 } }], groups: [],
    };
    const layout = layoutSwimlane(view, events);
    expectClean(layout);
    expect(countBends(layout).total).toBe(0);
    expect(countEdgeCrossings(layout)).toBe(0);
  });

  it('keeps seeded random multi-event projects clean and within the measured bends and crossings', () => {
    const random = seededRandom(11);
    const events: EventDef[] = Array.from({ length: 5 }, (_, index) => ({
      id: `e${index}`, label: `E${index}`, arm: index < 3 ? '1' : '2', armName: index < 3 ? 'Main' : 'Other', repeating: false,
      dayOffset: index * 10, forms: ['f1'],
    }));
    const nodes = events.flatMap((event) => Array.from({ length: 8 }, (_, index) => node(`${event.id}_${index}`, { event: event.id })));
    const edges: ViewEdge[] = [];
    const seen = new Set<string>();
    while (edges.length < 70) {
      const from = nodes[Math.floor(random() * nodes.length)].id;
      const to = nodes[Math.floor(random() * nodes.length)].id;
      if (from === to || seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`);
      edges.push({ from, to, types: ['branching'], count: 1, byType: { branching: 1 } });
    }
    const layout = layoutSwimlane({ level: 'form', nodes, edges, groups: [] }, events);
    expectClean(layout);
    const bends = countBends(layout);
    // measured: 2.97 bends per edge (at most 4), about 930 crossings
    expect(bends.mean).toBeLessThanOrEqual(3.05);
    expect(bends.max).toBeLessThanOrEqual(5);
    expect(countEdgeCrossings(layout)).toBeLessThanOrEqual(1000);
  });
});
