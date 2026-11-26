/* Serialises a Layout as an SVG string shaped like Graphviz output (g.node / g.edge / g.cluster keyed by data-key), so the
 * graph stage can highlight and resolve clicks on it unchanged. Pure: no Solid, no DOM. */
import { KIND_FILL, KIND_STROKE, edgeAppearance, nodeLines, primary } from './exporters';
import { TYPES } from './graph';
import { TEXT_LINE_HEIGHT } from './nodeBox';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion, Point } from './layout';
import type { DepType, NodeKind, View, ViewEdge, ViewNode, ViewOptions } from './types';

const CHARACTER_WIDTH = 6.5;
const NODE_TEXT_PADDING = 12;
const LINE_HEIGHT = TEXT_LINE_HEIGHT;
const LABEL_FONT_SIZE = 12;
const EDGE_LABEL_FONT_SIZE = 9;
const MARKER_SIZE = 8;
const REPEAT_MARK = ' ↻';

/* Styling lives in one <style> element inside the svg (see layoutStyleSheet): the elements below carry semantic classes
 * only. Everything is scoped under the root class so the rules cannot leak into the page or into Graphviz/Mermaid svgs,
 * and every colour is a custom property on that root class so css/style.css (`#canvas svg.layout { --type-calc: … }`)
 * can re-theme it, while a downloaded svg stays self-contained. */
export const ROOT_CLASS = 'layout';
const TYPE_NAMES = Object.keys(TYPES) as DepType[];
const KIND_NAMES = Object.keys(KIND_FILL) as NodeKind[];
const WIDTH_STEP = 0.5;
const MIN_WIDTH = 1;
const MAX_WIDTH = 10;
/** The widths an aggregated edge can be drawn at: 1 to 10 in half-pixel steps. */
const WIDTH_STEPS = Array.from({ length: Math.round((MAX_WIDTH - MIN_WIDTH) / WIDTH_STEP) + 1 }, (_, step) => MIN_WIDTH + step * WIDTH_STEP);
/** Class for a data-driven line width, quantised to WIDTH_STEP: 3.5 -> `w-3-5`. */
export const widthClass = (width: number): string => {
  const quantised = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width / WIDTH_STEP) * WIDTH_STEP));
  return `w-${String(quantised).replace('.', '-')}`;
};
/** Edge colour classes: one per dependency type, plus the cross-arm colour used in instance views. */
const COLOR_NAMES: string[] = [...TYPE_NAMES, 'cross-arm'];
/** Classes the writer emits only as theming hooks (no rule of their own): modifiers whose effect comes from a dash class. */
export const HOOK_CLASSES: readonly string[] = ['mismatch', 'relative'];
const DASH_NAMES = ['bold', 'dashed', 'dotted'] as const;

/** Every class the writer can emit, for the tests that keep the style sheet and the markup in step. */
export const EMITTABLE_CLASSES: readonly string[] = [
  ROOT_CLASS, 'node', 'edge', 'edge-line', 'cluster', 'region', 'lane', 'column', 'repeating', 'focus', 'backward', 'cross-arm', ...HOOK_CLASSES,
  'node-label', 'node-sublabel', 'region-label', 'region-sublabel', 'edge-label',
  ...KIND_NAMES.map((kind) => `kind-${kind}`),
  ...TYPE_NAMES.map((type) => `type-${type}`),
  ...TYPE_NAMES.map((type) => `arrow-${type}`), 'arrow-cross-arm',
  ...DASH_NAMES.map((dash) => `dash-${dash}`),
  ...WIDTH_STEPS.map(widthClass),
];

/** The css for a layout svg, generated from the colour exports so it follows palette changes. `crossArmColor` is the
 * colour edgeAppearance gives a cross-arm edge. */
