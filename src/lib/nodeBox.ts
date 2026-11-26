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

export const nodeBoxHeight = (node: ViewNode, options: NodeBoxOptions = {}): number =>
  Math.max(NODE_BOX_MINIMUM_HEIGHT, nodeLineCount(node, options) * TEXT_LINE_HEIGHT + NODE_BOX_PADDING);

export const nodeBoxSize = (node: ViewNode, options: NodeBoxOptions = {}): { width: number; height: number } =>
  ({ width: NODE_BOX_WIDTH, height: nodeBoxHeight(node, options) });
