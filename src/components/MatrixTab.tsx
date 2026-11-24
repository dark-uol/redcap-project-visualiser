/* Dependency structure matrix: rows depend on the columns where they have a coloured cell. */
import { Show, createMemo, createSignal, createEffect } from 'solid-js';
import { TYPES } from '../lib/graph';
import {
  bandsOf,
  buildMatrix,
  canvasExtent,
  matrixGeometry,
  maxCellSize,
  MAX_NODES,
  primaryType,
  resolveMatrixPoint,
} from '../lib/matrix';
import type { MatrixBand, MatrixGeometry, MxData, MxNode } from '../lib/matrix';
import type { Form, ViewEdge } from '../lib/types';
import { need, model, view, presentation, mxCell, setMxCell, selection } from '../store';

const { setSelected } = selection;

const { groupBy } = presentation;
import Detail from './Detail';

/** Cell size from which row and column labels are drawn. */
const LABEL_MIN_CELL = 9;
const MAX_LABEL_CHARS = 26;
/** Above this many backing-store pixels the canvas drops to 1x device pixel ratio. */
const MAX_BACKING_STORE_PIXELS = 1.2e8;

interface Tip {
  x: number;
  y: number;
  rowLabel: string;
  columnLabel: string;
  edge: ViewEdge | undefined;
}

interface HoveredCell {
  row: number;
  col: number;
}

const truncateLabel = (text: string): string =>
  text.length > MAX_LABEL_CHARS ? text.slice(0, MAX_LABEL_CHARS - 1) + '…' : text;

const describeNode = (node: MxNode): string =>
  node.field ? node.field + ' @ ' + (node.event || node.form) : node.id;

/** Text for a band header: the group label, or the form label, or a placeholder for unknown forms. */
const bandLabel = (node: MxNode, formsById: Map<string, Form>): string => {
  if (node.gLabel) return node.gLabel;
  if (node.kind === 'missing') return '(unknown)';
  const form = formsById.get(node.form);
  return form ? form.label : node.form;
};

/** Sizes the canvas for the geometry and returns a context with a white background, or null. */
function prepareCanvas(canvas: HTMLCanvasElement, geometry: MatrixGeometry): CanvasRenderingContext2D | null {
  const { width, height } = canvasExtent(geometry);
  let pixelRatio = window.devicePixelRatio || 1;
  if (width * height * pixelRatio * pixelRatio > MAX_BACKING_STORE_PIXELS) pixelRatio = 1;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  return context;
}

/** Alternating shaded bands for each form (or group), with a header label and divider lines. */
function drawBands(context: CanvasRenderingContext2D, data: MxData, geometry: MatrixGeometry): void {
  const { labelWidth, labelHeight, cellSize, nodeCount } = geometry;
  bandsOf(data.nodes).forEach((band: MatrixBand, bandIndex) => {
    // Odd-numbered bands are shaded; the parity is the band's position, so no rescan is needed
    if (band.form && bandIndex % 2 === 1) {
      context.fillStyle = '#f3f4f6';
      context.fillRect(labelWidth, labelHeight + band.start * cellSize, nodeCount * cellSize, band.length * cellSize);
      context.fillRect(labelWidth + band.start * cellSize, labelHeight, band.length * cellSize, nodeCount * cellSize);
    }
    context.fillStyle = '#374151';
    context.font = 'bold 10px system-ui,sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const label = truncateLabel(bandLabel(data.nodes[band.start], data.formsById));
    context.fillText(label, 4, labelHeight + (band.start + Math.min(band.length, 2) / 2) * cellSize);
    context.strokeStyle = '#9ca3af';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, labelHeight + band.start * cellSize + 0.5);
    context.lineTo(labelWidth + nodeCount * cellSize, labelHeight + band.start * cellSize + 0.5);
    context.moveTo(labelWidth + band.start * cellSize + 0.5, 0);
    context.lineTo(labelWidth + band.start * cellSize + 0.5, labelHeight + nodeCount * cellSize);
    context.stroke();
  });
}