export function layoutStyleSheet(crossArmColor: string): string {
  const scope = `svg.${ROOT_CLASS}`;
  const variables = [
    ['font', 'Helvetica, Arial, sans-serif'],
    ['text', '#111111'],
    ['region-text', '#374151'],
    ['font-size', `${LABEL_FONT_SIZE}px`],
    ['edge-font-size', `${EDGE_LABEL_FONT_SIZE}px`],
    ['lane-fill', '#f9fafb'],
    ['lane-stroke', '#d1d5db'],
    ['column-stroke', '#d1d5db'],
    ['cluster-stroke', '#9ca3af'],
    ['node-width', '1px'],
    ['focus-width', '3px'],
    ['edge-width', '1.2px'],
    ['bold-width', '2.5px'],
    ['dash-missing', '4 3'],
    ['dash-repeating', '6 4'],
    ['dash-dashed', '5 3'],
    ['dash-dotted', '1.5 3'],
    ['dash-backward', '8 3 2 3'],
    ['cross-arm', crossArmColor],
    ...TYPE_NAMES.map((type) => [`type-${type}`, TYPES[type].color]),
    ...KIND_NAMES.flatMap((kind) => [[`kind-${kind}-fill`, KIND_FILL[kind]], [`kind-${kind}-stroke`, KIND_STROKE[kind]]]),
  ];
  const rules = [
    `${scope}{${variables.map(([name, value]) => `--${name}:${value}`).join(';')};font-family:var(--font)}`,
    `${scope} text{fill:var(--text);font-size:var(--font-size)}`,
    // nodes
    `${scope} g.node>rect{fill:var(--node-fill);stroke:var(--node-stroke);stroke-width:var(--node-width)}`,
    ...KIND_NAMES.map((kind) => `${scope} g.node.kind-${kind}{--node-fill:var(--kind-${kind}-fill);--node-stroke:var(--kind-${kind}-stroke)}`),
    `${scope} g.node.kind-missing>rect{stroke-dasharray:var(--dash-missing)}`,
    `${scope} g.node.focus>rect{stroke-width:var(--focus-width)}`,
    `${scope} text.node-label,${scope} text.node-sublabel{text-anchor:middle}`,
    // regions: lanes and columns (a column can also be a cluster), then plain clusters
    `${scope} g.region.lane>rect{fill:var(--lane-fill);stroke:var(--lane-stroke)}`,
    `${scope} g.region.column>rect{fill:none;stroke:var(--column-stroke)}`,
    `${scope} g.region.column.repeating>rect{stroke-dasharray:var(--dash-repeating)}`,
    `${scope} g.cluster:not(.region)>rect{fill:none;stroke:var(--cluster-stroke)}`,
    `${scope} text.region-label,${scope} text.region-sublabel{fill:var(--region-text);text-anchor:start}`,
    `${scope} g.column>text.region-label,${scope} g.column>text.region-sublabel{text-anchor:middle}`,
    // edges: the colour is one variable that the line, the label and (through the arrow class) the head share
    `${scope} g.edge{--edge-color:var(--text);--edge-line-width:var(--edge-width);--edge-dash:none}`,
    ...TYPE_NAMES.map((type) => `${scope} g.edge.type-${type}{--edge-color:var(--type-${type})}`),
    `${scope} g.edge.cross-arm{--edge-color:var(--cross-arm)}`,
    `${scope} g.edge.backward{--edge-dash:var(--dash-backward)}`,
    `${scope} g.edge.dash-bold{--edge-line-width:var(--bold-width)}`,
    `${scope} g.edge.dash-dashed{--edge-dash:var(--dash-dashed)}`,
    `${scope} g.edge.dash-dotted{--edge-dash:var(--dash-dotted)}`,
    ...WIDTH_STEPS.map((width) => `${scope} g.edge.${widthClass(width)}{--edge-line-width:${width}px}`),
    `${scope} g.edge>path.edge-line{fill:none;stroke:var(--edge-color);stroke-width:var(--edge-line-width);stroke-dasharray:var(--edge-dash)}`,
    `${scope} g.edge>text.edge-label{fill:var(--edge-color);font-size:var(--edge-font-size);text-anchor:middle}`,
    // the arrow head: a marker per colour, picked by the edge's colour class and filled from the same variable
    ...COLOR_NAMES.map((color) => `${scope} g.edge.${color === 'cross-arm' ? color : `type-${color}`}>path.edge-line{marker-end:url(#arrow-${color})}`),
    ...COLOR_NAMES.map((color) => `${scope} marker.arrow-${color}>path{fill:var(--${color === 'cross-arm' ? color : `type-${color}`})}`),
  ];
  return rules.join('\n');
}

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

/** One line of text and the class that styles it. */
interface TextLine { text: string; className: string }

