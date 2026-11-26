/* Serialises a Layout as an SVG string shaped like Graphviz output (g.node / g.edge / g.cluster keyed by data-key), so the
 * graph stage can highlight and resolve clicks on it unchanged. Pure: no Solid, no DOM. */
import { KIND_FILL, KIND_STROKE, edgeAppearance, nodeLines } from './exporters';
import { TEXT_LINE_HEIGHT } from './nodeBox';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion, Point } from './layout';
import type { View, ViewEdge, ViewNode, ViewOptions } from './types';

const CHARACTER_WIDTH = 6.5;
const NODE_TEXT_PADDING = 12;
const LINE_HEIGHT = TEXT_LINE_HEIGHT;
const LABEL_FONT_SIZE = 12;
const EDGE_LABEL_FONT_SIZE = 9;
const BASE_WIDTH = 1.2;
const BOLD_WIDTH = 2.5;
const DASHED_PATTERN = '5 3';
const DOTTED_PATTERN = '1.5 3';
const BACKWARD_PATTERN = '8 3 2 3';
const MARKER_SIZE = 8;
const REPEAT_MARK = ' ↻';
const FONT = 'Helvetica, Arial, sans-serif';
const REGION_STYLE: Record<'lane' | 'column', { fill: string; stroke: string }> = {
  lane: { fill: '#f9fafb', stroke: '#d1d5db' },
  column: { fill: 'none', stroke: '#d1d5db' },
};
const CLUSTER_STROKE = '#9ca3af';
const CLUSTER_TEXT = '#374151';
const TEXT_FILL = '#111111';

const EDGE_LABEL_PADDING = 4;
const MAX_EDGE_LABEL_WIDTH = 260;
const MAX_EDGE_LABEL_CHARACTERS = Math.floor(MAX_EDGE_LABEL_WIDTH / CHARACTER_WIDTH);
const SAMPLES_PER_CURVE = 8;

/** The drawing's extent: starts as the layout box and grows (to whole pixels) to cover anything drawn outside it. */
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function includeBox(bounds: Bounds, left: number, top: number, right: number, bottom: number): void {
  if (left < bounds.minX) bounds.minX = Math.floor(left);
  if (top < bounds.minY) bounds.minY = Math.floor(top);
  if (right > bounds.maxX) bounds.maxX = Math.ceil(right);
  if (bottom > bounds.maxY) bounds.maxY = Math.ceil(bottom);
}

/** Cubic Bezier point at parameter t. */
function bezierPoint(curve: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: curve.reduce((sum, point, index) => sum + point.x * weights[index], 0),
    y: curve.reduce((sum, point, index) => sum + point.y * weights[index], 0),
  };
}

/** Escapes text for element content and attribute values. */
const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formatNumber = (value: number): string => String(Math.round(value * 100) / 100);
const formatPoint = (point: Point): string => `${formatNumber(point.x)} ${formatNumber(point.y)}`;

const fitText = (text: string, maxCharacters: number): string =>
  (text.length > maxCharacters ? text.slice(0, Math.max(1, maxCharacters - 1)) + '…' : text);

/** One <text> per line, starting at `firstY` and stepping by LINE_HEIGHT. */
function textLines(lines: string[], x: number, firstY: number, anchor: 'start' | 'middle', fontSize: number, fill: string): string {
  return lines
    .map((line, index) => `<text x="${formatNumber(x)}" y="${formatNumber(firstY + index * LINE_HEIGHT)}" text-anchor="${anchor}" font-size="${fontSize}" fill="${fill}">${escapeXml(line)}</text>`)
    .join('');
}

/** Region label lines: the wrapped label, a repeat mark on the last label line, then the sublabel. */
function regionLines(region: LayoutRegion): string[] {
  const lines = [...(region.labelLines ?? [region.label])];
  if (region.kind === 'column' && region.repeating && lines.length > 0) lines[lines.length - 1] += REPEAT_MARK;
  if (region.sublabel) lines.push(region.sublabel);
  return lines;
}

function regionMarkup(region: LayoutRegion): string {
  const kind = region.kind === 'column' ? 'column' : 'lane';
  const style = REGION_STYLE[kind];
  const dashed = kind === 'column' && region.repeating ? ' stroke-dasharray="6 4"' : '';
  const rect = `<rect x="${formatNumber(region.x)}" y="${formatNumber(region.y)}" width="${formatNumber(region.width)}" height="${formatNumber(region.height)}" fill="${style.fill}" stroke="${style.stroke}"${dashed}/>`;
  const label = kind === 'column'
    ? textLines(regionLines(region), region.x + region.width / 2, region.y + 16, 'middle', LABEL_FONT_SIZE, CLUSTER_TEXT)
    : textLines(regionLines(region), region.x + 8, region.y + 16, 'start', LABEL_FONT_SIZE, CLUSTER_TEXT);
  // a column that draws an expanded event is also that event's box: Graphviz-shaped, so it highlights and clicks like one
  const boxed = kind === 'column' && region.groupIndex !== undefined;
  const classes = boxed ? 'cluster region column' : `region ${kind}`;
  const key = boxed ? ` data-key="cluster_${region.groupIndex}"` : '';
  return `<g class="${classes}"${key} data-region-id="${escapeXml(region.id)}">${rect}${label}</g>`;
}

