/* Swimlane layout of the form-instance view: one lane per arm, one column per event, time running left to right.
 * Pure and deterministic; no Solid, no DOM. */
import type { EventDef, View, ViewEdge, ViewNode } from './types';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion, Point } from './layout';

const NODE_WIDTH = 120;
const NODE_HEIGHT = 28;
const NODE_GAP = 18;
const COLUMN_GAP = 40;
const COLUMN_PITCH = NODE_WIDTH + COLUMN_GAP;
const PIXELS_PER_DAY = 10;
/** Longest day span drawn at full scale; longer studies are compressed so the graph stays a sensible width. */
const MAX_DAY_SPAN_PIXELS = 900;
const MARGIN = 20;
const LANE_LABEL_WIDTH = 120;
const HEADER_PADDING = 12;
const HEADER_LINE_HEIGHT = 14;
const COLUMN_LABEL_CHARACTERS = 22;
const LANE_LABEL_CHARACTERS = 16;
const MAX_LABEL_LINES = 3;
const CLUSTER_SIDE = 6;
const CLUSTER_TOP = 18;
const CLUSTER_BOTTOM = 6;
const CLUSTER_LABEL_CHARACTERS = 20;
const LANE_FOOTER = 30;
const LANE_GAP = 20;
const BACKWARD_BOW = 40;
const FIRST_CENTER = MARGIN + LANE_LABEL_WIDTH + COLUMN_PITCH / 2;
const NO_EVENT_ARM = '(no event)';
/** An event column holds at most this many stacked nodes; more flow into side-by-side sub-columns, so a big project
 * stays a sensible height. */
export const MAX_COLUMN_ROWS = 25;

interface ColumnPlan {
  id: string;
  event?: EventDef;
  nodes: ViewNode[];
  /** Centre of the whole column region (all its sub-columns). */
  centerX: number;
  /** Number of side-by-side sub-columns, each COLUMN_PITCH wide; the region is `subColumns * COLUMN_PITCH` wide. */
  subColumns: number;
  /** Stacked nodes per sub-column (the last may hold fewer). */
  rowsPerSubColumn: number;
  /** Top-left y of each node, relative to the lane's top, by node id. */
  topById: Map<string, number>;
  /** Index of the sub-column each node sits in, by node id. */
  subColumnById: Map<string, number>;
  /** Height of the tallest sub-column's stacked nodes, including cluster padding. */
  contentHeight: number;
}

const newColumnPlan = (id: string, nodes: ViewNode[], event?: EventDef): ColumnPlan => {
  const subColumns = Math.max(1, Math.ceil(nodes.length / MAX_COLUMN_ROWS));
  return {
    id, event, nodes, centerX: 0, subColumns, rowsPerSubColumn: Math.max(1, Math.ceil(nodes.length / subColumns)),
    topById: new Map(), subColumnById: new Map(), contentHeight: 0,
  };
};

const columnWidth = (column: ColumnPlan): number => column.subColumns * COLUMN_PITCH;

interface LanePlan {
  id: string;
  label: string;
  columns: ColumnPlan[];
  y: number;
  height: number;
}

/** "day 30 (±7)", "day 30", "(-3/+7)", "(±7)": parts that are missing are omitted. */
const formatSublabel = (event: EventDef): string | undefined => {
  const parts: string[] = [];
  if (event.dayOffset !== undefined) parts.push(`day ${event.dayOffset}`);
  const { offsetMin: minimum, offsetMax: maximum } = event;
  const window: string[] = [];
  if (minimum !== undefined && maximum !== undefined && minimum === maximum && minimum > 0) window.push(`±${minimum}`);
  else {
    if (minimum !== undefined && minimum > 0) window.push(`-${minimum}`);
    if (maximum !== undefined && maximum > 0) window.push(`+${maximum}`);
  }
  if (window.length) parts.push(`(${window.join('/')})`);
  return parts.length ? parts.join(' ') : undefined;
};

/** Greedy word wrap to `maxCharacters` per line; long words are split, and what does not fit in `maxLines` ends in an ellipsis. */
export const wrapLabel = (text: string, maxCharacters: number, maxLines: number = MAX_LABEL_LINES): string[] => {
  const lines: string[] = [];
  let current = '';
  text.split(/\s+/).filter(Boolean).forEach((word) => {
    let rest = word;
    while (rest.length > maxCharacters) {
      if (current) { lines.push(current); current = ''; }
      lines.push(rest.slice(0, maxCharacters));
      rest = rest.slice(maxCharacters);
    }
    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= maxCharacters) current += ' ' + rest;
    else { lines.push(current); current = rest; }
  });
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines.length ? lines : [''];
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = (last.length >= maxCharacters ? last.slice(0, maxCharacters - 1) : last) + '…';
  return kept;
};