/** One <text> per line, starting at `firstY` and stepping by LINE_HEIGHT. */
function textLines(lines: TextLine[], x: number, firstY: number): string {
  return lines
    .map((line, index) => `<text class="${line.className}" x="${formatNumber(x)}" y="${formatNumber(firstY + index * LINE_HEIGHT)}">${escapeXml(line.text)}</text>`)
    .join('');
}

/** Region label lines: the wrapped label, a repeat mark on the last label line, then the sublabel. */
function regionLines(region: LayoutRegion): TextLine[] {
  const labels = [...(region.labelLines ?? [region.label])];
  if (region.kind === 'column' && region.repeating && labels.length > 0) labels[labels.length - 1] += REPEAT_MARK;
  const lines = labels.map((text): TextLine => ({ text, className: 'region-label' }));
  if (region.sublabel) lines.push({ text: region.sublabel, className: 'region-sublabel' });
  return lines;
}

function regionMarkup(region: LayoutRegion): string {
  const kind = region.kind === 'column' ? 'column' : 'lane';
  const rect = `<rect x="${formatNumber(region.x)}" y="${formatNumber(region.y)}" width="${formatNumber(region.width)}" height="${formatNumber(region.height)}"/>`;
  const label = kind === 'column'
    ? textLines(regionLines(region), region.x + region.width / 2, region.y + 16)
    : textLines(regionLines(region), region.x + 8, region.y + 16);
  // a column that draws an expanded event is also that event's box: Graphviz-shaped, so it highlights and clicks like one
  const boxed = kind === 'column' && region.groupIndex !== undefined;
  const classes = [boxed ? 'cluster' : '', 'region', kind, kind === 'column' && region.repeating ? 'repeating' : ''].filter(Boolean).join(' ');
  const key = boxed ? ` data-key="cluster_${region.groupIndex}"` : '';
  return `<g class="${classes}"${key} data-region-id="${escapeXml(region.id)}">${rect}${label}</g>`;
}

function clusterMarkup(region: LayoutRegion): string {
  const key = region.groupIndex === undefined ? '' : ` data-key="cluster_${region.groupIndex}"`;
  const rect = `<rect x="${formatNumber(region.x)}" y="${formatNumber(region.y)}" width="${formatNumber(region.width)}" height="${formatNumber(region.height)}" rx="6"/>`;
  const label = textLines((region.labelLines ?? [region.label]).map((text): TextLine => ({ text, className: 'region-label' })), region.x + 6, region.y + 13);
  return `<g class="cluster"${key}>${rect}${label}</g>`;
}

function nodeMarkup(placed: LayoutNode, viewNode: ViewNode, index: number, options: ViewOptions): string {
  const lines = nodeLines(viewNode, options);
  const maxCharacters = Math.floor((placed.width - NODE_TEXT_PADDING) / CHARACTER_WIDTH);
  const fitted = lines.map((line) => fitText(line, maxCharacters));
  const rect = `<rect x="${formatNumber(placed.x)}" y="${formatNumber(placed.y)}" width="${formatNumber(placed.width)}" height="${formatNumber(placed.height)}" rx="4"/>`;
  const firstY = placed.y + placed.height / 2 - ((fitted.length - 1) * LINE_HEIGHT) / 2 + LABEL_FONT_SIZE / 3;
  const label = textLines(fitted.map((text, line): TextLine => ({ text, className: line === 0 ? 'node-label' : 'node-sublabel' })), placed.x + placed.width / 2, firstY);
  const classes = `node kind-${viewNode.kind}${viewNode.focus ? ' focus' : ''}`;
  return `<g class="${classes}" data-key="n${index}"><title>${escapeXml(lines.join(' · '))}</title>${rect}${label}</g>`;
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
  bounds: Bounds,
): string | null {
  const route = routeOf(layoutEdge);
  if (!route) return null;
  const routePoints = layoutEdge.curve
    ? Array.from({ length: SAMPLES_PER_CURVE + 1 }, (_, step) => bezierPoint(layoutEdge.curve!, step / SAMPLES_PER_CURVE))
    : layoutEdge.points ?? [];
  routePoints.forEach((point) => includeBox(bounds, point.x, point.y, point.x, point.y));
  const look = edgeAppearance(view, viewEdge, options);
  const primaryType = primary(viewEdge);
  // the colour class is the primary type's, unless edgeAppearance gave the edge another colour (the cross-arm red)
  const crossArm = look.color !== TYPES[primaryType].color;
  const classes = [
    'edge', `type-${primaryType}`,
    crossArm ? 'cross-arm' : '',
    view.instances && viewEdge.mismatch ? 'mismatch' : '',
    view.instances && !viewEdge.mismatch && viewEdge.relative ? 'relative' : '',
    layoutEdge.backward ? 'backward' : '',
    look.dash === 'solid' ? '' : `dash-${look.dash}`,
    look.width === null ? '' : widthClass(look.width),
  ].filter(Boolean).join(' ');
  const path = `<path class="edge-line" d="${route.d}"/>`;
  let label = '';
  if (look.label) {
    const text = fitText(look.label, MAX_EDGE_LABEL_CHARACTERS);
    const halfWidth = (text.length * CHARACTER_WIDTH) / 2 + EDGE_LABEL_PADDING;
    const baseline = route.middle.y - 3;
    includeBox(bounds, route.middle.x - halfWidth, baseline - EDGE_LABEL_FONT_SIZE - EDGE_LABEL_PADDING, route.middle.x + halfWidth, baseline + EDGE_LABEL_PADDING);
    label = textLines([{ text, className: 'edge-label' }], route.middle.x, baseline);
  }
  const title = `<title>${escapeXml(fromNode.label)} -> ${escapeXml(toNode.label)}</title>`;
  return `<g class="${classes}" data-key="n${fromIndex}->n${toIndex}">${title}${path}${label}</g>`;
}

