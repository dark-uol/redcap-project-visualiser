import { describe, expect, it } from 'vitest';
import { edgeAppearance, toDot, toMermaid } from '../src/lib/exporters';
import { TYPES } from '../src/lib/graph';
import type { DepType, ViewEdge, ViewOptions } from '../src/lib/types';
import { makeView, node } from './fixtures';

const options = { level: 'field', dir: 'LR', labelMode: 'var', edgeLabels: false, lineWidths: false, types: new Set() } as unknown as ViewOptions;
const allTypes = Object.keys(TYPES) as DepType[];
const edgeOf = (type: DepType, extra: Partial<ViewEdge> = {}): ViewEdge => ({ from: 'a', to: 'b', types: [type], count: 1, byType: { [type]: 1 }, fieldLevel: true, ...extra });
const viewOf = (edges: ViewEdge[], instances = false) => ({ ...makeView({ level: 'field', nodes: [node('a'), node('b')], edges }), instances });

describe('edge style: colour carries the type', () => {
  it('draws every dependency type solid in its own colour', () => {
    const view = viewOf(allTypes.map((type) => edgeOf(type)));
    view.edges.forEach((edge, index) => {
      const look = edgeAppearance(view, edge, options);
      expect(look.dash).toBe('solid');
      expect(look.color).toBe(TYPES[allTypes[index]].color);
    });
  });

  it('keeps dashed for mismatch, dotted for relative and red for cross-arm, in instance views only', () => {
    const view = viewOf([edgeOf('calc', { mismatch: true }), edgeOf('piping', { relative: true }), edgeOf('branching', { crossArm: true })], true);
    const [mismatch, relative, crossArm] = view.edges.map((edge) => edgeAppearance(view, edge, options));
    expect(mismatch.dash).toBe('dashed');
    expect(relative.dash).toBe('dotted');
    expect(crossArm).toMatchObject({ dash: 'solid', color: '#dc2626' });
    const plain = viewOf([edgeOf('calc', { mismatch: true })]);
    expect(edgeAppearance(plain, plain.edges[0], options).dash).toBe('solid');
  });

  it('emits solid DOT edges and plain Mermaid arrows for every type', () => {
    const view = viewOf(allTypes.map((type) => edgeOf(type)));
    const dotEdges = toDot(view, options).split('\n').filter((line) => line.includes(' -> '));
    expect(dotEdges).toHaveLength(allTypes.length);
    dotEdges.forEach((line) => expect(line).toContain('style=solid'));
    const mermaid = toMermaid(view, options);
    expect(mermaid).not.toMatch(/==>|-\.->|linkStyle .*stroke-dasharray/);
    expect(mermaid.match(/ --> /g)).toHaveLength(allTypes.length);
  });
});
