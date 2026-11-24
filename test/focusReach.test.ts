import { describe, expect, it } from 'vitest';
import { focusReach } from '../src/lib/graph';
import type { Edge } from '../src/lib/types';

const edge = (from: string, to: string): Edge => ({ from, to, type: 'branching', expr: '' }) as Edge;
// a -> b -> c -> d, and x -> b
const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('x', 'b')];

describe('focusReach', () => {
  it('walks downstream within the depth', () => {
    expect([...focusReach(edges, 'b', 'down', 1)].sort()).toEqual(['b', 'c']);
    expect([...focusReach(edges, 'b', 'down', 2)].sort()).toEqual(['b', 'c', 'd']);
  });
  it('walks upstream within the depth', () => {
    expect([...focusReach(edges, 'c', 'up', 1)].sort()).toEqual(['b', 'c']);
    expect([...focusReach(edges, 'c', 'up', 2)].sort()).toEqual(['a', 'b', 'c', 'x']);
  });
  it('walks both directions', () => {
    expect([...focusReach(edges, 'b', 'both', 1)].sort()).toEqual(['a', 'b', 'c', 'x']);
  });
});
