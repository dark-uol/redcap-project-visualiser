// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { countEdgesThroughNodes, countNodeOverlaps, countOverlappingSegments, isAxisAligned } from '../src/lib/layoutMetrics';
import type { LayoutEdge, LayoutNode, Point } from '../src/lib/layout';

const polyline = (from: string, to: string, ...points: [number, number][]): LayoutEdge =>
  ({ from, to, points: points.map(([x, y]): Point => ({ x, y })), backward: false });

const box = (id: string, x: number, y: number, width = 100, height = 30): LayoutNode => ({ id, x, y, width, height });

describe('countOverlappingSegments', () => {
  it('counts two edges sharing a horizontal stretch once, however many segments overlap', () => {
    const edges = [
      polyline('a', 'b', [0, 10], [50, 10], [50, 40], [100, 40]),
      polyline('c', 'd', [20, 10], [80, 10], [80, 40], [120, 40]),
    ];
    expect(countOverlappingSegments({ edges })).toBe(1);
  });

  it('counts vertical overlaps and every pair on a shared line', () => {
    const edges = [
      polyline('a', 'b', [5, 0], [5, 100]),
      polyline('c', 'd', [5, 50], [5, 150]),
      polyline('e', 'f', [5, 90], [5, 300]),
    ];
    expect(countOverlappingSegments({ edges })).toBe(3);
  });

  it('ignores crossings, touching ends, overlaps of at most 1 px, parallel lines and segments of the same edge', () => {
    const edges = [
      polyline('a', 'b', [0, 10], [100, 10]),
      polyline('c', 'd', [50, 0], [50, 100]),
      polyline('e', 'f', [100, 10], [200, 10]),
      polyline('g', 'h', [199, 10], [300, 10]),
      polyline('i', 'j', [0, 14], [100, 14]),
      polyline('k', 'l', [0, 50], [100, 50], [100, 60], [20, 60], [20, 50], [60, 50]),
    ];
    expect(countOverlappingSegments({ edges })).toBe(0);
  });

  it('treats lines less than half a pixel apart as one line, and ignores curves', () => {
    const edges: LayoutEdge[] = [
      polyline('a', 'b', [0, 10], [100, 10]),
      polyline('c', 'd', [0, 10.3], [100, 10.3]),
      { from: 'e', to: 'f', curve: [{ x: 0, y: 10 }, { x: 30, y: 10 }, { x: 60, y: 10 }, { x: 100, y: 10 }], backward: false },
    ];
    expect(countOverlappingSegments({ edges })).toBe(1);
  });
});

describe('countEdgesThroughNodes', () => {
  const nodes = [box('a', 0, 0), box('b', 300, 0), box('blocker', 150, 0)];

  it('counts an edge that crosses a third node, but not one that runs along its border or ends at its own nodes', () => {
    const edges = [
      polyline('a', 'b', [100, 15], [300, 15]),
      polyline('a', 'b', [100, 15], [120, 15], [120, 30], [300, 30]),
      polyline('a', 'b', [100, 15], [120, 15], [120, 40], [280, 40], [280, 15], [300, 15]),
    ];
    expect(countEdgesThroughNodes({ nodes, edges })).toBe(1);
  });

  it('samples curves', () => {
    const edges: LayoutEdge[] = [{ from: 'a', to: 'b', curve: [{ x: 100, y: 15 }, { x: 150, y: 15 }, { x: 250, y: 15 }, { x: 300, y: 15 }], backward: false }];
    expect(countEdgesThroughNodes({ nodes, edges })).toBe(1);
  });
});

describe('countNodeOverlaps', () => {
  it('counts overlapping pairs only', () => {
    expect(countNodeOverlaps({ nodes: [box('a', 0, 0), box('b', 50, 5, 100, 20), box('c', 160, 0), box('d', 0, 30)] })).toBe(1);
  });
});

describe('isAxisAligned', () => {
  it('accepts right angles only', () => {
    expect(isAxisAligned([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }])).toBe(true);
    expect(isAxisAligned([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe(false);
  });
});
