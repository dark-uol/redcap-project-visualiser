/* Size of a node box in the layout engines (swimlane, ELK), derived from the text `layoutToSvg` draws in it. The engines size
 * the boxes with these helpers and `layoutToSvg` steps its text lines with the same constants, so they cannot disagree.
 * Pure: no Solid, no DOM. */
import { nodeLines } from './exporters';
import type { ViewNode, ViewOptions } from './types';

/** The options that change what a node shows; both engines and the SVG writer read the same ones. */
export type NodeBoxOptions = Partial<Pick<ViewOptions, 'labelMode'>>;

/** Fixed box width: longer text is truncated with an ellipsis, never wrapped. */
export const NODE_BOX_WIDTH = 120;
/** Vertical step between the text lines of a node (and of region labels). */
export const TEXT_LINE_HEIGHT = 14;
/** Blank space above the first and below the last text line, in total. */
export const NODE_BOX_PADDING = 14;
/** One text line plus its padding: the height of a single-line node. */
export const NODE_BOX_MINIMUM_HEIGHT = TEXT_LINE_HEIGHT + NODE_BOX_PADDING;

/** How many text lines `layoutToSvg` draws for the node: the label, its extra lines, and the sub-label in label mode. */
export const nodeLineCount = (node: ViewNode, options: NodeBoxOptions = {}): number => nodeLines(node, options).length;

/** A form box holding more nodes than this draws them as compact chips (see `isCompactNode`). */
export const CLUSTER_COMPACT_THRESHOLD = 60;
/** Size of a compact chip: one text line in a smaller box. `layoutToSvg` fits the text to whatever width the layout gives. */
export const COMPACT_NODE_WIDTH = 72;
export const COMPACT_NODE_HEIGHT = 22;

/** Whether a node in a form box of `clusterSize` nodes is drawn as a compact chip: only in a big box, and only when it has a
 * single text line (nodes with more lines keep their normal size so their text fits). */
export const isCompactNode = (node: ViewNode, clusterSize: number, options: NodeBoxOptions = {}): boolean =>
  clusterSize > CLUSTER_COMPACT_THRESHOLD && nodeLineCount(node, options) === 1;

export const nodeBoxHeight = (node: ViewNode, options: NodeBoxOptions = {}, compact = false): number =>
  compact ? COMPACT_NODE_HEIGHT : Math.max(NODE_BOX_MINIMUM_HEIGHT, nodeLineCount(node, options) * TEXT_LINE_HEIGHT + NODE_BOX_PADDING);

export const nodeBoxWidth = (compact = false): number => (compact ? COMPACT_NODE_WIDTH : NODE_BOX_WIDTH);

/** Edges attach to a node side at ports this far apart: every other row of the swimlane engine's 4 px routing lattice, the
 * rows between being left to the nodes across the gutter... */
export const PORT_SPACING = 8;
/** ...and at least this far from the side's corners. */
export const PORT_MARGIN = 4;

/** Height of a node box that also fits `ports` ports on one side. The text is centred vertically, so it stays inside. */
export const nodeBoxHeightWithPorts = (node: ViewNode, options: NodeBoxOptions, ports: number, compact = false): number =>
  Math.max(nodeBoxHeight(node, options, compact), ports * PORT_SPACING + 2 * PORT_MARGIN);

export const nodeBoxSize = (node: ViewNode, options: NodeBoxOptions = {}, compact = false): { width: number; height: number } =>
  ({ width: nodeBoxWidth(compact), height: nodeBoxHeight(node, options, compact) });