const stackHeight = (count: number): number => (count === 0 ? 0 : count * NODE_HEIGHT + (count - 1) * NODE_GAP);

/** Assigns each drawn event column a centre x: scaled by day when every event has one, else by order; then keeps columns apart.
 * A column is `columnWidth` wide (one pitch per sub-column) and centred on its desired x, but never starts left of the first
 * column's left edge and never overlaps what precedes it: it is pushed right until its left edge clears the right edge of the
 * previous column, or, when columns share an x (equal days in different arms), of the widest column in that shared group. */
const placeColumns = (columns: ColumnPlan[]): void => {
  const timed = columns.length > 0 && columns.every((column) => column.event?.dayOffset !== undefined);
  if (timed) {
    // Stable sort: events with equal days keep their order in `events`.
    columns.sort((first, second) => (first.event!.dayOffset as number) - (second.event!.dayOffset as number));
  }
  const firstCenter = FIRST_CENTER;
  const firstDay = timed ? (columns[0].event!.dayOffset as number) : 0;
  const lastDay = timed ? (columns[columns.length - 1].event!.dayOffset as number) : 0;
  const pixelsPerDay = lastDay > firstDay ? Math.min(PIXELS_PER_DAY, MAX_DAY_SPAN_PIXELS / (lastDay - firstDay)) : PIXELS_PER_DAY;
  const firstLeft = firstCenter - COLUMN_PITCH / 2;
  let previous: ColumnPlan | undefined;
  let sharedArms = new Set<string>();
  // right edge of the group of columns sharing the previous x
  let groupRight = firstLeft;
  const armRight = new Map<string, number>();
  columns.forEach((column, index) => {
    const halfWidth = columnWidth(column) / 2;
    const desired = timed
      ? firstCenter + ((column.event!.dayOffset as number) - firstDay) * pixelsPerDay
      : firstCenter + index * COLUMN_PITCH;
    const arm = column.event!.arm;
    const sameDay = timed && previous !== undefined && previous.event!.dayOffset === column.event!.dayOffset;
    // what the column's own lane already holds: a wide column sharing an x must still start right of its own lane's last column
    const ownLaneClearance = (armRight.get(arm) ?? firstLeft) + halfWidth;
    if (previous && sameDay && !sharedArms.has(arm)) {
      // Equal days in different arms may share an x: their lanes keep them apart.
      column.centerX = Math.max(previous.centerX, firstLeft + halfWidth, ownLaneClearance);
      sharedArms.add(arm);
      groupRight = Math.max(groupRight, column.centerX + halfWidth);
    } else {
      column.centerX = Math.max(desired, firstLeft + halfWidth, previous ? groupRight + halfWidth : 0);
      sharedArms = new Set([arm]);
      groupRight = column.centerX + halfWidth;
    }
    armRight.set(arm, column.centerX + halfWidth);
    previous = column;
  });
};

/** Initial order: position of the node's form in the event's form list, then view order. */
const initialOrder = (column: ColumnPlan, viewOrder: Map<string, number>): ViewNode[] => {
  const forms = column.event?.forms ?? [];
  const formRank = (node: ViewNode): number => {
    const index = forms.indexOf(node.form);
    return index < 0 ? forms.length : index;
  };
  return [...column.nodes].sort((first, second) =>
    formRank(first) - formRank(second) || (viewOrder.get(first.id) as number) - (viewOrder.get(second.id) as number));
};

/** One barycentre sweep left to right: order by the mean y of already-placed neighbours in earlier columns of the lane.
 * The fields of a zoomed-in form stay together, ordered as one unit, with padding around them for the cluster box. */