function clusterMarkup(region: LayoutRegion): string {
  const key = region.groupIndex === undefined ? '' : ` data-key="cluster_${region.groupIndex}"`;
  const rect = `<rect x="${formatNumber(region.x)}" y="${formatNumber(region.y)}" width="${formatNumber(region.width)}" height="${formatNumber(region.height)}" rx="6" fill="none" stroke="${CLUSTER_STROKE}"/>`;
  const label = textLines(region.labelLines ?? [region.label], region.x + 6, region.y + 13, 'start', LABEL_FONT_SIZE, CLUSTER_TEXT);
  return `<g class="cluster"${key}>${rect}${label}</g>`;
}

function nodeMarkup(placed: LayoutNode, viewNode: ViewNode, index: number, options: ViewOptions): string {
  const lines = nodeLines(viewNode, options);
  const maxCharacters = Math.floor((placed.width - NODE_TEXT_PADDING) / CHARACTER_WIDTH);
  const fitted = lines.map((line) => fitText(line, maxCharacters));
  const dashed = viewNode.kind === 'missing' ? ' stroke-dasharray="4 3"' : '';
  const strokeWidth = viewNode.focus ? 3 : 1;
  const rect = `<rect x="${formatNumber(placed.x)}" y="${formatNumber(placed.y)}" width="${formatNumber(placed.width)}" height="${formatNumber(placed.height)}" rx="4" fill="${KIND_FILL[viewNode.kind]}" stroke="${KIND_STROKE[viewNode.kind]}" stroke-width="${strokeWidth}"${dashed}/>`;
  const firstY = placed.y + placed.height / 2 - ((fitted.length - 1) * LINE_HEIGHT) / 2 + LABEL_FONT_SIZE / 3;
  const label = textLines(fitted, placed.x + placed.width / 2, firstY, 'middle', LABEL_FONT_SIZE, TEXT_FILL);
  return `<g class="node" data-key="n${index}"><title>${escapeXml(lines.join(' · '))}</title>${rect}${label}</g>`;
}

/** Cubic Bezier midpoint at t = 0.5. */
const bezierMidpoint = (curve: [Point, Point, Point, Point]): Point => ({
  x: (curve[0].x + 3 * curve[1].x + 3 * curve[2].x + curve[3].x) / 8,
  y: (curve[0].y + 3 * curve[1].y + 3 * curve[2].y + curve[3].y) / 8,
});

