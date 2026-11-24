/* Pure model and geometry for the dependency matrix. No Solid imports: the canvas drawing lives in components/MatrixTab.tsx. */
import type { DepType, Form, GroupBy, ParsedODM, View, ViewEdge, ViewGroup, ViewNode } from './types';

/** Largest node count drawn as a matrix; above this the tab shows a message instead. */
export const MAX_NODES = 6000;
/** The canvas is capped at this many pixels along its longer side (per node, cell size is clamped). */
export const MAX_CANVAS_PIXELS = 14000;
/** Left gutter for row labels and top gutter for column labels. */
export const LABEL_WIDTH = 230;
export const LABEL_HEIGHT = 130;
/** Space kept clear on the right and bottom edges of the canvas. */
export const CANVAS_PADDING = 12;
/** Sort rank for nodes with no group or form. Sorts after every real rank. */
export const UNRANKED = 999;

const PRIMARY_TYPE_PRIORITY: DepType[] = ['branching', 'calc', 'formlogic', 'actiontag', 'piping', 'logicsrc'];

/** A view node placed in the matrix, with its band (form or event / arm group). */
export interface MxNode extends ViewNode {
  /** Position in the view's own node list, used as the final sort tie-break. */
  originalIndex: number;
  /** Index of the group the node belongs to, or UNRANKED when it has none. */
  groupIndex: number;
  gLabel?: string;
}

export interface MxData {
  nodes: MxNode[];
  /** Number of rows and of columns (the matrix is square). */
  nodeCount: number;
  /** Key is row * nodeCount + column; row = dependent node (edge.to), column = dependency (edge.from). */
  cells: Map<number, ViewEdge>;
  /** Cell size in pixels after the user override and the canvas clamp. */
  cell: number;
  /** Cell size chosen automatically from the node count. */
  auto: number;
  formsById: Map<string, Form>;
}

/** The parts of the parsed model the matrix reads. */
export interface MatrixSource {
  parsed: Pick<ParsedODM, 'forms'>;
  formsById: Map<string, Form>;
}

export interface MatrixOptions {
  groupBy: GroupBy;
  /** User-chosen cell size; 0 or undefined means automatic. */
  cellOverride?: number;
}

export interface MatrixGeometry {
  labelWidth: number;
  labelHeight: number;
  cellSize: number;
  nodeCount: number;
}

export type MatrixPoint =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'rowHeader'; row: number }
  | { kind: 'columnHeader'; col: number };

/** A contiguous run of nodes sharing one form or group, as [start, start + length). */
export interface MatrixBand {
  start: number;
  length: number;
  form: string;
}

/** Cell size for a node count: bigger cells while the matrix is small. */
const AUTO_CELL_TIERS: ReadonlyArray<{ maxNodes: number; cellSize: number }> = [
  { maxNodes: 60, cellSize: 18 },
  { maxNodes: 150, cellSize: 14 },
  { maxNodes: 300, cellSize: 10 },
  { maxNodes: 600, cellSize: 7 },
  { maxNodes: 1200, cellSize: 4 },
  { maxNodes: 2400, cellSize: 3 },
];
const SMALLEST_AUTO_CELL = 2;

export function autoCellSize(nodeCount: number): number {
  const tier = AUTO_CELL_TIERS.find((candidate) => nodeCount <= candidate.maxNodes);
  return tier ? tier.cellSize : SMALLEST_AUTO_CELL;
}

/** Largest cell size that keeps the canvas within MAX_CANVAS_PIXELS. */
export function maxCellSize(nodeCount: number): number {
  return Math.floor(MAX_CANVAS_PIXELS / Math.max(nodeCount, 1));
}

/** The priority-ordered dependency type used to colour a cell. */
export function primaryType(edge: ViewEdge): DepType {
  return PRIMARY_TYPE_PRIORITY.find((type) => edge.types.includes(type)) ?? edge.types[0];
}

