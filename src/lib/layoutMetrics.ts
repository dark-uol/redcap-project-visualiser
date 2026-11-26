/* Quality measures of a laid-out graph: edges running on top of each other, edges through nodes, overlapping nodes.
 * Used by the tests and by measurements of the layout engines. Pure: no Solid, no DOM. */
import type { Layout, LayoutEdge, LayoutNode, Point } from './layout';

/** Two collinear segments count as overlapping when they share more than this many pixels. */
export const OVERLAP_TOLERANCE = 1;
/** Segments whose fixed coordinates differ by less than this are on the same line. */
const SAME_LINE_TOLERANCE = 0.5;
const CURVE_SAMPLES = 32;

interface AxisSegment { edgeIndex: number; line: number; start: number; end: number }

/** The horizontal and vertical segments of every polyline route; curves and slanted segments have none. */
const axisSegments = (edges: LayoutEdge[]): { horizontal: AxisSegment[]; vertical: AxisSegment[] } => {
  const horizontal: AxisSegment[] = [];
  const vertical: AxisSegment[] = [];
  edges.forEach((edge, edgeIndex) => {
    const points = edge.points ?? [];
    for (let index = 1; index < points.length; index++) {
      const first = points[index - 1];
      const second = points[index];
      if (Math.abs(first.y - second.y) < SAME_LINE_TOLERANCE && first.x !== second.x) {
        horizontal.push({ edgeIndex, line: (first.y + second.y) / 2, start: Math.min(first.x, second.x), end: Math.max(first.x, second.x) });
      } else if (Math.abs(first.x - second.x) < SAME_LINE_TOLERANCE && first.y !== second.y) {
        vertical.push({ edgeIndex, line: (first.x + second.x) / 2, start: Math.min(first.y, second.y), end: Math.max(first.y, second.y) });
      }
    }
  });
  return { horizontal, vertical };
};

/** Adds to `pairs` every pair of different edges with parallel segments less than `lineTolerance` apart that share more
 * than OVERLAP_TOLERANCE of their length. */
const collectOverlaps = (segments: AxisSegment[], pairs: Set<string>, lineTolerance: number): void => {
  const sorted = segments.slice().sort((first, second) => first.line - second.line);
  sorted.forEach((segment, index) => {
    for (let other = index + 1; other < sorted.length && sorted[other].line - segment.line < lineTolerance; other++) {
      const candidate = sorted[other];
      if (candidate.edgeIndex === segment.edgeIndex) continue;
      if (Math.min(candidate.end, segment.end) - Math.max(candidate.start, segment.start) <= OVERLAP_TOLERANCE) continue;
      const low = Math.min(candidate.edgeIndex, segment.edgeIndex);
      const high = Math.max(candidate.edgeIndex, segment.edgeIndex);
      pairs.add(`${low},${high}`);
    }
  });
};

/** Pairs of different edges with a horizontal or vertical stretch drawn on top of each other: parallel segments less than
 * `lineTolerance` apart (default: half a pixel, i.e. on the same line) sharing more than 1 px. Crossings do not count;
 * curves are ignored. A larger tolerance also counts lines so close that they read as one. */
export const countOverlappingSegments = (layout: Pick<Layout, 'edges'>, lineTolerance: number = SAME_LINE_TOLERANCE): number => {
  const { horizontal, vertical } = axisSegments(layout.edges);
  const pairs = new Set<string>();
  collectOverlaps(horizontal, pairs, lineTolerance);
  collectOverlaps(vertical, pairs, lineTolerance);
  return pairs.size;
};

const cubicPoint = (curve: [Point, Point, Point, Point], t: number): Point => {
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: curve.reduce((sum, point, index) => sum + point.x * weights[index], 0),
    y: curve.reduce((sum, point, index) => sum + point.y * weights[index], 0),
  };
};