/** Tinted row and column under the pointer. */
function drawHoverCrosshair(context: CanvasRenderingContext2D, geometry: MatrixGeometry, hovered: HoveredCell): void {
  const { labelWidth, labelHeight, cellSize, nodeCount } = geometry;
  context.fillStyle = 'rgba(37,99,235,.10)';
  context.fillRect(labelWidth, labelHeight + hovered.row * cellSize, nodeCount * cellSize, cellSize);
  context.fillRect(labelWidth + hovered.col * cellSize, labelHeight, cellSize, nodeCount * cellSize);
}

/** Grey cells on the diagonal, where a field meets itself. */
function drawDiagonal(context: CanvasRenderingContext2D, geometry: MatrixGeometry): void {
  const { labelWidth, labelHeight, cellSize, nodeCount } = geometry;
  for (let index = 0; index < nodeCount; index++) {
    context.fillStyle = '#e5e7eb';
    context.fillRect(labelWidth + index * cellSize, labelHeight + index * cellSize, cellSize, cellSize);
  }
}

/** Coloured dependency cells; a cell whose mirror image also exists gets a red outline. */
function drawCells(context: CanvasRenderingContext2D, data: MxData, geometry: MatrixGeometry): void {
  const { labelWidth, labelHeight, cellSize, nodeCount } = geometry;
  data.cells.forEach((edge, key) => {
    const row = Math.floor(key / nodeCount), column = key % nodeCount;
    context.fillStyle = TYPES[primaryType(edge)].color;
    context.fillRect(labelWidth + column * cellSize + 1, labelHeight + row * cellSize + 1, cellSize - 1, cellSize - 1);
    if (data.cells.has(column * nodeCount + row)) {
      context.strokeStyle = '#dc2626';
      context.lineWidth = 1.5;
      context.strokeRect(labelWidth + column * cellSize + 1.5, labelHeight + row * cellSize + 1.5, cellSize - 2, cellSize - 2);
    }
  });
}

/** Row labels to the left and rotated column labels above the grid. */
function drawLabels(context: CanvasRenderingContext2D, data: MxData, geometry: MatrixGeometry): void {
  const { labelWidth, labelHeight, cellSize } = geometry;
  const fontSize = Math.min(11, cellSize - 2);
  context.fillStyle = '#111';
  context.font = fontSize + 'px ui-monospace,Menlo,monospace';
  context.textBaseline = 'middle';
  data.nodes.forEach((node, index) => {
    const label = truncateLabel(node.label);
    context.textAlign = 'right';
    context.fillText(label, labelWidth - 4, labelHeight + index * cellSize + cellSize / 2);
    context.save();
    context.translate(labelWidth + index * cellSize + cellSize / 2, labelHeight - 4);
    context.rotate(-Math.PI / 2);
    context.textAlign = 'left';
    context.fillText(label, 0, 0);
    context.restore();
  });
}