const orderLane = (
  lane: LanePlan, neighbours: Map<string, string[]>, viewOrder: Map<string, number>, headerHeight: number, clusterOf: Map<string, string>,
): void => {
  const placedTop = new Map<string, number>();
  lane.columns.forEach((column) => {
    const initial = initialOrder(column, viewOrder);
    // a wrapped column is that many times shorter, so an unconnected node's slot is scaled to its row
    const keyed = initial.map((node, slot) => {
      const tops = (neighbours.get(node.id) ?? []).filter((id) => placedTop.has(id)).map((id) => placedTop.get(id) as number);
      const barycentre = tops.length ? tops.reduce((sum, top) => sum + top, 0) / tops.length : (slot / column.subColumns) * (NODE_HEIGHT + NODE_GAP);
      return { node, slot, barycentre };
    });
    const clusterSizes = new Map<string, number>();
    initial.forEach((node) => {
      const cluster = clusterOf.get(node.id);
      if (cluster) clusterSizes.set(cluster, (clusterSizes.get(cluster) ?? 0) + 1);
    });
    const clusterMeans = new Map<string, number>();
    keyed.forEach(({ node, barycentre }) => {
      const cluster = clusterOf.get(node.id);
      if (cluster) clusterMeans.set(cluster, (clusterMeans.get(cluster) ?? 0) + barycentre / (clusterSizes.get(cluster) as number));
    });
    const sortKey = (entry: { node: ViewNode; barycentre: number }): number => {
      const cluster = clusterOf.get(entry.node.id);
      return cluster ? (clusterMeans.get(cluster) as number) : entry.barycentre;
    };
    keyed.sort((first, second) => sortKey(first) - sortKey(second) || first.slot - second.slot);
    // Fill column-major: the sorted nodes run down the first sub-column, then the next, so a form's fields stay contiguous.
    // Each sub-column starts again at the header, and a form box cut by a boundary is closed and reopened (CLUSTER_TOP again).
    let top = headerHeight;
    let previousCluster: string | undefined;
    let tallest = 0;
    keyed.forEach(({ node }, position) => {
      const subColumn = Math.floor(position / column.rowsPerSubColumn);
      const startsSubColumn = position % column.rowsPerSubColumn === 0;
      if (startsSubColumn && position > 0) {
        tallest = Math.max(tallest, top - headerHeight + (previousCluster ? CLUSTER_BOTTOM : 0));
        top = headerHeight;
        previousCluster = undefined;
      }
      const cluster = clusterOf.get(node.id);
      if (!startsSubColumn) top += NODE_GAP;
      if (previousCluster && previousCluster !== cluster) top += CLUSTER_BOTTOM;
      if (cluster && cluster !== previousCluster) top += CLUSTER_TOP;
      column.topById.set(node.id, top);
      column.subColumnById.set(node.id, subColumn);
      placedTop.set(node.id, top);
      top += NODE_HEIGHT;
      previousCluster = cluster;
    });
    column.contentHeight = keyed.length ? Math.max(tallest, top - headerHeight + (previousCluster ? CLUSTER_BOTTOM : 0)) : 0;
  });
};

export type Curve = [Point, Point, Point, Point];
/** Vertical shifts tried, in order, for a left-to-right or backward edge until one clears every other node. */
const ROUTE_OFFSETS = [0, -40, 40, -80, 80, -120, 120];
/** Horizontal bows tried, in order, for a same-column edge that cannot run straight. */
const SIDE_BOWS = [70, -70, 24, -24, 110, -110, 160, -160];
export const NODE_CLEARANCE = 4;
const RECIPROCAL_NUDGE = 8;
const CURVE_SAMPLES = 32;
const GRID_CELL = NODE_WIDTH;

export const curvePoint = (curve: Curve, t: number): Point => {
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: curve.reduce((sum, point, index) => sum + point.x * weights[index], 0),
    y: curve.reduce((sum, point, index) => sum + point.y * weights[index], 0),
  };
};

/** Uniform grid of node boxes (each node listed in every cell its clearance-inflated box touches), so a point query looks at
 * a handful of nodes instead of all of them. */
export type NodeGrid = Map<string, LayoutNode[]>;

const cellKey = (column: number, row: number): string => `${column},${row}`;

export const buildNodeGrid = (nodes: LayoutNode[]): NodeGrid => {
  const grid: NodeGrid = new Map();
  nodes.forEach((node) => {
    const firstColumn = Math.floor((node.x - NODE_CLEARANCE) / GRID_CELL);
    const lastColumn = Math.floor((node.x + node.width + NODE_CLEARANCE) / GRID_CELL);
    const firstRow = Math.floor((node.y - NODE_CLEARANCE) / GRID_CELL);
    const lastRow = Math.floor((node.y + node.height + NODE_CLEARANCE) / GRID_CELL);
    for (let column = firstColumn; column <= lastColumn; column++) {
      for (let row = firstRow; row <= lastRow; row++) {
        const key = cellKey(column, row);
        const cell = grid.get(key);
        if (cell) cell.push(node); else grid.set(key, [node]);
      }
    }
  });
  return grid;
};