/** Whether the segment from `first` to `second` enters the inside of the box (its border, shrunk by half a pixel, excluded). */
const segmentEntersBox = (first: Point, second: Point, box: LayoutNode): boolean => {
  const left = box.x + SAME_LINE_TOLERANCE;
  const right = box.x + box.width - SAME_LINE_TOLERANCE;
  const top = box.y + SAME_LINE_TOLERANCE;
  const bottom = box.y + box.height - SAME_LINE_TOLERANCE;
  // Liang-Barsky clipping of the segment against the box
  let enter = 0;
  let leave = 1;
  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  const clips: [number, number][] = [[-deltaX, first.x - left], [deltaX, right - first.x], [-deltaY, first.y - top], [deltaY, bottom - first.y]];
  for (const [direction, distance] of clips) {
    if (direction === 0) {
      if (distance <= 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) enter = Math.max(enter, ratio); else leave = Math.min(leave, ratio);
    if (enter > leave) return false;
  }
  return leave > enter;
};

/** The points of an edge's route: the polyline, or samples of its curve. */
const routePoints = (edge: LayoutEdge): Point[] => {
  if (edge.points) return edge.points;
  if (edge.curve) return Array.from({ length: CURVE_SAMPLES + 1 }, (_, step) => cubicPoint(edge.curve!, step / CURVE_SAMPLES));
  return [];
};

/** Edges whose route passes through a node other than its own two ends. */
export const countEdgesThroughNodes = (layout: Pick<Layout, 'edges' | 'nodes'>): number => {
  // a coarse grid of the nodes, so each segment looks only at the nodes near it
  const cellSize = 200;
  const grid = new Map<string, LayoutNode[]>();
  layout.nodes.forEach((placed) => {
    for (let column = Math.floor(placed.x / cellSize); column <= Math.floor((placed.x + placed.width) / cellSize); column++) {
      for (let row = Math.floor(placed.y / cellSize); row <= Math.floor((placed.y + placed.height) / cellSize); row++) {
        const key = `${column},${row}`;
        const cell = grid.get(key);
        if (cell) cell.push(placed); else grid.set(key, [placed]);
      }
    }
  });
  let count = 0;
  layout.edges.forEach((edge) => {
    const points = routePoints(edge);
    const hit = points.some((point, index) => {
      if (index === 0) return false;
      const previous = points[index - 1];
      const firstColumn = Math.floor(Math.min(previous.x, point.x) / cellSize);
      const lastColumn = Math.floor(Math.max(previous.x, point.x) / cellSize);
      const firstRow = Math.floor(Math.min(previous.y, point.y) / cellSize);
      const lastRow = Math.floor(Math.max(previous.y, point.y) / cellSize);
      for (let column = firstColumn; column <= lastColumn; column++) {
        for (let row = firstRow; row <= lastRow; row++) {
          const cell = grid.get(`${column},${row}`);
          if (cell?.some((placed) => placed.id !== edge.from && placed.id !== edge.to && segmentEntersBox(previous, point, placed))) return true;
        }
      }
      return false;
    });
    if (hit) count++;
  });
  return count;
};

/** Pairs of nodes whose boxes overlap. */
export const countNodeOverlaps = (layout: Pick<Layout, 'nodes'>): number => {
  const sorted = layout.nodes.slice().sort((first, second) => first.x - second.x);
  let count = 0;
  sorted.forEach((placed, index) => {
    for (let other = index + 1; other < sorted.length && sorted[other].x < placed.x + placed.width; other++) {
      const candidate = sorted[other];
      if (candidate.y < placed.y + placed.height && placed.y < candidate.y + candidate.height) count++;
    }
  });
  return count;
};

/** Every consecutive pair of route points shares an x or a y. */
export const isAxisAligned = (points: Point[]): boolean =>
  points.every((point, index) => index === 0
    || Math.abs(point.x - points[index - 1].x) < SAME_LINE_TOLERANCE || Math.abs(point.y - points[index - 1].y) < SAME_LINE_TOLERANCE);