/** Lay the layout out as an SVG string; nodes and edges carry the View's indexes in their data-key. */
export function layoutToSvg(layout: Layout, view: View, options: ViewOptions): string {
  const indexById = new Map(view.nodes.map((viewNode, index) => [viewNode.id, index] as const));
  const viewNodeById = new Map(view.nodes.map((viewNode) => [viewNode.id, viewNode] as const));
  const viewEdgeByKey = new Map(view.edges.map((viewEdge) => [`${viewEdge.from}\n${viewEdge.to}`, viewEdge] as const));

  const bounds: Bounds = { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
  layout.regions.forEach((region) => includeBox(bounds, region.x, region.y, region.x + region.width, region.y + region.height));
  layout.nodes.forEach((placed) => includeBox(bounds, placed.x, placed.y, placed.x + placed.width, placed.y + placed.height));

  const edgeParts: string[] = [];
  layout.edges.forEach((layoutEdge) => {
    const fromIndex = indexById.get(layoutEdge.from);
    const toIndex = indexById.get(layoutEdge.to);
    const viewEdge = viewEdgeByKey.get(`${layoutEdge.from}\n${layoutEdge.to}`);
    if (fromIndex === undefined || toIndex === undefined || !viewEdge) return;
    const markup = edgeMarkup(layoutEdge, viewEdge, viewNodeById.get(layoutEdge.from)!, viewNodeById.get(layoutEdge.to)!, fromIndex, toIndex, view, options, bounds);
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
  // one arrow head per edge colour, always all of them: the edge rules in the style sheet pick one by class
  const markers = COLOR_NAMES.map((color) =>
    `<marker id="arrow-${color}" class="arrow-${color}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`);
  // what edgeAppearance colours a cross-arm edge, read from it rather than repeated here
  const crossArmProbe: ViewEdge = { from: '', to: '', types: ['branching'], count: 1, byType: { branching: 1 }, crossArm: true };
  const crossArmColor = edgeAppearance({ ...view, instances: true }, crossArmProbe, options).color;

  const boxWidth = bounds.maxX - bounds.minX;
  const boxHeight = bounds.maxY - bounds.minY;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="${ROOT_CLASS}" viewBox="${formatNumber(bounds.minX)} ${formatNumber(bounds.minY)} ${formatNumber(boxWidth)} ${formatNumber(boxHeight)}" width="${formatNumber(boxWidth)}" height="${formatNumber(boxHeight)}">`,
    `<defs><style>${layoutStyleSheet(crossArmColor)}</style>${markers.join('')}</defs>`,
    ...regionParts,
    ...clusterParts,
    ...edgeParts,
    ...nodeParts,
    '</svg>',
  ].join('');
}