/** Whether the curve passes through any node other than the ignored ones (its own endpoints): samples the curve and checks
 * only the nodes in the grid cell of each sample. Same result as testing every node. */
export const curveHitsNode = (curve: Curve, grid: NodeGrid, ignored: Set<string>): boolean => {
  for (let step = 1; step < CURVE_SAMPLES; step++) {
    const point = curvePoint(curve, step / CURVE_SAMPLES);
    const cell = grid.get(cellKey(Math.floor(point.x / GRID_CELL), Math.floor(point.y / GRID_CELL)));
    if (!cell) continue;
    const hit = cell.some((node) => !ignored.has(node.id)
      && point.x > node.x - NODE_CLEARANCE && point.x < node.x + node.width + NODE_CLEARANCE
      && point.y > node.y - NODE_CLEARANCE && point.y < node.y + node.height + NODE_CLEARANCE);
    if (hit) return true;
  }
  return false;
};

/** The ids of the nodes (other than the ignored ones) that the curve passes through, found like `curveHitsNode` but without stopping at the first. */
export const curveHitIds = (curve: Curve, grid: NodeGrid, ignored: Set<string>): Set<string> => {
  const hits = new Set<string>();
  for (let step = 1; step < CURVE_SAMPLES; step++) {
    const point = curvePoint(curve, step / CURVE_SAMPLES);
    const cell = grid.get(cellKey(Math.floor(point.x / GRID_CELL), Math.floor(point.y / GRID_CELL)));
    if (!cell) continue;
    cell.forEach((node) => {
      if (!ignored.has(node.id)
        && point.x > node.x - NODE_CLEARANCE && point.x < node.x + node.width + NODE_CLEARANCE
        && point.y > node.y - NODE_CLEARANCE && point.y < node.y + node.height + NODE_CLEARANCE) hits.add(node.id);
    });
  }
  return hits;
};

/** The ids of the nodes (other than the ignored ones) that an axis-aligned polyline passes through. Every segment of a gutter
 * route is horizontal or vertical, so a segment is its own bounding box and is tested exactly against the grid cells it spans. */
export const polylineHitIds = (points: Point[], grid: NodeGrid, ignored: Set<string>): Set<string> => {
  const hits = new Set<string>();
  for (let index = 1; index < points.length; index++) {
    const left = Math.min(points[index - 1].x, points[index].x);
    const right = Math.max(points[index - 1].x, points[index].x);
    const top = Math.min(points[index - 1].y, points[index].y);
    const bottom = Math.max(points[index - 1].y, points[index].y);
    for (let column = Math.floor(left / GRID_CELL); column <= Math.floor(right / GRID_CELL); column++) {
      for (let row = Math.floor(top / GRID_CELL); row <= Math.floor(bottom / GRID_CELL); row++) {
        grid.get(cellKey(column, row))?.forEach((node) => {
          if (!ignored.has(node.id) && left < node.x + node.width + NODE_CLEARANCE && right > node.x - NODE_CLEARANCE
            && top < node.y + node.height + NODE_CLEARANCE && bottom > node.y - NODE_CLEARANCE) hits.add(node.id);
        });
      }
    }
  }
  return hits;
};

/** Free vertical lane beside a node's side: the middle of the COLUMN_GAP between this sub-column and its neighbour. */
const GUTTER_OFFSET = (COLUMN_PITCH - NODE_WIDTH) / 2;
/** Extra channels tried above and below the nearest gaps, one row (a node and its gap) at a time. */
const CHANNEL_ROWS = 6;
const ARROW_MARGIN = 10;

/** Gutter-channel polylines for an edge, in the order they are tried: out of the source's side into the gutter, along a
 * horizontal channel in a gap between rows, and into the target's side through its gutter. */
