import { describe, expect, it } from 'vitest';
import {
  autoCellSize,
  buildMatrix,
  LABEL_HEIGHT,
  LABEL_WIDTH,
  MAX_CANVAS_PIXELS,
  maxCellSize,
  resolveMatrixPoint,
  type MatrixGeometry,
  type MatrixSource,
} from '../src/lib/matrix';
import type { Form, ViewEdge } from '../src/lib/types';
import { makeView, node } from './fixtures';

const form = (id: string, label = id.toUpperCase()): Form => ({ id, label, repeating: false, fields: [] });
const source = (...forms: Form[]): MatrixSource => ({
  parsed: { forms },
  formsById: new Map(forms.map((f) => [f.id, f] as const)),
});
const edge = (from: string, to: string, over: Partial<ViewEdge> = {}): ViewEdge =>
  ({ from, to, types: ['branching'], count: 1, byType: {}, ...over });
const ids = (nodes: { id: string }[]) => nodes.map((n) => n.id);
const manyNodes = (count: number) => Array.from({ length: count }, (_, k) => node('n' + k));

describe('buildMatrix ordering', () => {
  const forms = source(form('f1'), form('f2'));

  it('orders nodes by form position, keeping view order within a form', () => {
    const view = makeView({ nodes: [node('b', { form: 'f2' }), node('a', { form: 'f1' }), node('c', { form: 'f1' })] });
    const data = buildMatrix(view, forms, { groupBy: 'form' });
    expect(ids(data.nodes)).toEqual(['a', 'c', 'b']);
    expect(data.nodeCount).toBe(3);
  });

  it('puts nodes whose form is unknown after the known forms', () => {
    const view = makeView({ nodes: [node('x', { form: 'nope' }), node('b', { form: 'f2' })] });
    expect(ids(buildMatrix(view, forms, { groupBy: 'form' }).nodes)).toEqual(['b', 'x']);
  });

  it('ignores groups when grouping by form and there are no instances', () => {
    const groups = [{ id: 'E1', label: 'Visit 1', nodes: ['b'] }];
    const view = makeView({ nodes: [node('a', { form: 'f1' }), node('b', { form: 'f2' })], groups });
    const data = buildMatrix(view, forms, { groupBy: 'form' });
    expect(ids(data.nodes)).toEqual(['a', 'b']);
    expect(data.nodes[1].gLabel).toBeUndefined();
  });
});

describe('buildMatrix regrouping', () => {
  const forms = source(form('f1'));
  const groups = [
    { id: 'E1', label: 'Visit 1', nodes: ['c', 'a'] },
    { id: 'E2', label: 'Visit 2', nodes: ['b'] },
  ];
  const nodes = [node('a'), node('b'), node('c'), node('loose')];

  it('bands field nodes by event when grouped by event', () => {
    const data = buildMatrix(makeView({ nodes, groups }), forms, { groupBy: 'event' });
    expect(ids(data.nodes)).toEqual(['a', 'c', 'b', 'loose']);
    expect(data.nodes[0]).toMatchObject({ form: 'E1', gLabel: 'Visit 1', groupIndex: 0, originalIndex: 0 });
    expect(data.nodes[2]).toMatchObject({ form: 'E2', gLabel: 'Visit 2', groupIndex: 1 });
  });

  it('bands by arm the same way', () => {
    const data = buildMatrix(makeView({ nodes, groups }), forms, { groupBy: 'arm' });
    expect(ids(data.nodes)).toEqual(['a', 'c', 'b', 'loose']);
  });

  it('places nodes outside every group after the grouped ones', () => {
    const data = buildMatrix(makeView({ nodes, groups }), forms, { groupBy: 'event' });
    expect(data.nodes[3]).toMatchObject({ id: 'loose', form: 'f1', groupIndex: 999 });
    expect(data.nodes[3].gLabel).toBeUndefined();
  });

  it('regroups by instances even when grouping by form', () => {
    const data = buildMatrix(makeView({ nodes, groups, instances: true }), forms, { groupBy: 'form' });
    expect(ids(data.nodes)).toEqual(['a', 'c', 'b', 'loose']);
    expect(data.nodes[1].gLabel).toBe('Visit 1');
  });

  it('does not regroup field-level by event when the view is not at field level', () => {
    const data = buildMatrix(makeView({ level: 'form', nodes, groups }), forms, { groupBy: 'event' });
    expect(ids(data.nodes)).toEqual(['a', 'b', 'c', 'loose']);
  });
});

