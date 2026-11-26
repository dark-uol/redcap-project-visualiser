/* Swimlane layout of the form-instance view: one lane per arm, one column per event, time running left to right.
 * Edges are right-angle polylines routed through the gutters and gaps between the nodes (see swimlaneRouting.ts); where more
 * edges run side by side than a gutter, gap, footer or node side holds, it grows.
 * Pure and deterministic; no Solid, no DOM. */
import type { EventDef, View, ViewNode } from './types';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion, Point } from './layout';
import { NODE_BOX_WIDTH, nodeBoxHeight, nodeBoxHeightWithPorts, type NodeBoxOptions } from './nodeBox';
import {
  BAND_MARGIN, GAP_MARGIN, SIDE_CLEARANCE, TRACK_SPACING, assignTracks, isGrowthEmpty, routeChannels,
  type ChannelGeometry, type ChannelStructure, type Growth, type RoutedEdge,
} from './swimlaneRouting';

const NODE_WIDTH = NODE_BOX_WIDTH;
const NODE_GAP = 18;
const COLUMN_GAP = 40;
const COLUMN_PITCH = NODE_WIDTH + COLUMN_GAP;
/** Free width of a gutter before it grows: the column gap less the clearance beside the nodes on both sides. */
const BASE_GUTTER_FREE = COLUMN_GAP - 2 * SIDE_CLEARANCE;
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
const FIRST_CENTER = MARGIN + LANE_LABEL_WIDTH + COLUMN_PITCH / 2;
const NO_EVENT_ARM = '(no event)';
/** Rounds of growing what did not fit and assigning the tracks again. */
const MAX_GROWTH_ROUNDS = 25;
/** An event column holds at most this many stacked nodes; more flow into side-by-side sub-columns, so a big project
 * stays a sensible height. */
export const MAX_COLUMN_ROWS = 25;

interface ColumnPlan {
  id: string;
  event?: EventDef;
  nodes: ViewNode[];
  /** Centre of the column's sub-columns (without the extra width of its outer gutters). */
  centerX: number;
  /** Number of side-by-side sub-columns, each COLUMN_PITCH wide plus the extra width of the gutters between them. */
  subColumns: number;
  /** Stacked nodes per sub-column (the last may hold fewer). */
  rowsPerSubColumn: number;
  /** Node ids of every sub-column, top to bottom. */
  stacks: string[][];
  /** Top-left y of each node, relative to the lane's top, by node id. */
  topById: Map<string, number>;
  /** Index of the sub-column each node sits in, by node id. */
  subColumnById: Map<string, number>;
  /** Height of the tallest sub-column's stacked nodes, including cluster padding. */
  contentHeight: number;
  /** Extra width of the gutter right of every sub-column but the last. */
  innerGutterExtra: number[];
  /** Extra width of the gutter left of the column (the first of its lane only) and right of it. */
  leftExtra: number;
  rightExtra: number;
  /** Per sub-column, extra height of each gap: index i > 0 is the gap above its i-th node, the stack length the space below
   * the last node. */
  gapExtra: number[][];
  /** Per sub-column, the space of each gap relative to the lane's top, same indexes (the space below the last node starts
   * at `top`; its bottom is the lane's content bottom). */
  gapRanges: { top: number; bottom: number }[][];
}

const newColumnPlan = (id: string, nodes: ViewNode[], event?: EventDef): ColumnPlan => {
  const subColumns = Math.max(1, Math.ceil(nodes.length / MAX_COLUMN_ROWS));
  return {
    id, event, nodes, centerX: 0, subColumns, rowsPerSubColumn: Math.max(1, Math.ceil(nodes.length / subColumns)),
    stacks: [], topById: new Map(), subColumnById: new Map(), contentHeight: 0,
    innerGutterExtra: new Array(subColumns - 1).fill(0), leftExtra: 0, rightExtra: 0, gapExtra: [], gapRanges: [],
  };
};

/** Width of the sub-columns and the gutters between them. */
const coreWidth = (column: ColumnPlan): number =>
  column.subColumns * COLUMN_PITCH + column.innerGutterExtra.reduce((sum, extra) => sum + extra, 0);