const gutterRoutes = (source: LayoutNode, target: LayoutNode, leftward: boolean, rightward: boolean, nudge: number): Point[][] => {
  const sourceMiddle = source.y + source.height / 2;
  const targetMiddle = target.y + target.height / 2;
  const routes: Point[][] = [];
  if (!leftward && !rightward) {
    // overlapping x (one sub-column, or equal-day columns of different lanes): out of the right gutter and back, then the left
    [1, -1].forEach((side) => {
      const sourceEdge = side > 0 ? source.x + source.width : source.x;
      const targetEdge = side > 0 ? target.x + target.width : target.x;
      const gutter = side > 0 ? Math.max(sourceEdge, targetEdge) + GUTTER_OFFSET + nudge : Math.min(sourceEdge, targetEdge) - GUTTER_OFFSET + nudge;
      routes.push([{ x: sourceEdge, y: sourceMiddle }, { x: gutter, y: sourceMiddle }, { x: gutter, y: targetMiddle }, { x: targetEdge, y: targetMiddle }]);
    });
    return routes;
  }
  const direction = rightward ? 1 : -1;
  const start = { x: direction > 0 ? source.x + source.width : source.x, y: sourceMiddle };
  const end = { x: direction > 0 ? target.x : target.x + target.width, y: targetMiddle };
  const sourceGutter = start.x + direction * GUTTER_OFFSET;
  const targetGutter = end.x - direction * GUTTER_OFFSET;
  const row = NODE_HEIGHT + NODE_GAP;
  const below = (node: LayoutNode): number => node.y + node.height + NODE_GAP / 2;
  const above = (node: LayoutNode): number => node.y - NODE_GAP / 2;
  const channels: number[] = [below(source), above(source), below(target), above(target)];
  for (let step = 1; step <= CHANNEL_ROWS; step++) channels.push(below(source) + step * row, above(source) - step * row, below(target) + step * row, above(target) - step * row);
  [...new Set(channels)].forEach((channel) => {
    routes.push([start, { x: sourceGutter, y: sourceMiddle }, { x: sourceGutter, y: channel }, { x: targetGutter, y: channel }, { x: targetGutter, y: targetMiddle }, end]);
  });
  return routes;
};