export default function MatrixTab() {
  let canvas!: HTMLCanvasElement;
  let hoveredCell: HoveredCell | null = null;
  const [tip, setTip] = createSignal<Tip | null>(null);
  const data = createMemo<MxData>(() =>
    buildMatrix(need(view()), need(model()), { groupBy: groupBy(), cellOverride: mxCell() }),
  );

  const draw = (matrix: MxData = data()): void => {
    if (!canvas || !matrix.nodeCount || matrix.nodeCount > MAX_NODES) return;
    const geometry = matrixGeometry(matrix);
    const context = prepareCanvas(canvas, geometry);
    if (!context) return;
    drawBands(context, matrix, geometry);
    if (hoveredCell) drawHoverCrosshair(context, geometry, hoveredCell);
    drawDiagonal(context, geometry);
    drawCells(context, matrix, geometry);
    if (geometry.cellSize >= LABEL_MIN_CELL) drawLabels(context, matrix, geometry);
  };
  const redrawMatrix = (matrix: MxData): void => draw(matrix);
  createEffect(data, redrawMatrix);

  const canvasPointer = (event: MouseEvent): { x: number; y: number } => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const hitAt = (event: MouseEvent, matrix: MxData) => {
    const point = canvasPointer(event);
    return resolveMatrixPoint(point.x, point.y, matrixGeometry(matrix));
  };
  const onMove = (event: MouseEvent): void => {
    const matrix = data();
    const hit = hitAt(event, matrix);
    const nextHover: HoveredCell | null = hit?.kind === 'cell' ? { row: hit.row, col: hit.col } : null;
    const hoverChanged =
      nextHover !== null && (!hoveredCell || hoveredCell.row !== nextHover.row || hoveredCell.col !== nextHover.col);
    if (hoverChanged || (!nextHover && hoveredCell)) {
      hoveredCell = nextHover;
      draw();
    }
    if (nextHover) {
      setTip({
        x: event.clientX + 14,
        y: event.clientY + 14,
        rowLabel: describeNode(matrix.nodes[nextHover.row]),
        columnLabel: describeNode(matrix.nodes[nextHover.col]),
        edge: matrix.cells.get(nextHover.row * matrix.nodeCount + nextHover.col),
      });
    } else {
      setTip(null);
    }
  };
  const onClick = (event: MouseEvent): void => {
    const matrix = data();
    const hit = hitAt(event, matrix);
    if (!hit) return;
    if (hit.kind === 'cell') {
      const edge = matrix.cells.get(hit.row * matrix.nodeCount + hit.col);
      setSelected(edge ? edge.to : matrix.nodes[hit.row].id);
    } else if (hit.kind === 'rowHeader') {
      setSelected(matrix.nodes[hit.row].id);
    } else {
      setSelected(matrix.nodes[hit.col].id);
    }
  };
  const handleCanvasLeave = (): void => {
    hoveredCell = null;
    setTip(null);
    draw();
  };

  return (
    <div>
      <div class="mxnote small"><label>Cell size <input type="range" min="1" max={Math.min(20, Math.max(1, maxCellSize(data().nodeCount)))} value={data().cell} onInput={(e) => setMxCell(+e.currentTarget.value)} style="vertical-align:middle;width:160px" /></label>
        <span class="muted">{data().cell}px · {data().nodeCount} {view() && view()?.level === 'field' ? 'fields' : 'nodes'}</span> <button class="link" onClick={() => setMxCell(0)}>auto</button>
        <span class="muted"> — labels appear at 9px or more; at small sizes hover for names.</span></div>
      <p class="muted small mxnote">Each <b>row</b> depends on the <b>columns</b> where it has a coloured cell (reads: row ← column). Colour = dependency type; a <span style="color:#dc2626;font-weight:600">red outline</span> means the pair depend on each other (circular). Fields are grouped by form (alternating bands), or by event / arm when chosen under Group fields by. Uses the same filters as the graph.</p>
      <Show when={data().nodeCount > MAX_NODES} fallback={
        <div class="mxwrap">
          <div class="mxscroll">
            <Show when={data().nodeCount} fallback={<p style="padding:16px;color:#555">Nothing to show with the current filters.</p>}>
              <canvas ref={(el) => (canvas = el)} onMouseMove={onMove} onMouseLeave={handleCanvasLeave} onClick={onClick}></canvas>
            </Show>
          </div>
          <Detail />
        </div>
      }>
        <p style="padding:16px">{data().nodeCount} nodes is too many for the matrix. Narrow the view with the Forms list or Focus.</p>
      </Show>
      <Show when={tip()}>
        {(t) => (
          <div class="mxtip" style={`left:${t().x}px;top:${t().y}px`}><b>{t().rowLabel}</b> ← <b>{t().columnLabel}</b>{t().edge ? <div>{t().edge?.types.join(' + ')}</div> : ''}</div>
        )}
      </Show>
    </div>
  );
}
