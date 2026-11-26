import { describe, expect, it } from 'vitest';
import { layoutSwimlane } from '../src/lib/layoutSwimlane';
import { countBends, countEdgeCrossings, countEdgesThroughNodes, countOverlappingSegments } from '../src/lib/layoutMetrics';
import { TRACK_SPACING } from '../src/lib/swimlaneRouting';
import type { EventDef, View, ViewEdge } from '../src/lib/types';
import { node } from './fixtures';

/** Small deterministic generator, so the synthetic project is the same on every run. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  return function nextRandom(): number {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

/** A field-level view of a big longitudinal project: 21 events (two arms), about 6,000 fields in forms, about 5,000 edges. */
export const syntheticBigView = (): { view: View; events: EventDef[] } => {
  const random = seededRandom(7);
  const eventCount = 21;
  const formsPerEvent = 14;
  const events: EventDef[] = Array.from({ length: eventCount }, (_, index) => ({
    id: `event_${index}`, label: `Event ${index}`, arm: index < 11 ? '1' : '2', armName: index < 11 ? 'Main' : 'Other',
    repeating: false, dayOffset: index * 14, forms: Array.from({ length: formsPerEvent }, (__, formIndex) => `form_${index}_${formIndex}`),
  }));
  const nodes = events.flatMap((event) => event.forms.flatMap((formId, formIndex) =>
    Array.from({ length: 12 + (formIndex % 5) * 4 }, (_, fieldIndex) => node(`${formId}_${fieldIndex}`, { form: formId, field: `${formId}_${fieldIndex}` }))));
  const edges: ViewEdge[] = [];
  const seen = new Set<string>();
  while (edges.length < 5000) {
    const from = nodes[Math.floor(random() * nodes.length)].id;
    // mostly local (nearby in the list, so the same or a neighbouring event), sometimes anywhere
    const span = random() < 0.8 ? 400 : nodes.length;
    const index = Math.min(nodes.length - 1, Math.max(0, nodes.findIndex((candidate) => candidate.id === from) + Math.floor((random() - 0.5) * span)));
    const to = nodes[index].id;
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, types: ['branching'], count: 1, byType: { branching: 1 } });
  }
  return { view: { level: 'field', nodes, edges, groups: [] }, events };
};

describe('layoutSwimlane on a big project', () => {
  it('lays out about 6,000 nodes and 5,000 edges quickly and in a bounded height', () => {
    const { view, events } = syntheticBigView();
    expect(view.nodes.length).toBeGreaterThan(5500);
    const start = performance.now();
    const layout = layoutSwimlane(view, events);
    const milliseconds = performance.now() - start;
    console.log(`swimlane synthetic: ${view.nodes.length} nodes, ${view.edges.length} edges, ${layout.width}x${layout.height}, ${Math.round(milliseconds)} ms`);
    expect(layout.nodes).toHaveLength(view.nodes.length);
    expect(layout.edges).toHaveLength(view.edges.length);
    expect(milliseconds).toBeLessThan(4000);
    // tall columns wrap, so the height stays bounded however many nodes an event holds
    expect(layout.height).toBeLessThan(6000);
    // routes stay clean and no more tangled than measured (before tuning: 4.70 bends per edge, 392,000 crossings; since:
    // 4.46 and 411,000)
    expect(countOverlappingSegments(layout, TRACK_SPACING - 1)).toBe(0);
    expect(countEdgesThroughNodes(layout)).toBe(0);
    expect(countBends(layout).mean).toBeLessThanOrEqual(4.7);
    expect(countEdgeCrossings(layout)).toBeLessThanOrEqual(430000);
  }, 60000);
});