export function layoutSwimlane(view: View, events: EventDef[]): Layout {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const viewOrder = new Map(view.nodes.map((node, index) => [node.id, index]));

  // Group the nodes by event; unknown or missing events go to the "(no event)" bucket.
  const nodesByEvent = new Map<string, ViewNode[]>();
  const unplaced: ViewNode[] = [];
  // without instances a field or a form has no event of its own: it sits in the first event whose schedule includes its form
  const firstEventOfForm = new Map<string, EventDef>();
  events.forEach((event) => event.forms.forEach((formId) => { if (!firstEventOfForm.has(formId)) firstEventOfForm.set(formId, event); }));
  const homeEvent = (node: ViewNode): EventDef | undefined => {
    if (node.event != null) return eventById.get(node.event); // a form instance
    if (view.level === 'event') return eventById.get(node.id); // a collapsed event is itself a node, whose id is the event's
    if ((view.level === 'field' || view.level === 'form') && node.form) return firstEventOfForm.get(node.form);
    return undefined;
  };
  view.nodes.forEach((node) => {
    const event = homeEvent(node);
    if (!event) { unplaced.push(node); return; }
    const bucket = nodesByEvent.get(event.id);
    if (bucket) bucket.push(node); else nodesByEvent.set(event.id, [node]);
  });

  // Columns in `events` order, only for events with nodes; lanes by first appearance of the arm.
  const columns: ColumnPlan[] = [];
  events.forEach((event) => {
    const nodes = nodesByEvent.get(event.id);
    if (nodes && !columns.some((column) => column.event === event)) {
      columns.push(newColumnPlan(`column:${event.id}`, nodes, event));
    }
  });
  placeColumns(columns);

  const lanes: LanePlan[] = [];
  const laneByArm = new Map<string, LanePlan>();
  columns.forEach((column) => {
    const event = column.event!;
    let lane = laneByArm.get(event.arm);
    if (!lane) {
      lane = { id: `lane:${event.arm}`, label: `Arm ${event.arm}: ${event.armName}`, columns: [], y: 0, height: 0 };
      laneByArm.set(event.arm, lane);
      lanes.push(lane);
    }
    lane.columns.push(column);
  });
  if (unplaced.length) {
    const column = newColumnPlan(`column:${NO_EVENT_ARM}`, unplaced);
    // left-aligned with the first event column
    column.centerX = FIRST_CENTER - COLUMN_PITCH / 2 + columnWidth(column) / 2;
    lanes.push({ id: `lane:${NO_EVENT_ARM}`, label: NO_EVENT_ARM, columns: [column], y: 0, height: 0 });
  }

  // Undirected neighbours for the barycentre sweep.
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const list = neighbours.get(from);
    if (list) list.push(to); else neighbours.set(from, [to]);
  };
  view.edges.forEach((edge) => { link(edge.from, edge.to); link(edge.to, edge.from); });

  // Boxes: at field level the selectable groups (forms; event and arm groups are the columns and lanes already); otherwise
  // the group named after an expanded form instance holds its field nodes.
  const clusterOf = new Map<string, string>();
  const clusterGroups = view.level === 'field'
    ? view.groups.filter((group) => !group.noSelect)
    : view.groups.filter((group) => (view.expandedNodes ?? []).some((expanded) => expanded.id === group.id));
  clusterGroups.forEach((group) => group.nodes.forEach((id) => clusterOf.set(id, group.id)));

  // Header: tall enough for the longest wrapped event name, plus the day line when any column has one.
  const columnLines = new Map<string, string[]>();
  lanes.forEach((lane) => lane.columns.forEach((column) => {
    columnLines.set(column.id, wrapLabel(column.event ? column.event.label : NO_EVENT_ARM, COLUMN_LABEL_CHARACTERS));
  }));
  const tallestLabel = Math.max(1, ...[...columnLines.values()].map((lines) => lines.length));
  const hasSublabel = lanes.some((lane) => lane.columns.some((column) => column.event && formatSublabel(column.event)));
  const headerHeight = HEADER_PADDING + tallestLabel * HEADER_LINE_HEIGHT + (hasSublabel ? HEADER_LINE_HEIGHT : 0);

  // Vertical placement.
  let cursorY = MARGIN;
  lanes.forEach((lane) => {
    orderLane(lane, neighbours, viewOrder, headerHeight, clusterOf);
    const tallest = Math.max(...lane.columns.map((column) => column.contentHeight));
    lane.y = cursorY;
    lane.height = headerHeight + tallest + LANE_FOOTER;
    cursorY += lane.height + LANE_GAP;
  });

  // Nodes, regions.
  const nodes: LayoutNode[] = [];
  const nodeColumn = new Map<string, ColumnPlan>();
  const nodeById = new Map<string, LayoutNode>();
  const maxRight = Math.max(FIRST_CENTER + COLUMN_PITCH / 2, ...lanes.flatMap((lane) => lane.columns.map((column) => column.centerX + columnWidth(column) / 2)));
  const width = maxRight + MARGIN;
  const height = Math.max(cursorY - LANE_GAP, MARGIN) + MARGIN;
  const regions: LayoutRegion[] = [];
  lanes.forEach((lane) => {
    regions.push({ id: lane.id, kind: 'lane', label: lane.label, labelLines: wrapLabel(lane.label, LANE_LABEL_CHARACTERS, 4), x: 0, y: lane.y, width, height: lane.height });
    lane.columns.forEach((column) => {
      const event = column.event;
      const region: LayoutRegion = {
        id: column.id, kind: 'column', label: event ? event.label : NO_EVENT_ARM, labelLines: columnLines.get(column.id),
        x: column.centerX - columnWidth(column) / 2, y: lane.y, width: columnWidth(column), height: lane.height,
      };
      const sublabel = event ? formatSublabel(event) : undefined;
      if (sublabel !== undefined) region.sublabel = sublabel;
      if (event) region.repeating = event.repeating;
      // at event level an expanded event is a group named after it: its column is that group's box
      const eventGroupIndex = event && view.level === 'event' ? view.groups.findIndex((group) => group.id === event.id) : -1;
      if (eventGroupIndex >= 0) region.groupIndex = eventGroupIndex;
      regions.push(region);
      column.nodes
        .slice()
        .sort((first, second) => (column.topById.get(first.id) as number) - (column.topById.get(second.id) as number))
        .forEach((node) => {
          const subColumn = column.subColumnById.get(node.id) as number;
          const placed: LayoutNode = {
            id: node.id, x: column.centerX - columnWidth(column) / 2 + (COLUMN_PITCH - NODE_WIDTH) / 2 + subColumn * COLUMN_PITCH,
            y: lane.y + (column.topById.get(node.id) as number),
            width: NODE_WIDTH, height: NODE_HEIGHT,
          };
          nodes.push(placed);
          nodeById.set(node.id, placed);
          nodeColumn.set(node.id, column);
        });
    });
  });

  clusterGroups.forEach((group) => {
    const members = group.nodes.map((id) => nodeById.get(id)).filter((member): member is LayoutNode => member !== undefined);
    // one box per sub-column (of each column) the group's nodes landed in
    const membersByColumn = new Map<string, { column: ColumnPlan; subColumn: number; members: LayoutNode[] }>();
    members.forEach((member) => {
      const column = nodeColumn.get(member.id) as ColumnPlan;
      const subColumn = column.subColumnById.get(member.id) as number;
      const key = `${column.id}\u0000${subColumn}`;
      const entry = membersByColumn.get(key);
      if (entry) entry.members.push(member); else membersByColumn.set(key, { column, subColumn, members: [member] });
    });
    const boxCount = membersByColumn.size;
    membersByColumn.forEach(({ column, subColumn, members: columnMembers }) => {
      const left = Math.min(...columnMembers.map((member) => member.x)) - CLUSTER_SIDE;
      const top = Math.min(...columnMembers.map((member) => member.y)) - CLUSTER_TOP;
      const right = Math.max(...columnMembers.map((member) => member.x + member.width)) + CLUSTER_SIDE;
      const bottom = Math.max(...columnMembers.map((member) => member.y + member.height)) + CLUSTER_BOTTOM;
      regions.push({
        id: boxCount > 1 ? `cluster:${group.id}:${column.id}${column.subColumns > 1 ? `:${subColumn}` : ''}` : `cluster:${group.id}`, kind: 'cluster', groupIndex: view.groups.indexOf(group),
        label: group.label, labelLines: wrapLabel(group.label, CLUSTER_LABEL_CHARACTERS, 1), x: left, y: top, width: right - left, height: bottom - top,
      });
    });
  });

  const edges: LayoutEdge[] = [];
  const edgeKeys = new Set(view.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
  const grid = buildNodeGrid(nodes);
  // the labelled top strip of every form box: a soft obstacle for gutter channels
  const headerGrid = buildNodeGrid(regions.filter((region) => region.kind === 'cluster')
    .map((region) => ({ id: region.id, x: region.x, y: region.y, width: region.width, height: CLUSTER_TOP })));
  const noneIgnored = new Set<string>();
  view.edges.forEach((edge: ViewEdge) => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (!source || !target) return;
    // "backward" is about time (an earlier event), the route's direction is about where the two boxes are: side by side
    // (including neighbouring sub-columns of one column), or overlapping in x, which runs vertically.
    const backward = nodeColumn.get(edge.to)!.centerX < nodeColumn.get(edge.from)!.centerX;
    const leftward = target.x + target.width <= source.x;
    const rightward = target.x >= source.x + source.width;
    const middleY = (node: LayoutNode): number => node.y + node.height / 2;
    const ignored = new Set([edge.from, edge.to]);
    const candidates: Curve[] = [];
    // A reciprocal same-column pair would otherwise overlap exactly, so each direction is nudged to its own side of the centre line.
    const reciprocal = edgeKeys.has(`${edge.to}\u0000${edge.from}`);
    const sameXNudge = reciprocal ? (edge.from < edge.to ? -RECIPROCAL_NUDGE : RECIPROCAL_NUDGE) : 0;
    if (leftward) {
      const start = { x: source.x, y: middleY(source) };
      const end = { x: target.x + target.width, y: middleY(target) };
      const reach = Math.abs(start.x - end.x) / 2;
      ROUTE_OFFSETS.forEach((offset) => {
        const bowY = Math.max(start.y, end.y) + BACKWARD_BOW + Math.abs(offset);
        candidates.push([start, { x: start.x - reach, y: bowY }, { x: end.x + reach, y: bowY }, end]);
      });
    } else if (rightward) {
      const start = { x: source.x + source.width, y: middleY(source) };
      const end = { x: target.x, y: middleY(target) };
      const reach = (end.x - start.x) / 2;
      ROUTE_OFFSETS.forEach((offset) => {
        candidates.push([start, { x: start.x + reach, y: start.y + offset }, { x: end.x - reach, y: end.y + offset }, end]);
      });
    } else {
      // Same x (same column, or equal-day columns of different lanes): straight between top and bottom edges when nothing is in
      // the way, otherwise attached to the side edges and bowed out, so it never has to cross the gap between stacked nodes.
      const downward = target.y >= source.y;
      const nudge = sameXNudge;
      const start = { x: source.x + source.width / 2 + nudge, y: downward ? source.y + source.height : source.y };
      const end = { x: target.x + target.width / 2 + nudge, y: downward ? target.y : target.y + target.height };
      const reach = (end.y - start.y) / 2;
      candidates.push([start, { x: start.x, y: start.y + reach }, { x: end.x, y: end.y - reach }, end]);
      SIDE_BOWS.forEach((bow) => {
        const sideStart = { x: bow > 0 ? source.x + source.width : source.x, y: middleY(source) };
        const sideEnd = { x: bow > 0 ? target.x + target.width : target.x, y: middleY(target) };
        candidates.push([sideStart, { x: sideStart.x + bow, y: sideStart.y }, { x: sideEnd.x + bow, y: sideEnd.y }, sideEnd]);
      });
    }
    // The curves are prettier: the first that clears every node wins. When none does, gutter polylines are tried; the first that
    // clears every node and every form-box header wins, then the first that clears every node; else the route with the fewest hits.
    const clearCurve = candidates.find((candidate) => !curveHitsNode(candidate, grid, ignored));
    if (clearCurve) { edges.push({ from: edge.from, to: edge.to, curve: clearCurve, backward }); return; }
    let best: { curve?: Curve; points?: Point[]; hits: number } = { curve: candidates[0], hits: Infinity };
    candidates.forEach((candidate) => {
      const hits = curveHitIds(candidate, grid, ignored).size;
      if (hits < best.hits) best = { curve: candidate, hits };
    });
    let clearOfNodes: Point[] | undefined;
    let clear: Point[] | undefined;
    for (const route of gutterRoutes(source, target, leftward, rightward, sameXNudge)) {
      const hits = polylineHitIds(route, grid, ignored).size;
      if (hits < best.hits) best = { points: route, hits };
      if (hits > 0) continue;
      clearOfNodes ??= route;
      if (polylineHitIds(route, headerGrid, noneIgnored).size === 0) { clear = route; break; }
    }
    const chosenPoints = clear ?? clearOfNodes;
    if (chosenPoints) edges.push({ from: edge.from, to: edge.to, points: chosenPoints, backward });
    else if (best.points) edges.push({ from: edge.from, to: edge.to, points: best.points, backward });
    else edges.push({ from: edge.from, to: edge.to, curve: best.curve, backward });
  });

  // The drawing must contain every route: a bow or channel can leave the columns' extent. Anything left of or above the origin
  // shifts everything right or down; anything beyond the right or bottom edge grows the layout.
  let routeLeft = Infinity, routeTop = Infinity, routeRight = -Infinity, routeBottom = -Infinity;
  const include = (point: Point): void => {
    routeLeft = Math.min(routeLeft, point.x); routeRight = Math.max(routeRight, point.x);
    routeTop = Math.min(routeTop, point.y); routeBottom = Math.max(routeBottom, point.y);
  };
  edges.forEach((edge) => {
    if (edge.curve) for (let step = 0; step <= CURVE_SAMPLES; step++) include(curvePoint(edge.curve, step / CURVE_SAMPLES));
    edge.points?.forEach(include);
  });
  let totalWidth = width;
  let totalHeight = height;
  const shiftX = routeLeft - ARROW_MARGIN < 0 ? ARROW_MARGIN - routeLeft : 0;
  const shiftY = routeTop - ARROW_MARGIN < 0 ? ARROW_MARGIN - routeTop : 0;
  if (shiftX > 0 || shiftY > 0) {
    const moved = (point: Point): Point => ({ x: point.x + shiftX, y: point.y + shiftY });
    nodes.forEach((placed) => { placed.x += shiftX; placed.y += shiftY; });
    edges.forEach((edge) => {
      if (edge.curve) edge.curve = edge.curve.map(moved) as Curve;
      if (edge.points) edge.points = edge.points.map(moved);
    });
    regions.forEach((region) => {
      if (region.kind !== 'lane') region.x += shiftX;
      region.y += shiftY;
    });
    totalWidth += shiftX; totalHeight += shiftY; routeRight += shiftX; routeBottom += shiftY;
  }
  if (routeRight + ARROW_MARGIN > totalWidth) totalWidth = routeRight + MARGIN;
  if (routeBottom + ARROW_MARGIN > totalHeight) totalHeight = routeBottom + MARGIN;
  regions.forEach((region) => { if (region.kind === 'lane') region.width = totalWidth; });

  return { width: totalWidth, height: totalHeight, nodes, edges, regions };
}