describe('buildMatrix cells', () => {
  const forms = source(form('f1'));

  it('indexes a cell as row = dependent (to), column = dependency (from)', () => {
    const dependency = edge('a', 'b');
    const data = buildMatrix(makeView({ nodes: [node('a'), node('b'), node('c')], edges: [dependency] }), forms, { groupBy: 'form' });
    expect(data.cells.get(1 * 3 + 0)).toBe(dependency);
    expect(data.cells.has(0 * 3 + 1)).toBe(false);
  });

  it('drops edges whose ends are not in the view', () => {
    const data = buildMatrix(makeView({ nodes: [node('a')], edges: [edge('a', 'gone')] }), forms, { groupBy: 'form' });
    expect(data.cells.size).toBe(0);
  });

  it('uses the sorted position, not the view position, for cell keys', () => {
    const view = makeView({
      nodes: [node('b', { form: 'f1' }), node('a', { form: 'f0' })],
      edges: [edge('a', 'b')],
    });
    const data = buildMatrix(view, source(form('f0'), form('f1')), { groupBy: 'form' });
    expect(ids(data.nodes)).toEqual(['a', 'b']);
    expect(data.cells.get(1 * 2 + 0)).toBeDefined();
  });
});

describe('buildMatrix cell size', () => {
  const forms = source(form('f1'));

  it('uses the automatic size when no override is set', () => {
    const data = buildMatrix(makeView({ nodes: manyNodes(100) }), forms, { groupBy: 'form' });
    expect(data.auto).toBe(14);
    expect(data.cell).toBe(14);
  });

  it('uses the override when it fits the canvas', () => {
    const data = buildMatrix(makeView({ nodes: manyNodes(10) }), forms, { groupBy: 'form', cellOverride: 7 });
    expect(data.cell).toBe(7);
  });

  it('clamps the cell size so the canvas stays within MAX_CANVAS_PIXELS', () => {
    const data = buildMatrix(makeView({ nodes: manyNodes(1000) }), forms, { groupBy: 'form', cellOverride: 20 });
    expect(data.cell).toBe(Math.floor(MAX_CANVAS_PIXELS / 1000));
    expect(data.cell * 1000).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });

  it('never goes below one pixel', () => {
    const data = buildMatrix(makeView({ nodes: manyNodes(20000) }), forms, { groupBy: 'form', cellOverride: 5 });
    expect(data.cell).toBe(1);
  });

  it('treats a zero override as automatic', () => {
    const data = buildMatrix(makeView({ nodes: manyNodes(10) }), forms, { groupBy: 'form', cellOverride: 0 });
    expect(data.cell).toBe(18);
  });

  it('handles an empty view', () => {
    const data = buildMatrix(makeView({ nodes: [] }), forms, { groupBy: 'form' });
    expect(data.nodeCount).toBe(0);
    expect(data.cells.size).toBe(0);
  });
});

describe('autoCellSize', () => {
  it.each([
    [1, 18],
    [60, 18],
    [61, 14],
    [150, 14],
    [151, 10],
    [300, 10],
    [301, 7],
    [600, 7],
    [601, 4],
    [1200, 4],
    [1201, 3],
    [2400, 3],
    [2401, 2],
  ])('%i nodes gives %i px', (count, size) => {
    expect(autoCellSize(count)).toBe(size);
  });
});

describe('maxCellSize', () => {
  it('is the canvas budget divided by the node count', () => {
    expect(maxCellSize(1000)).toBe(14);
    expect(maxCellSize(0)).toBe(MAX_CANVAS_PIXELS);
  });
});

describe('resolveMatrixPoint', () => {
  const geometry: MatrixGeometry = { labelWidth: LABEL_WIDTH, labelHeight: LABEL_HEIGHT, cellSize: 10, nodeCount: 3 };
  const at = (row: number, col: number) => ({ x: LABEL_WIDTH + col * 10 + 5, y: LABEL_HEIGHT + row * 10 + 5 });

  it('returns the cell under the point', () => {
    const { x, y } = at(2, 1);
    expect(resolveMatrixPoint(x, y, geometry)).toEqual({ kind: 'cell', row: 2, col: 1 });
  });

  it('returns the cell at its top-left corner', () => {
    expect(resolveMatrixPoint(LABEL_WIDTH, LABEL_HEIGHT, geometry)).toEqual({ kind: 'cell', row: 0, col: 0 });
  });

  it('returns a row header for a point in the left gutter beside a row', () => {
    const { y } = at(1, 0);
    expect(resolveMatrixPoint(LABEL_WIDTH - 4, y, geometry)).toEqual({ kind: 'rowHeader', row: 1 });
  });

  it('returns a column header for a point in the top gutter above a column', () => {
    const { x } = at(0, 2);
    expect(resolveMatrixPoint(x, LABEL_HEIGHT - 4, geometry)).toEqual({ kind: 'columnHeader', col: 2 });
  });

  it('returns null for the corner where both gutters meet', () => {
    expect(resolveMatrixPoint(10, 10, geometry)).toBeNull();
  });

  it('returns null past the last row and column', () => {
    expect(resolveMatrixPoint(LABEL_WIDTH + 30, LABEL_HEIGHT + 5, geometry)).toBeNull();
    expect(resolveMatrixPoint(LABEL_WIDTH + 5, LABEL_HEIGHT + 30, geometry)).toBeNull();
  });

  it('returns null for a row header outside the rows', () => {
    expect(resolveMatrixPoint(LABEL_WIDTH - 4, LABEL_HEIGHT + 40, geometry)).toBeNull();
  });
});
