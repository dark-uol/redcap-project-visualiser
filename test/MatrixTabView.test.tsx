import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixTabView } from '../src/components/MatrixTabView';
import type { MatrixTabViewProps } from '../src/components/MatrixTabView';
import { buildMatrix, MAX_NODES, matrixGeometry, resolveMatrixPoint } from '../src/lib/matrix';
import type { MatrixSource, MxData } from '../src/lib/matrix';
import type { Form, ViewEdge } from '../src/lib/types';
import { makeView, node } from './fixtures';
import { renderComponent } from './renderComponent';

const form = (id: string, label = id.toUpperCase()): Form => ({ id, label, repeating: false, fields: [] });
const source = (...forms: Form[]): MatrixSource => ({
  parsed: { forms },
  formsById: new Map(forms.map((f) => [f.id, f] as const)),
});
const edge = (from: string, to: string): ViewEdge => ({ from, to, types: ['branching'], count: 1, byType: {} });

/** a, b, c in one form; b depends on a and c depends on b. */
const sampleMatrix = (): MxData =>
  buildMatrix(
    makeView({ nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c')] }),
    source(form('f1')),
    { groupBy: 'form' },
  );

const emptyMatrix = (): MxData => buildMatrix(makeView({ nodes: [] }), source(form('f1')), { groupBy: 'form' });

const renderView = (over: Partial<MatrixTabViewProps> = {}) => {
  const props: MatrixTabViewProps = {
    data: sampleMatrix(),
    levelNoun: 'fields',
    onCellSizeChange: vi.fn(),
    onSelect: vi.fn(),
    children: <span class="detail-slot">detail</span>,
    ...over,
  };
  return { props, container: renderComponent(() => <MatrixTabView {...props} />) };
};

describe('MatrixTabView', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let context: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    context = {};
    for (const method of ['scale', 'fillRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'strokeRect', 'save', 'restore', 'translate', 'rotate']) {
      context[method] = vi.fn();
    }
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as typeof originalGetContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('renders a canvas, the note text and draws into it', () => {
    const { container } = renderView();
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.textContent).toContain('Each row depends on the columns');
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
  });

  it('shows the nothing-to-show message for an empty matrix', () => {
    const { container } = renderView({ data: emptyMatrix() });
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).toContain('Nothing to show with the current filters.');
  });

  it('shows the too-many message when the node count exceeds MAX_NODES', () => {
    const { container } = renderView({ data: { ...sampleMatrix(), nodeCount: MAX_NODES + 1 } });
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).toContain(`${MAX_NODES + 1} nodes is too many for the matrix`);
  });

  it('shows the level noun in the count line', () => {
    expect(renderView({ levelNoun: 'fields' }).container.textContent).toContain('3 fields');
    expect(renderView({ levelNoun: 'nodes' }).container.textContent).toContain('3 nodes');
  });

  it('calls onCellSizeChange with the slider value', () => {
    const { props, container } = renderView();
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    slider.value = '7';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(props.onCellSizeChange).toHaveBeenCalledWith(7);
  });

  it('calls onCellSizeChange with 0 when auto is clicked', () => {
    const { props, container } = renderView();
    const auto = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'auto') as HTMLButtonElement;
    auto.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(props.onCellSizeChange).toHaveBeenCalledWith(0);
  });

  it('renders children inside .mxwrap after .mxscroll', () => {
    const { container } = renderView();
    const wrap = container.querySelector('.mxwrap') as HTMLElement;
    expect(wrap.querySelector('.detail-slot')?.textContent).toBe('detail');
    expect(wrap.querySelector('.mxscroll')?.nextElementSibling?.classList.contains('detail-slot')).toBe(true);
  });

  it('calls onSelect with the dependency node when a cell is clicked', () => {
    const { props, container } = renderView();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    // Row 1 (b) and column 0 (a) hold the edge a -> b, so the click selects b.
    const geometry = matrixGeometry(sampleMatrix());
    const point = { x: geometry.labelWidth + geometry.cellSize / 2, y: geometry.labelHeight + geometry.cellSize + geometry.cellSize / 2 };
    expect(resolveMatrixPoint(point.x, point.y, geometry)).toEqual({ kind: 'cell', row: 1, col: 0 });
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: point.x, clientY: point.y }));
    expect(props.onSelect).toHaveBeenCalledWith('b');
  });
});
