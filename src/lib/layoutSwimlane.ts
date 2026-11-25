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
const MARGIN = 20;
const LANE_LABEL_WIDTH = 120;
const LANE_HEADER = 40;
const LANE_FOOTER = 30;
const LANE_GAP = 20;
const BACKWARD_BOW = 40;
const FIRST_CENTER = MARGIN + LANE_LABEL_WIDTH + COLUMN_PITCH / 2;
const NO_EVENT_ARM = '(no event)';

interface ColumnPlan {
  id: string;
  event?: EventDef;
  nodes: ViewNode[];
  centerX: number;
  /** Top-left y of each node, relative to the lane's top, by node id. */
  topById: Map<string, number>;
}

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

const stackHeight = (count: number): number => (count === 0 ? 0 : count * NODE_HEIGHT + (count - 1) * NODE_GAP);

/** Assigns each drawn event column a centre x: scaled by day when every event has one, else by order; then enforces the pitch. */
const placeColumns = (columns: ColumnPlan[]): void => {
  const timed = columns.length > 0 && columns.every((column) => column.event?.dayOffset !== undefined);
  if (timed) {
    // Stable sort: events with equal days keep their order in `events`.
    columns.sort((first, second) => (first.event!.dayOffset as number) - (second.event!.dayOffset as number));
  }
  const firstCenter = FIRST_CENTER;
  const firstDay = timed ? (columns[0].event!.dayOffset as number) : 0;
  let previous: ColumnPlan | undefined;
  let sharedArms = new Set<string>();
  columns.forEach((column, index) => {
    const desired = timed
      ? firstCenter + ((column.event!.dayOffset as number) - firstDay) * PIXELS_PER_DAY
      : firstCenter + index * COLUMN_PITCH;
    const arm = column.event!.arm;
    const sameDay = timed && previous !== undefined && previous.event!.dayOffset === column.event!.dayOffset;
    if (previous && sameDay && !sharedArms.has(arm)) {
      // Equal days in different arms may share an x: their lanes keep them apart.
      column.centerX = previous.centerX;
      sharedArms.add(arm);
    } else {
      column.centerX = previous ? Math.max(desired, previous.centerX + COLUMN_PITCH) : desired;
      sharedArms = new Set([arm]);
    }
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

/** One barycentre sweep left to right: order by the mean y of already-placed neighbours in earlier columns of the lane. */
const orderLane = (lane: LanePlan, neighbours: Map<string, string[]>, viewOrder: Map<string, number>): void => {
  const placedTop = new Map<string, number>();
  lane.columns.forEach((column) => {
    const initial = initialOrder(column, viewOrder);
    const keyed = initial.map((node, slot) => {
      const tops = (neighbours.get(node.id) ?? []).filter((id) => placedTop.has(id)).map((id) => placedTop.get(id) as number);
      const barycentre = tops.length ? tops.reduce((sum, top) => sum + top, 0) / tops.length : slot * (NODE_HEIGHT + NODE_GAP);
      return { node, slot, barycentre };
    });
    keyed.sort((first, second) => first.barycentre - second.barycentre || first.slot - second.slot);
    keyed.forEach(({ node }, position) => {
      const top = LANE_HEADER + position * (NODE_HEIGHT + NODE_GAP);
      column.topById.set(node.id, top);
      placedTop.set(node.id, top);
    });
  });
};

type Curve = [Point, Point, Point, Point];
/** Vertical shifts tried, in order, for a left-to-right or backward edge until one clears every other node. */
const ROUTE_OFFSETS = [0, -40, 40, -80, 80, -120, 120];
/** Horizontal bows tried, in order, for a same-column edge that cannot run straight. */
const SIDE_BOWS = [70, -70, 110, -110, 160, -160];
const NODE_CLEARANCE = 4;
const RECIPROCAL_NUDGE = 8;

const curvePoint = (curve: Curve, t: number): Point => {
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: curve.reduce((sum, point, index) => sum + point.x * weights[index], 0),
    y: curve.reduce((sum, point, index) => sum + point.y * weights[index], 0),
  };
};

/** Whether the curve passes through any node other than the ignored ones (its own endpoints). */
const curveHitsNode = (curve: Curve, nodes: LayoutNode[], ignored: Set<string>): boolean => {
  const steps = 32;
  for (let step = 1; step < steps; step++) {
    const point = curvePoint(curve, step / steps);
    const hit = nodes.some((node) => !ignored.has(node.id)
      && point.x > node.x - NODE_CLEARANCE && point.x < node.x + node.width + NODE_CLEARANCE
      && point.y > node.y - NODE_CLEARANCE && point.y < node.y + node.height + NODE_CLEARANCE);
    if (hit) return true;
  }
  return false;
};

export function layoutSwimlane(view: View, events: EventDef[]): Layout {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const viewOrder = new Map(view.nodes.map((node, index) => [node.id, index]));

  // Group the nodes by event; unknown or missing events go to the "(no event)" bucket.
  const nodesByEvent = new Map<string, ViewNode[]>();
  const unplaced: ViewNode[] = [];
  view.nodes.forEach((node) => {
    const event = node.event ? eventById.get(node.event) : undefined;
    if (!event) { unplaced.push(node); return; }
    const bucket = nodesByEvent.get(event.id);
    if (bucket) bucket.push(node); else nodesByEvent.set(event.id, [node]);
  });

  // Columns in `events` order, only for events with nodes; lanes by first appearance of the arm.
  const columns: ColumnPlan[] = [];
  events.forEach((event) => {
    const nodes = nodesByEvent.get(event.id);
    if (nodes && !columns.some((column) => column.event === event)) {
      columns.push({ id: `column:${event.id}`, event, nodes, centerX: 0, topById: new Map() });
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
    const column: ColumnPlan = { id: `column:${NO_EVENT_ARM}`, nodes: unplaced, centerX: FIRST_CENTER, topById: new Map() };
    lanes.push({ id: `lane:${NO_EVENT_ARM}`, label: NO_EVENT_ARM, columns: [column], y: 0, height: 0 });
  }

  // Undirected neighbours for the barycentre sweep.
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const list = neighbours.get(from);
    if (list) list.push(to); else neighbours.set(from, [to]);
  };
  view.edges.forEach((edge) => { link(edge.from, edge.to); link(edge.to, edge.from); });

  // Vertical placement.
  let cursorY = MARGIN;
  lanes.forEach((lane) => {
    orderLane(lane, neighbours, viewOrder);
    const tallest = Math.max(...lane.columns.map((column) => stackHeight(column.nodes.length)));
    lane.y = cursorY;
    lane.height = LANE_HEADER + tallest + LANE_FOOTER;
    cursorY += lane.height + LANE_GAP;
  });

  // Nodes, regions.
  const nodes: LayoutNode[] = [];
  const nodeColumn = new Map<string, ColumnPlan>();
  const nodeById = new Map<string, LayoutNode>();
  const maxCenterX = Math.max(FIRST_CENTER, ...lanes.flatMap((lane) => lane.columns.map((column) => column.centerX)));
  const width = maxCenterX + COLUMN_PITCH / 2 + MARGIN;
  const height = Math.max(cursorY - LANE_GAP, MARGIN) + MARGIN;
  const regions: LayoutRegion[] = [];
  lanes.forEach((lane) => {
    regions.push({ id: lane.id, kind: 'lane', label: lane.label, x: 0, y: lane.y, width, height: lane.height });
    lane.columns.forEach((column) => {
      const event = column.event;
      const region: LayoutRegion = {
        id: column.id, kind: 'column', label: event ? event.label : NO_EVENT_ARM,
        x: column.centerX - COLUMN_PITCH / 2, y: lane.y, width: COLUMN_PITCH, height: lane.height,
      };
      const sublabel = event ? formatSublabel(event) : undefined;
      if (sublabel !== undefined) region.sublabel = sublabel;
      if (event) region.repeating = event.repeating;
      regions.push(region);
      column.nodes
        .slice()
        .sort((first, second) => (column.topById.get(first.id) as number) - (column.topById.get(second.id) as number))
        .forEach((node) => {
          const placed: LayoutNode = {
            id: node.id, x: column.centerX - NODE_WIDTH / 2, y: lane.y + (column.topById.get(node.id) as number),
            width: NODE_WIDTH, height: NODE_HEIGHT,
          };
          nodes.push(placed);
          nodeById.set(node.id, placed);
          nodeColumn.set(node.id, column);
        });
    });
  });

  const edges: LayoutEdge[] = [];
  const edgeKeys = new Set(view.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
  view.edges.forEach((edge: ViewEdge) => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (!source || !target) return;
    const sourceX = nodeColumn.get(edge.from)!.centerX;
    const targetX = nodeColumn.get(edge.to)!.centerX;
    const backward = targetX < sourceX;
    const middleY = (node: LayoutNode): number => node.y + node.height / 2;
    const ignored = new Set([edge.from, edge.to]);
    const candidates: Curve[] = [];
    if (backward) {
      const start = { x: source.x, y: middleY(source) };
      const end = { x: target.x + target.width, y: middleY(target) };
      const reach = Math.abs(start.x - end.x) / 2;
      ROUTE_OFFSETS.forEach((offset) => {
        const bowY = Math.max(start.y, end.y) + BACKWARD_BOW + Math.abs(offset);
        candidates.push([start, { x: start.x - reach, y: bowY }, { x: end.x + reach, y: bowY }, end]);
      });
    } else if (targetX > sourceX) {
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
      // A reciprocal pair would otherwise overlap exactly, so each direction is nudged to its own side of the centre line.
      const reciprocal = edgeKeys.has(`${edge.to}\u0000${edge.from}`);
      const nudge = reciprocal ? (edge.from < edge.to ? -RECIPROCAL_NUDGE : RECIPROCAL_NUDGE) : 0;
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
    const curve = candidates.find((candidate) => !curveHitsNode(candidate, nodes, ignored)) ?? candidates[0];
    edges.push({ from: edge.from, to: edge.to, curve, backward });
  });

  return { width, height, nodes, edges, regions };
}