/** The point halfway along a polyline's length. */
function polylineMidpoint(points: Point[]): Point {
  const lengths: number[] = [];
  for (let index = 1; index < points.length; index++) {
    lengths.push(Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index++) {
    if (lengths[index] > 0 && remaining <= lengths[index]) {
      const fraction = remaining / lengths[index];
      const start = points[index];
      const end = points[index + 1];
      return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
    }
    remaining -= lengths[index];
  }
  return points[points.length - 1];
}

/** SVG path data and the label anchor for a laid-out route; null when the route has no geometry. */
function routeOf(layoutEdge: LayoutEdge): { d: string; middle: Point } | null {
  if (layoutEdge.curve) {
    const [start, controlA, controlB, end] = layoutEdge.curve;
    return { d: `M ${formatPoint(start)} C ${formatPoint(controlA)} ${formatPoint(controlB)} ${formatPoint(end)}`, middle: bezierMidpoint(layoutEdge.curve) };
  }
  if (layoutEdge.points && layoutEdge.points.length > 0) {
    const [first, ...rest] = layoutEdge.points;
    const d = `M ${formatPoint(first)}` + rest.map((point) => ` L ${formatPoint(point)}`).join('');
    return { d, middle: polylineMidpoint(layoutEdge.points) };
  }
  return null;
}

/** Edge markup and the colour it uses, or null when the edge is not drawn. */
function edgeMarkup(
  layoutEdge: LayoutEdge,
  viewEdge: ViewEdge,
  fromNode: ViewNode,
  toNode: ViewNode,
  fromIndex: number,
  toIndex: number,
  view: View,
  options: ViewOptions,
  arrowIdFor: (color: string) => string,
  bounds: Bounds,
): string | null {
  const route = routeOf(layoutEdge);
  if (!route) return null;
  const routePoints = layoutEdge.curve
    ? Array.from({ length: SAMPLES_PER_CURVE + 1 }, (_, step) => bezierPoint(layoutEdge.curve!, step / SAMPLES_PER_CURVE))
    : layoutEdge.points ?? [];
  routePoints.forEach((point) => includeBox(bounds, point.x, point.y, point.x, point.y));
  const look = edgeAppearance(view, viewEdge, options);
  const width = look.width ?? (look.dash === 'bold' ? BOLD_WIDTH : BASE_WIDTH);
  const pattern = look.dash === 'dashed' ? DASHED_PATTERN : look.dash === 'dotted' ? DOTTED_PATTERN : layoutEdge.backward ? BACKWARD_PATTERN : null;
  const dashed = pattern ? ` stroke-dasharray="${pattern}"` : '';
  const path = `<path d="${route.d}" fill="none" stroke="${look.color}" stroke-width="${formatNumber(width)}"${dashed} marker-end="url(#${arrowIdFor(look.color)})"/>`;
  let label = '';
  if (look.label) {
    const text = fitText(look.label, MAX_EDGE_LABEL_CHARACTERS);
    const halfWidth = (text.length * CHARACTER_WIDTH) / 2 + EDGE_LABEL_PADDING;
    const baseline = route.middle.y - 3;
    includeBox(bounds, route.middle.x - halfWidth, baseline - EDGE_LABEL_FONT_SIZE - EDGE_LABEL_PADDING, route.middle.x + halfWidth, baseline + EDGE_LABEL_PADDING);
    label = textLines([text], route.middle.x, baseline, 'middle', EDGE_LABEL_FONT_SIZE, look.color);
  }
  const title = `<title>${escapeXml(fromNode.label)} -> ${escapeXml(toNode.label)}</title>`;
  return `<g class="edge" data-key="n${fromIndex}->n${toIndex}">${title}${path}${label}</g>`;
}

/** Lay the layout out as an SVG string; nodes and edges carry the View's indexes in their data-key. */
export function layoutToSvg(layout: Layout, view: View, options: ViewOptions): string {
  const indexById = new Map(view.nodes.map((viewNode, index) => [viewNode.id, index] as const));
  const viewNodeById = new Map(view.nodes.map((viewNode) => [viewNode.id, viewNode] as const));
  const viewEdgeByKey = new Map(view.edges.map((viewEdge) => [`${viewEdge.from}\n${viewEdge.to}`, viewEdge] as const));

  const arrowColors: string[] = [];
  const arrowIdFor = (color: string): string => {
    let position = arrowColors.indexOf(color);
    if (position < 0) {
      arrowColors.push(color);
      position = arrowColors.length - 1;
    }
    return `arrow-${position}`;
  };

  const bounds: Bounds = { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
  layout.regions.forEach((region) => includeBox(bounds, region.x, region.y, region.x + region.width, region.y + region.height));
  layout.nodes.forEach((placed) => includeBox(bounds, placed.x, placed.y, placed.x + placed.width, placed.y + placed.height));

  const edgeParts: string[] = [];
  layout.edges.forEach((layoutEdge) => {
    const fromIndex = indexById.get(layoutEdge.from);
    const toIndex = indexById.get(layoutEdge.to);
    const viewEdge = viewEdgeByKey.get(`${layoutEdge.from}\n${layoutEdge.to}`);
    if (fromIndex === undefined || toIndex === undefined || !viewEdge) return;
    const markup = edgeMarkup(layoutEdge, viewEdge, viewNodeById.get(layoutEdge.from)!, viewNodeById.get(layoutEdge.to)!, fromIndex, toIndex, view, options, arrowIdFor, bounds);
    if (markup) edgeParts.push(markup);
  });

  const nodeParts: string[] = [];
  layout.nodes.forEach((placed) => {
    const index = indexById.get(placed.id);
    if (index === undefined) return;
    nodeParts.push(nodeMarkup(placed, view.nodes[index], index, options));
  });

  const regionParts = layout.regions.filter((region) => region.kind !== 'cluster').map(regionMarkup);
  const clusterParts = layout.regions.filter((region) => region.kind === 'cluster').map(clusterMarkup);
  const markers = arrowColors.map((color, index) =>
    `<marker id="arrow-${index}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`);

  const boxWidth = bounds.maxX - bounds.minX;
  const boxHeight = bounds.maxY - bounds.minY;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(bounds.minX)} ${formatNumber(bounds.minY)} ${formatNumber(boxWidth)} ${formatNumber(boxHeight)}" width="${formatNumber(boxWidth)}" height="${formatNumber(boxHeight)}" font-family="${FONT}">`,
    `<defs>${markers.join('')}</defs>`,
    ...regionParts,
    ...clusterParts,
    ...edgeParts,
    ...nodeParts,
    '</svg>',
  ].join('');
}