const leftReach = (column: ColumnPlan): number => coreWidth(column) / 2 + column.leftExtra;
const rightReach = (column: ColumnPlan): number => coreWidth(column) / 2 + column.rightExtra;
/** Left x of the nodes of a sub-column. */
const subColumnLeft = (column: ColumnPlan, subColumn: number): number => {
  let left = column.centerX - coreWidth(column) / 2 + COLUMN_GAP / 2 + subColumn * COLUMN_PITCH;
  for (let index = 0; index < subColumn; index++) left += column.innerGutterExtra[index];
  return left;
};

interface LanePlan {
  id: string;
  label: string;
  columns: ColumnPlan[];
  y: number;
  height: number;
  /** y of the bottom of the lowest node (or form box); the footer band below it carries routes. */
  contentBottom: number;
  /** Extra height of the footer band. */
  bandExtra: number;
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

/** Assigns each drawn event column a centre x: scaled by day when every event has one, else by order; then keeps columns apart.
 * A column reaches `leftReach` left and `rightReach` right of its centre (one pitch per sub-column, plus any grown gutters) and
 * is centred on its desired x, but never starts left of the first column's left edge and never overlaps what precedes it: it
 * is pushed right until its left edge clears the right edge of the previous column, or, when columns share an x (equal days in
 * different arms), of the widest column in that shared group. */
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
    const left = leftReach(column);
    const desired = timed
      ? firstCenter + ((column.event!.dayOffset as number) - firstDay) * pixelsPerDay
      : firstCenter + index * COLUMN_PITCH;
    const arm = column.event!.arm;
    const sameDay = timed && previous !== undefined && previous.event!.dayOffset === column.event!.dayOffset;
    // what the column's own lane already holds: a wide column sharing an x must still start right of its own lane's last column
    const ownLaneClearance = (armRight.get(arm) ?? firstLeft) + left;
    if (previous && sameDay && !sharedArms.has(arm)) {
      // Equal days in different arms may share an x: their lanes keep them apart.
      column.centerX = Math.max(previous.centerX, firstLeft + left, ownLaneClearance);
      sharedArms.add(arm);
      groupRight = Math.max(groupRight, column.centerX + rightReach(column));
    } else {
      column.centerX = Math.max(desired, firstLeft + left, previous ? groupRight + left : 0);
      sharedArms = new Set([arm]);
      groupRight = column.centerX + rightReach(column);
    }
    armRight.set(arm, column.centerX + rightReach(column));
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

/** Stacks every sub-column of the column from the header down: nodes NODE_GAP apart (plus any grown gap), a form box's
 * padding around the fields of one cluster. Each sub-column starts again at the header, and a form box cut by a sub-column
 * boundary is closed and reopened (CLUSTER_TOP again). Records the tops, the gaps and the content height. */
const stackColumn = (column: ColumnPlan, headerHeight: number, heightById: Map<string, number>, clusterOf: Map<string, string>): void => {
  let tallest = 0;
  column.gapRanges = column.stacks.map((ids, subColumn) => {
    const extra = column.gapExtra[subColumn];
    const ranges: { top: number; bottom: number }[] = [];
    let top = headerHeight;
    let previousCluster: string | undefined;
    let previousBottom = headerHeight;
    ids.forEach((id, position) => {
      const cluster = clusterOf.get(id);
      const closes = previousCluster !== undefined && previousCluster !== cluster;
      const opens = cluster !== undefined && cluster !== previousCluster;
      if (position > 0) top += NODE_GAP + extra[position];
      if (closes) top += CLUSTER_BOTTOM;
      if (opens) top += CLUSTER_TOP;
      if (position > 0) ranges[position] = { top: previousBottom + (closes ? CLUSTER_BOTTOM : 0), bottom: top - (opens ? CLUSTER_TOP : 0) };
      column.topById.set(id, top);
      column.subColumnById.set(id, subColumn);
      top += heightById.get(id) as number;
      previousBottom = top;
      previousCluster = cluster;
    });
    const end = ids.length ? top + (previousCluster ? CLUSTER_BOTTOM : 0) : headerHeight;
    ranges[ids.length] = { top: end, bottom: end + extra[ids.length] };
    if (ids.length) tallest = Math.max(tallest, end + extra[ids.length] - headerHeight);
    return ranges;
  });
  column.contentHeight = tallest;
};

/** One barycentre sweep left to right: order by the mean y of already-placed neighbours in earlier columns of the lane.
 * The fields of a zoomed-in form stay together, ordered as one unit. Fills column-major: the sorted nodes run down the first
 * sub-column, then the next, so a form's fields stay contiguous. */
const orderLane = (
  lane: LanePlan, neighbours: Map<string, string[]>, viewOrder: Map<string, number>, headerHeight: number, clusterOf: Map<string, string>,
  heightById: Map<string, number>,
): void => {
  const placedTop = new Map<string, number>();
  lane.columns.forEach((column) => {
    const initial = initialOrder(column, viewOrder);
    // a wrapped column is that many times shorter, so an unconnected node's slot (the height of the nodes before it) is scaled to its row
    let heightBefore = 0;
    const keyed = initial.map((node, slot) => {
      const tops = (neighbours.get(node.id) ?? []).filter((id) => placedTop.has(id)).map((id) => placedTop.get(id) as number);
      const barycentre = tops.length ? tops.reduce((sum, top) => sum + top, 0) / tops.length : heightBefore / column.subColumns;
      heightBefore += (heightById.get(node.id) as number) + NODE_GAP;
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
    column.stacks = Array.from({ length: column.subColumns }, () => []);
    keyed.forEach(({ node }, position) => column.stacks[Math.floor(position / column.rowsPerSubColumn)].push(node.id));
    column.gapExtra = column.stacks.map((ids) => new Array(ids.length + 1).fill(0));
    stackColumn(column, headerHeight, heightById, clusterOf);
    column.topById.forEach((top, id) => placedTop.set(id, top));
  });
};

export type Curve = [Point, Point, Point, Point];

const ARROW_MARGIN = 10;

/** The shift that brings every route at least ARROW_MARGIN inside the origin: right for a route left of it, down for one above. */
export const originShift = (routeLeft: number, routeTop: number): Point => ({
  x: routeLeft - ARROW_MARGIN < 0 ? ARROW_MARGIN - routeLeft : 0,
  y: routeTop - ARROW_MARGIN < 0 ? ARROW_MARGIN - routeTop : 0,
});

/** Moves nodes, routes and regions by `shift`. A lane spans the whole width, so it moves down only. */
export const shiftLayoutContents = (
  contents: { nodes: LayoutNode[]; edges: LayoutEdge[]; regions: LayoutRegion[] }, shift: Point,
): void => {
  const moved = (point: Point): Point => ({ x: point.x + shift.x, y: point.y + shift.y });
  contents.nodes.forEach((placed) => { placed.x += shift.x; placed.y += shift.y; });
  contents.edges.forEach((edge) => {
    if (edge.curve) edge.curve = edge.curve.map(moved) as Curve;
    if (edge.points) edge.points = edge.points.map(moved);
  });
  contents.regions.forEach((region) => {
    if (region.kind !== 'lane') region.x += shift.x;
    region.y += shift.y;
  });
};

/** What a gutter's extra width belongs to: the left of a lane's first column, the right of a column, or a gutter inside one. */
interface GutterOwner { column: ColumnPlan; kind: 'left' | 'right' | 'inner'; subColumn: number }

export function layoutSwimlane(view: View, events: EventDef[], options: NodeBoxOptions = {}): Layout {
  const viewNodeById = new Map(view.nodes.map((viewNode) => [viewNode.id, viewNode] as const));
  const heightById = new Map(view.nodes.map((viewNode) => [viewNode.id, nodeBoxHeight(viewNode, options)] as const));
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
  const newLane = (id: string, label: string): LanePlan => ({ id, label, columns: [], y: 0, height: 0, contentBottom: 0, bandExtra: 0 });
  columns.forEach((column) => {
    const event = column.event!;
    let lane = laneByArm.get(event.arm);
    if (!lane) {
      lane = newLane(`lane:${event.arm}`, `Arm ${event.arm}: ${event.armName}`);
      laneByArm.set(event.arm, lane);
      lanes.push(lane);
    }
    lane.columns.push(column);
  });
  let noEventColumn: ColumnPlan | undefined;
  if (unplaced.length) {
    noEventColumn = newColumnPlan(`column:${NO_EVENT_ARM}`, unplaced);
    const lane = newLane(`lane:${NO_EVENT_ARM}`, NO_EVENT_ARM);
    lane.columns.push(noEventColumn);
    lanes.push(lane);
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

  lanes.forEach((lane) => orderLane(lane, neighbours, viewOrder, headerHeight, clusterOf, heightById));

  // Placement for the current sizes: lanes top to bottom, columns left to right, every node at its stacked top.
  const nodeById = new Map<string, LayoutNode>();
  const nodeColumn = new Map<string, ColumnPlan>();
  let contentEnd = MARGIN;
  const place = (): void => {
    let cursorY = MARGIN;
    lanes.forEach((lane) => {
      lane.columns.forEach((column) => stackColumn(column, headerHeight, heightById, clusterOf));
      const tallest = Math.max(...lane.columns.map((column) => column.contentHeight));
      lane.y = cursorY;
      lane.contentBottom = lane.y + headerHeight + tallest;
      lane.height = headerHeight + tallest + LANE_FOOTER + lane.bandExtra;
      cursorY += lane.height + LANE_GAP;
    });
    contentEnd = cursorY;
    placeColumns(columns);
    // left-aligned with the first event column
    if (noEventColumn) noEventColumn.centerX = FIRST_CENTER - COLUMN_PITCH / 2 + leftReach(noEventColumn);
    lanes.forEach((lane) => lane.columns.forEach((column) => column.stacks.forEach((ids, subColumn) => ids.forEach((id) => {
      const placed: LayoutNode = {
        id, x: subColumnLeft(column, subColumn), y: lane.y + (column.topById.get(id) as number), width: NODE_WIDTH, height: heightById.get(id) as number,
      };
      nodeById.set(id, placed);
      nodeColumn.set(id, column);
    }))));
  };
  place();

  // Edges whose two ends are laid out, routed through the channels.
  const routedNodeIds: string[] = [];
  const nodeIndexById = new Map<string, number>();
  const structure: ChannelStructure = { channelLane: [], gaps: [], bands: [], nodeChannels: [], nodeParity: [], gapParity: [] };
  const gutterOwners: GutterOwner[] = [];
  const gapOwners: { lane: LanePlan; column: ColumnPlan; subColumn: number; position: number }[] = [];
  const laneEntries = lanes.map((lane) => lane.columns.flatMap((column) => column.stacks.map((_, subColumn) => ({ column, subColumn }))));
  const laneChannels: number[][] = [];
  lanes.forEach((lane, laneIndex) => {
    const entries = laneEntries[laneIndex];
    const start = structure.channelLane.length;
    laneChannels.push(entries.map((_, index) => start + index).concat(start + entries.length));
    for (let index = 0; index <= entries.length; index++) {
      structure.channelLane.push(laneIndex);
      if (index === 0) gutterOwners.push({ column: entries[0].column, kind: 'left', subColumn: 0 });
      else if (index < entries.length && entries[index - 1].column === entries[index].column) {
        gutterOwners.push({ column: entries[index].column, kind: 'inner', subColumn: entries[index - 1].subColumn });
      } else gutterOwners.push({ column: entries[index - 1].column, kind: 'right', subColumn: 0 });
    }
    entries.forEach(({ column, subColumn }, entryIndex) => {
      const channels = { left: start + entryIndex, right: start + entryIndex + 1 };
      const ids = column.stacks[subColumn];
      ids.forEach((id) => {
        nodeIndexById.set(id, routedNodeIds.length);
        routedNodeIds.push(id);
        structure.nodeChannels.push(channels);
        structure.nodeParity.push(entryIndex % 2);
      });
      for (let position = 1; position <= ids.length; position++) {
        structure.gaps.push(channels);
        structure.gapParity.push(entryIndex % 2);
        gapOwners.push({ lane, column, subColumn, position });
      }
    });
  });
  lanes.forEach((_, laneIndex) => structure.bands.push({ above: laneChannels[laneIndex], below: laneChannels[laneIndex + 1] ?? [] }));

  const channelGeometry = (): ChannelGeometry => {
    const entryBounds = laneEntries.map((entries) => entries.map(({ column, subColumn }) => subColumnLeft(column, subColumn)));
    const channels: ChannelGeometry['channels'] = [];
    laneEntries.forEach((entries, laneIndex) => {
      const lefts = entryBounds[laneIndex];
      for (let index = 0; index <= entries.length; index++) {
        if (index === 0) {
          const right = lefts[0] - SIDE_CLEARANCE;
          channels.push({ left: right - BASE_GUTTER_FREE - entries[0].column.leftExtra, right });
        } else if (index === entries.length) {
          const left = lefts[index - 1] + NODE_WIDTH + SIDE_CLEARANCE;
          channels.push({ left, right: left + BASE_GUTTER_FREE + entries[index - 1].column.rightExtra });
        } else channels.push({ left: lefts[index - 1] + NODE_WIDTH + SIDE_CLEARANCE, right: lefts[index] - SIDE_CLEARANCE });
      }
    });
    const gaps = gapOwners.map(({ lane, column, subColumn, position }) => {
      const range = column.gapRanges[subColumn][position];
      const isBelowLast = position === column.stacks[subColumn].length;
      return {
        top: lane.y + range.top + GAP_MARGIN,
        bottom: isBelowLast ? lane.contentBottom + BAND_MARGIN - TRACK_SPACING : lane.y + range.bottom - GAP_MARGIN,
      };
    });
    const bands = lanes.map((lane) => ({ top: lane.contentBottom + BAND_MARGIN, bottom: lane.y + lane.height - BAND_MARGIN }));
    return { channels, gaps, bands, nodes: routedNodeIds.map((id) => nodeById.get(id) as LayoutNode) };
  };

  const routedViewEdges = view.edges.filter((edge) => nodeIndexById.has(edge.from) && nodeIndexById.has(edge.to));
  const routedEdges: RoutedEdge[] = routedViewEdges.map((edge) => ({ source: nodeIndexById.get(edge.from) as number, target: nodeIndexById.get(edge.to) as number }));
  let routePoints: Point[][] = [];
  if (routedEdges.length) {
    const routes = routeChannels(structure, channelGeometry(), routedEdges);
    // every node tall enough for the ports on its busiest side
    const portsBySide = new Map<string, number>();
    const countPort = (nodeIndex: number, side: string): void => {
      const key = `${nodeIndex}:${side}`;
      portsBySide.set(key, (portsBySide.get(key) ?? 0) + 1);
    };
    routes.forEach((route, edgeIndex) => {
      countPort(routedEdges[edgeIndex].source, route.sourceSide);
      countPort(routedEdges[edgeIndex].target, route.targetSide);
    });
    routedNodeIds.forEach((id, nodeIndex) => {
      const ports = Math.max(portsBySide.get(`${nodeIndex}:left`) ?? 0, portsBySide.get(`${nodeIndex}:right`) ?? 0);
      heightById.set(id, nodeBoxHeightWithPorts(viewNodeById.get(id) as ViewNode, options, ports));
    });
    const grow = (growth: Growth): void => {
      growth.nodes.forEach((amount, nodeIndex) => {
        const id = routedNodeIds[nodeIndex];
        heightById.set(id, (heightById.get(id) as number) + amount);
      });
      growth.gaps.forEach((amount, gapIndex) => {
        const { lane, column, subColumn, position } = gapOwners[gapIndex];
        const extras = column.gapExtra[subColumn];
        if (position < column.stacks[subColumn].length) extras[position] += amount;
        else {
          // the space below the last node reaches down to the lane's content bottom: grow past it
          const range = column.gapRanges[subColumn][position];
          extras[position] = Math.max(extras[position], lane.contentBottom - lane.y - range.top + amount);
        }
      });
      growth.bands.forEach((amount, bandIndex) => { lanes[bandIndex].bandExtra += amount; });
      growth.channels.forEach((freeWidth, channel) => {
        const owner = gutterOwners[channel];
        const extra = Math.max(0, freeWidth - BASE_GUTTER_FREE);
        if (owner.kind === 'inner') owner.column.innerGutterExtra[owner.subColumn] = Math.max(owner.column.innerGutterExtra[owner.subColumn], extra);
        else if (owner.kind === 'left') owner.column.leftExtra = Math.max(owner.column.leftExtra, extra);
        else owner.column.rightExtra = Math.max(owner.column.rightExtra, extra);
      });
    };
    for (let round = 0; ; round++) {
      place();
      const assigned = assignTracks(structure, channelGeometry(), routedEdges, routes);
      routePoints = assigned.points;
      if (isGrowthEmpty(assigned.growth) || round === MAX_GROWTH_ROUNDS) break;
      grow(assigned.growth);
    }
  }

  // Nodes, regions.
  const nodes: LayoutNode[] = [];
  const maxRight = Math.max(FIRST_CENTER + COLUMN_PITCH / 2, ...lanes.flatMap((lane) => lane.columns.map((column) => column.centerX + rightReach(column))));
  const width = maxRight + MARGIN;
  const height = Math.max(contentEnd - LANE_GAP, MARGIN) + MARGIN;
  const regions: LayoutRegion[] = [];
  lanes.forEach((lane) => {
    regions.push({ id: lane.id, kind: 'lane', label: lane.label, labelLines: wrapLabel(lane.label, LANE_LABEL_CHARACTERS, 4), x: 0, y: lane.y, width, height: lane.height });
    lane.columns.forEach((column) => {
      const event = column.event;
      const region: LayoutRegion = {
        id: column.id, kind: 'column', label: event ? event.label : NO_EVENT_ARM, labelLines: columnLines.get(column.id),
        x: column.centerX - leftReach(column), y: lane.y, width: leftReach(column) + rightReach(column), height: lane.height,
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
        .forEach((node) => nodes.push(nodeById.get(node.id) as LayoutNode));
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

  // "backward" is about time: the target sits in an earlier event column than the source.
  const edges: LayoutEdge[] = routedViewEdges.map((edge, edgeIndex) => ({
    from: edge.from, to: edge.to, points: routePoints[edgeIndex],
    backward: (nodeColumn.get(edge.to) as ColumnPlan).centerX < (nodeColumn.get(edge.from) as ColumnPlan).centerX,
  }));

  // The drawing must contain every route: a gutter can leave the columns' extent. Anything left of or above the origin
  // shifts everything right or down; anything beyond the right or bottom edge grows the layout.
  let routeLeft = Infinity, routeTop = Infinity, routeRight = -Infinity, routeBottom = -Infinity;
  edges.forEach((edge) => edge.points?.forEach((point) => {
    routeLeft = Math.min(routeLeft, point.x); routeRight = Math.max(routeRight, point.x);
    routeTop = Math.min(routeTop, point.y); routeBottom = Math.max(routeBottom, point.y);
  }));
  let totalWidth = width;
  let totalHeight = height;
  const shift = originShift(routeLeft, routeTop);
  if (shift.x > 0 || shift.y > 0) {
    shiftLayoutContents({ nodes, edges, regions }, shift);
    totalWidth += shift.x; totalHeight += shift.y; routeRight += shift.x; routeBottom += shift.y;
  }
  if (routeRight + ARROW_MARGIN > totalWidth) totalWidth = routeRight + MARGIN;
  if (routeBottom + ARROW_MARGIN > totalHeight) totalHeight = routeBottom + MARGIN;
  regions.forEach((region) => { if (region.kind === 'lane') region.width = totalWidth; });

  return { width: totalWidth, height: totalHeight, nodes, edges, regions };
}