/**
 * Places the view's nodes in matrix order and indexes its edges into cells.
 * Nodes are ordered by group when the matrix is regrouped (event / arm, or instances),
 * otherwise by form position in the project; ties keep the view's own order.
 */
export function buildMatrix(view: View, source: MatrixSource, options: MatrixOptions): MxData {
  const formIndexById = new Map(source.parsed.forms.map((form, index) => [form.id, index] as const));
  // "Group fields by" event / arm re-bands the matrix by that group instead of by form
  const useGroups = (view.level === 'field' && (options.groupBy === 'event' || options.groupBy === 'arm')) || !!view.instances;
  const groups: ViewGroup[] = useGroups ? (view.groups || []) : [];
  const groupOfNode = new Map<string, { groupIndex: number; group: ViewGroup }>();
  groups.forEach((group, groupIndex) => (group.nodes || []).forEach((id) => groupOfNode.set(id, { groupIndex, group })));

  const nodes: MxNode[] = view.nodes
    .map((node, originalIndex): MxNode => {
      const membership = groupOfNode.get(node.id);
      return membership
        ? { ...node, originalIndex, form: membership.group.id, gLabel: membership.group.label, groupIndex: membership.groupIndex }
        : { ...node, originalIndex, groupIndex: UNRANKED };
    })
    .sort((a, b) => {
      const bandOrder = groups.length
        ? a.groupIndex - b.groupIndex
        : (formIndexById.get(a.form) ?? UNRANKED) - (formIndexById.get(b.form) ?? UNRANKED);
      return bandOrder || a.originalIndex - b.originalIndex;
    });

  const positionById = new Map(nodes.map((node, position) => [node.id, position] as const));
  const nodeCount = nodes.length;
  const cells = new Map<number, ViewEdge>();
  view.edges.forEach((edge) => {
    const row = positionById.get(edge.to), column = positionById.get(edge.from);
    if (row != null && column != null) cells.set(row * nodeCount + column, edge);
  });
  const auto = autoCellSize(nodeCount);
  const cell = Math.max(1, Math.min(options.cellOverride || auto, maxCellSize(nodeCount)));
  return { nodes, nodeCount, cells, cell, auto, formsById: source.formsById };
}

/** Geometry of the drawn matrix, taken from the built data. */
export function matrixGeometry(data: MxData): MatrixGeometry {
  return { labelWidth: LABEL_WIDTH, labelHeight: LABEL_HEIGHT, cellSize: data.cell, nodeCount: data.nodeCount };
}

/** Canvas size in CSS pixels. */
export function canvasExtent(geometry: MatrixGeometry): { width: number; height: number } {
  const gridSide = geometry.nodeCount * geometry.cellSize;
  return {
    width: geometry.labelWidth + gridSide + CANVAS_PADDING,
    height: geometry.labelHeight + gridSide + CANVAS_PADDING,
  };
}

/** Splits matrix nodes into runs of equal form, in order. */
export function bandsOf(nodes: MxNode[]): MatrixBand[] {
  const bands: MatrixBand[] = [];
  nodes.forEach((node, index) => {
    const last = bands[bands.length - 1];
    if (last && last.form === node.form) last.length += 1;
    else bands.push({ start: index, length: 1, form: node.form });
  });
  return bands;
}

/** Maps a point in canvas coordinates to a cell or header, or null when outside the grid and headers. */
export function resolveMatrixPoint(x: number, y: number, geometry: MatrixGeometry): MatrixPoint | null {
  const { labelWidth, labelHeight, cellSize, nodeCount } = geometry;
  const row = Math.floor((y - labelHeight) / cellSize);
  const col = Math.floor((x - labelWidth) / cellSize);
  const rowInRange = row >= 0 && row < nodeCount;
  const colInRange = col >= 0 && col < nodeCount;
  if (rowInRange && colInRange) return { kind: 'cell', row, col };
  if (rowInRange && x < labelWidth) return { kind: 'rowHeader', row };
  if (colInRange && y < labelHeight) return { kind: 'columnHeader', col };
  return null;
}
