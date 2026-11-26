/* Layout result shared by every layout engine (swimlane, ELK, Graphviz JSON). Pure data, no Solid, no DOM.
 * Everything is keyed by the ids of the View, so a renderer needs no scraping to map drawn shapes back to nodes. */

export interface Point { x: number; y: number }

/** A positioned node: `id` is the ViewNode id. x/y is the top-left corner. */
export interface LayoutNode { id: string; x: number; y: number; width: number; height: number }

/**
 * A positioned edge, identified by the ViewEdge's `from` and `to` ids. Exactly one route is set: `curve` is one cubic Bezier
 * (start, two control points, end), `points` is a polyline (start, bend points, end) as produced by orthogonal routers.
 */
export interface LayoutEdge {
  from: string;
  to: string;
  curve?: [Point, Point, Point, Point];
  points?: Point[];
  /** The edge points back in time: its target sits in an earlier event than its source. */
  backward: boolean;
}

/** A labelled region: a lane (arm), a column (event) or a cluster (the fields of a form instance zoomed into). */
export interface LayoutRegion {
  id: string;
  kind: 'lane' | 'column' | 'cluster';
  label: string;
  /** `label` wrapped to fit the region, at most a few lines; the last ends in an ellipsis if the label was cut. */
  labelLines?: string[];
  /** Second line, e.g. "day 30 (±7)". */
  sublabel?: string;
  x: number; y: number; width: number; height: number;
  /** Column only: the event repeats, so it is drawn as a stack. */
  repeating?: boolean;
  /** Index of the `View.groups` entry this box draws: a cluster's, or an expanded event's column. Lanes and other columns have none and are not clickable. */
  groupIndex?: number;
}

export interface Layout {
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  regions: LayoutRegion[];
}
