/* Orthogonal channel routing for the swimlane layout. Pure: no Solid, no DOM.
 *
 * The free space of a swimlane drawing is a set of channels:
 * - vertical channels: the gutters beside every (sub-)column of a lane, free of nodes from the lane's header to its footer;
 * - gap channels: the gaps between two stacked nodes of a sub-column (and below its last node), which cross that sub-column;
 * - band channels: the footer strip of each lane, below all its nodes, joining every gutter of that lane and of the next.
 *
 * Every edge leaves its source through a port on the left or right side, runs in vertical channels joined by gap or band
 * channels, and enters its target through a port on a side, so every route is a right-angle polyline whose first and last
 * segments are perpendicular to the node sides. Routing happens in three steps:
 * 1. topology (`routeChannels`): a shortest path, with a bend penalty, over the channel junctions of the base geometry;
 * 2. tracks (`assignTracks`): every horizontal piece gets its own y and every vertical piece its own x, on a lattice
 *    TRACK_SPACING apart, so that no two edges share a stretch of line (crossings are allowed);
 * 3. sizing: what does not fit is reported as growth (taller nodes, wider gutters, taller gaps and footers); the layout grows
 *    those and assigns again. Topology only depends on which channel is next to which, so it survives the growth.
 *
 * Horizontal pieces are kept apart through the vertical channels they touch: a port stub touches the gutter beside its side,
 * a gap crossing touches the gutters on both sides of its sub-column, and within one gutter every horizontal piece has its own
 * lattice y (pieces of one edge may continue straight through). Band pieces are coloured by their x-span within the band.
 * Vertical pieces are coloured by their y-span, keyed by absolute x, so gutters of different lanes that share an x cannot
 * collide where they reach into the same footer band. */
import type { LayoutNode, Point } from './layout';
import { PORT_MARGIN, PORT_SPACING } from './nodeBox';

/** Distance between two parallel tracks, and the lattice every track sits on; the ports of one side use every other row. */
export const TRACK_SPACING = PORT_SPACING / 2;
/** Free space kept between a node side and the nearest vertical track, so arrowheads and stubs stay readable. */
export const SIDE_CLEARANCE = 10;
/** Free space between a gap track and the node or form box above and below it. */
export const GAP_MARGIN = 4;
/** Free space between a band track and the nodes above it or the lane border below it. */
export const BAND_MARGIN = 6;
/** Cost of one bend, in pixels of route length. Higher means fewer bends but more long runs through the footer bands (more
 * crossings); 55 with the longest routes first gave fewer bends and, on the sample and a real project, fewer crossings than 30
 * with the shortest first. */
const BEND_COST = 55;
/** Cost of crossing a sub-column through a gap between its nodes: long routes rather take the footer band. */
const GAP_CROSSING_COST = 40;
/** Cost of every edge already crossing a gap, so routes spread over the gaps instead of piling into one. */
const GAP_CROWDING_COST = 30;
/** Cost of every port already on a node side, so a busy node spreads its edges over both sides. */
const PORT_CROWDING_COST = 20;

export type Side = 'left' | 'right';

/** Which channel is next to which: fixed for a layout, whatever the sizes. Channels are numbered globally. */
export interface ChannelStructure {
  /** Lane of every vertical channel. */
  channelLane: number[];
  /** The gutters on the left and right of every gap's sub-column. */
  gaps: { left: number; right: number }[];
  /** Per lane: its footer band, reached by the lane's own gutters (`above`) and the next lane's gutters (`below`). */
  bands: { above: number[]; below: number[] }[];
  /** The gutters beside every node, by node index. */
  nodeChannels: { left: number; right: number }[];
  /** Lattice rows (0: even, 1: odd) for the ports of every node and the crossings of every gap: alternate from one
   * sub-column to the next, so the two sub-columns beside a gutter never want the same row. */
  nodeParity: number[];
  gapParity: number[];
}

const latticeParity = (lattice: number): number => ((lattice % 2) + 2) % 2;

/** Sizes and positions of the channels and nodes for one placement. Ranges are free space: tracks go anywhere inside. */
export interface ChannelGeometry {
  /** Free x range of every vertical channel. */
  channels: { left: number; right: number }[];
  /** Free y range of every gap (empty when top > bottom). */
  gaps: { top: number; bottom: number }[];
  /** Free y range of every band. */
  bands: { top: number; bottom: number }[];
  /** Node boxes by node index. */
  nodes: LayoutNode[];
}

export interface HorizontalPiece {
  kind: 'gap' | 'band';
  /** Gap or band index. */
  channel: number;
}

/** A route in terms of channels: source port, vertical channel, (horizontal channel, vertical channel)*, target port. */
export interface ChannelRoute {
  sourceSide: Side;
  targetSide: Side;
  horizontals: HorizontalPiece[];
  /** One more than `horizontals`: the gutter after the source port and after every horizontal piece. */
  verticals: number[];
}

export interface RoutedEdge { source: number; target: number }

/** How much more room each container needs, in pixels. */
export interface Growth {
  /** Extra height by node index (more ports than fit on a side). */
  nodes: Map<number, number>;
  /** Extra height by gap index. */
  gaps: Map<number, number>;
  /** Extra height by band index. */
  bands: Map<number, number>;
  /** Free width each vertical channel needs in all, by channel index. */
  channels: Map<number, number>;
}

export const isGrowthEmpty = (growth: Growth): boolean =>
  growth.nodes.size === 0 && growth.gaps.size === 0 && growth.bands.size === 0 && growth.channels.size === 0;

const VERTICAL = 0;
const HORIZONTAL = 1;

/** Binary min-heap of state indexes keyed by cost. */
class StateHeap {
  private keys: number[] = [];
  private states: number[] = [];

  get size(): number { return this.states.length; }

  clear(): void { this.keys.length = 0; this.states.length = 0; }

  push(state: number, key: number): void {
    const keys = this.keys;
    const states = this.states;
    let index = states.length;
    keys.push(key);
    states.push(state);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[index] = keys[parent];
      states[index] = states[parent];
      index = parent;
    }
    keys[index] = key;
    states[index] = state;
  }

  pop(): number {
    const keys = this.keys;
    const states = this.states;
    const top = states[0];
    const lastKey = keys.pop() as number;
    const lastState = states.pop() as number;
    const size = states.length;
    if (size > 0) {
      let index = 0;
      for (;;) {
        let child = 2 * index + 1;
        if (child >= size) break;
        if (child + 1 < size && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        keys[index] = keys[child];
        states[index] = states[child];
        index = child;
      }
      keys[index] = lastKey;
      states[index] = lastState;
    }
    return top;
  }
}

const channelCenter = (geometry: ChannelGeometry, channel: number): number =>
  (geometry.channels[channel].left + geometry.channels[channel].right) / 2;

const sideX = (node: LayoutNode, side: Side): number => (side === 'right' ? node.x + node.width : node.x);

const middleY = (node: LayoutNode): number => node.y + node.height / 2;

/** Index of the first value in the sorted list that is at least `value`. */
const lowerBound = (sorted: number[], value: number): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < value) low = middle + 1; else high = middle;
  }
  return low;
};

/** Junction graph of the channels: a vertex wherever a gap or band meets a vertical channel. */
interface JunctionGraph {
  x: number[];
  y: number[];
  channel: number[];
  /** Gap index of a gap junction, -1 for a band junction. */
  gap: number[];
  /** Band index of a band junction, -1 for a gap junction. */
  band: number[];
  verticalPrevious: number[];
  verticalNext: number[];
  /** The other end of a gap, or the neighbours along a band (-1 for none). */
  horizontalFirst: number[];
  horizontalSecond: number[];
  /** Junctions of every vertical channel, top to bottom, and their y. */
  channelJunctions: number[][];
  channelJunctionY: number[][];
}

const buildJunctionGraph = (structure: ChannelStructure, geometry: ChannelGeometry): JunctionGraph => {
  const graph: JunctionGraph = {
    x: [], y: [], channel: [], gap: [], band: [], verticalPrevious: [], verticalNext: [], horizontalFirst: [], horizontalSecond: [],
    channelJunctions: structure.channelLane.map(() => []), channelJunctionY: [],
  };
  const addJunction = (channel: number, y: number, gap: number, band: number): number => {
    const vertex = graph.x.length;
    graph.x.push(channelCenter(geometry, channel));
    graph.y.push(y);
    graph.channel.push(channel);
    graph.gap.push(gap);
    graph.band.push(band);
    graph.verticalPrevious.push(-1);
    graph.verticalNext.push(-1);
    graph.horizontalFirst.push(-1);
    graph.horizontalSecond.push(-1);
    graph.channelJunctions[channel].push(vertex);
    return vertex;
  };
  structure.gaps.forEach((gap, gapIndex) => {
    const range = geometry.gaps[gapIndex];
    if (range.bottom - range.top < TRACK_SPACING) return; // too small for a track (a gap of a full sub-column's bottom)
    const y = (range.top + range.bottom) / 2;
    const left = addJunction(gap.left, y, gapIndex, -1);
    const right = addJunction(gap.right, y, gapIndex, -1);
    graph.horizontalFirst[left] = right;
    graph.horizontalFirst[right] = left;
  });
  structure.bands.forEach((band, bandIndex) => {
    const range = geometry.bands[bandIndex];
    const y = (range.top + range.bottom) / 2;
    const junctions = [...band.above, ...band.below].map((channel) => addJunction(channel, y, -1, bandIndex));
    junctions.sort((first, second) => graph.x[first] - graph.x[second] || first - second);
    junctions.forEach((vertex, index) => {
      graph.horizontalFirst[vertex] = index > 0 ? junctions[index - 1] : -1;
      graph.horizontalSecond[vertex] = index + 1 < junctions.length ? junctions[index + 1] : -1;
    });
  });
  graph.channelJunctions.forEach((junctions) => {
    junctions.sort((first, second) => graph.y[first] - graph.y[second] || first - second);
    junctions.forEach((vertex, index) => {
      graph.verticalPrevious[vertex] = index > 0 ? junctions[index - 1] : -1;
      graph.verticalNext[vertex] = index + 1 < junctions.length ? junctions[index + 1] : -1;
    });
  });
  graph.channelJunctionY = graph.channelJunctions.map((junctions) => junctions.map((vertex) => graph.y[vertex]));
  return graph;
};

const SIDES: Side[] = ['right', 'left'];

/** Routes every edge through the channels of the base geometry: the cheapest path (length, bends, crowded gaps) found by A*
 * over the junction graph, from either side of the source to either side of the target. */
export function routeChannels(structure: ChannelStructure, geometry: ChannelGeometry, edges: RoutedEdge[]): ChannelRoute[] {
  const graph = buildJunctionGraph(structure, geometry);
  const vertexCount = graph.x.length;
  const startState = 2 * vertexCount;
  const goalState = startState + 1;
  const stateCount = goalState + 1;
  const cost = new Float64Array(stateCount);
  const parent = new Int32Array(stateCount);
  const seen = new Int32Array(stateCount);
  const closed = new Int32Array(stateCount);
  const firstSide = new Int8Array(stateCount);
  const gapUses = new Int32Array(structure.gaps.length);  // ports already on each side of each node (right: 2 * node, left: 2 * node + 1, the order of SIDES)
  const sidePorts = new Int32Array(2 * geometry.nodes.length);
  const heap = new StateHeap();
  let stamp = 0;

  const routes: ChannelRoute[] = new Array(edges.length);
  // long edges first: they get the straightest routes, and the short ones fit around them (fewer crossings than short first)
  const order = edges.map((_, index) => index);
  const reach = edges.map((edge) => {
    const source = geometry.nodes[edge.source];
    const target = geometry.nodes[edge.target];
    return Math.abs(source.x - target.x) + Math.abs(source.y - target.y);
  });
  order.sort((first, second) => reach[second] - reach[first] || first - second);

  order.forEach((edgeIndex) => {
    const { source, target } = edges[edgeIndex];
    const sourceNode = geometry.nodes[source];
    const targetNode = geometry.nodes[target];
    const sourceY = middleY(sourceNode);
    const targetY = middleY(targetNode);
    const targetChannels = SIDES.map((side) => (side === 'right' ? structure.nodeChannels[target].right : structure.nodeChannels[target].left));
    const targetStub = SIDES.map((side, index) => Math.abs(sideX(targetNode, side) - channelCenter(geometry, targetChannels[index]))
      + PORT_CROWDING_COST * sidePorts[2 * target + index]);
    const targetX = targetChannels.map((channel) => channelCenter(geometry, channel));
    stamp++;
    heap.clear();
    let goalSide = 0;
    let directSourceSide = -1;

    const estimate = (vertex: number): number => Math.min(
      Math.abs(graph.x[vertex] - targetX[0]), Math.abs(graph.x[vertex] - targetX[1]),
    ) + Math.abs(graph.y[vertex] - targetY);
    const relax = (state: number, value: number, from: number, heuristic: number): void => {
      if (seen[state] === stamp && cost[state] <= value) return;
      seen[state] = stamp;
      cost[state] = value;
      parent[state] = from;
      heap.push(state, value + heuristic);
    };
    const relaxGoal = (value: number, from: number, side: number): void => {
      if (seen[goalState] === stamp && cost[goalState] <= value) return;
      seen[goalState] = stamp;
      cost[goalState] = value;
      parent[goalState] = from;
      goalSide = side;
      heap.push(goalState, value);
    };

    SIDES.forEach((side, sideIndex) => {
      const channel = side === 'right' ? structure.nodeChannels[source].right : structure.nodeChannels[source].left;
      const stub = Math.abs(sideX(sourceNode, side) - channelCenter(geometry, channel)) + PORT_CROWDING_COST * sidePorts[2 * source + sideIndex];
      const junctionY = graph.channelJunctionY[channel];
      const junctions = graph.channelJunctions[channel];
      const index = lowerBound(junctionY, sourceY);
      [index - 1, index].forEach((position) => {
        if (position < 0 || position >= junctions.length) return;
        const vertex = junctions[position];
        const state = 2 * vertex + VERTICAL;
        const value = stub + BEND_COST + Math.abs(junctionY[position] - sourceY);
        if (seen[state] === stamp && cost[state] <= value) return;
        relax(state, value, startState, estimate(vertex));
        firstSide[state] = sideIndex;
      });
      targetChannels.forEach((targetChannel, targetSideIndex) => {
        if (targetChannel !== channel) return;
        const value = stub + 2 * BEND_COST + Math.abs(sourceY - targetY) + targetStub[targetSideIndex];
        if (seen[goalState] === stamp && cost[goalState] <= value) return;
        relaxGoal(value, startState, targetSideIndex);
        directSourceSide = sideIndex;
      });
    });

    while (heap.size > 0) {
      const state = heap.pop();
      if (state === goalState) break;
      if (closed[state] === stamp) continue;
      closed[state] = stamp;
      const vertex = state >> 1;
      const axis = state & 1;
      const here = cost[state];
      const channel = graph.channel[vertex];
      targetChannels.forEach((targetChannel, targetSideIndex) => {
        if (targetChannel !== channel) return;
        const value = here + Math.abs(graph.y[vertex] - targetY) + (axis === HORIZONTAL ? BEND_COST : 0) + BEND_COST + targetStub[targetSideIndex];
        if (seen[goalState] !== stamp || value < cost[goalState]) {
          relaxGoal(value, state, targetSideIndex);
          directSourceSide = -1;
        }
      });
      const turnToVertical = axis === HORIZONTAL ? BEND_COST : 0;
      for (const next of [graph.verticalPrevious[vertex], graph.verticalNext[vertex]]) {
        if (next < 0) continue;
        relax(2 * next + VERTICAL, here + Math.abs(graph.y[next] - graph.y[vertex]) + turnToVertical, state, estimate(next));
      }
      const turnToHorizontal = axis === VERTICAL ? BEND_COST : 0;
      for (const next of [graph.horizontalFirst[vertex], graph.horizontalSecond[vertex]]) {
        if (next < 0) continue;
        const crowding = graph.gap[vertex] >= 0 ? GAP_CROSSING_COST + GAP_CROWDING_COST * gapUses[graph.gap[vertex]] : 0;
        relax(2 * next + HORIZONTAL, here + Math.abs(graph.x[next] - graph.x[vertex]) + crowding + turnToHorizontal, state, estimate(next));
      }
    }

    if (seen[goalState] !== stamp) {
      // unreachable through the channels (cannot happen for nodes in one lane structure): a plain side-to-side route
      const sourceSideIndex = sourceNode.x <= targetNode.x ? 0 : 1;
      const sourceChannel = sourceSideIndex === 0 ? structure.nodeChannels[source].right : structure.nodeChannels[source].left;
      routes[edgeIndex] = { sourceSide: SIDES[sourceSideIndex], targetSide: SIDES[sourceSideIndex], horizontals: [], verticals: [sourceChannel] };
      return;
    }

    // walk back from the goal: the junction states of the path, first to last
    const path: number[] = [];
    let state = parent[goalState];
    while (state !== startState) {
      path.push(state);
      state = parent[state];
    }
    path.reverse();
    const sourceSideIndex = path.length ? firstSide[path[0]] : directSourceSide;
    const horizontals: HorizontalPiece[] = [];
    const verticals: number[] = [path.length ? graph.channel[path[0] >> 1] : targetChannels[goalSide]];
    for (let index = 1; index < path.length; index++) {
      const vertex = path[index] >> 1;
      if ((path[index] & 1) === VERTICAL) continue;
      const previous = path[index - 1] >> 1;
      const band = graph.band[vertex];
      const continuesBand = band >= 0 && (path[index - 1] & 1) === HORIZONTAL && graph.band[previous] === band;
      if (continuesBand) {
        verticals[verticals.length - 1] = graph.channel[vertex];
        continue;
      }
      if (band >= 0) horizontals.push({ kind: 'band', channel: band });
      else {
        horizontals.push({ kind: 'gap', channel: graph.gap[vertex] });
        gapUses[graph.gap[vertex]]++;
      }
      verticals.push(graph.channel[vertex]);
    }
    routes[edgeIndex] = { sourceSide: SIDES[sourceSideIndex], targetSide: SIDES[goalSide], horizontals, verticals };
    sidePorts[2 * source + sourceSideIndex]++;
    sidePorts[2 * target + goalSide]++;
  });
  return routes;
}

const latticeRange = (low: number, high: number): [number, number] =>
  [Math.ceil(low / TRACK_SPACING - 1e-9), Math.floor(high / TRACK_SPACING + 1e-9)];

const addGrowth = (map: Map<number, number>, key: number, amount: number): void => {
  map.set(key, (map.get(key) ?? 0) + amount);
};

/** Whether an interval list (pairs of numbers, flat) has one overlapping [low, high] once both are widened by TRACK_SPACING. */
const intervalsClash = (intervals: number[] | undefined, low: number, high: number): boolean => {
  if (!intervals) return false;
  for (let index = 0; index < intervals.length; index += 2) {
    if (intervals[index] < high + TRACK_SPACING && low < intervals[index + 1] + TRACK_SPACING) return true;
  }
  return false;
};

const pushInterval = (map: Map<number, number[]>, key: number, low: number, high: number): void => {
  const intervals = map.get(key);
  if (intervals) intervals.push(low, high); else map.set(key, [low, high]);
};

/** A vertical piece in a gutter: its y-span, and from which side (-1 left, 1 right) a horizontal arm reaches each end. */
interface VerticalPiece { edge: number; index: number; channel: number; low: number; high: number; lowArm: number; highArm: number }

/** How many arms of `piece` cross `other`, when `other` stands between the arms' origin and the piece: on the piece's left
 * (`otherIsLeft`) for arms coming from the left, on its right for arms from the right. */
const armCrosses = (piece: VerticalPiece, otherIsLeft: boolean, other: VerticalPiece): number => {
  const side = otherIsLeft ? -1 : 1;
  let count = 0;
  if (piece.lowArm === side && piece.low > other.low && piece.low < other.high) count++;
  if (piece.highArm === side && piece.high > other.low && piece.high < other.high) count++;
  return count;
};

/** Points of every route for this geometry, and the growth needed where tracks did not fit (empty when everything fits:
 * then no two edges share a stretch of line). */
export function assignTracks(
  structure: ChannelStructure, geometry: ChannelGeometry, edges: RoutedEdge[], routes: ChannelRoute[],
): { points: Point[][]; growth: Growth } {
  const growth: Growth = { nodes: new Map(), gaps: new Map(), bands: new Map(), channels: new Map() };
  // y of every horizontal item of every route: [source port, ...horizontals, target port]
  const itemY = routes.map((route) => new Array<number>(route.horizontals.length + 2).fill(NaN));

  // 1. band pieces: interval colouring of their x-spans (conservatively, the full width of both gutters they join)
  const bandPieces: { edge: number; item: number; low: number; high: number; band: number }[] = [];
  routes.forEach((route, edge) => route.horizontals.forEach((piece, index) => {
    if (piece.kind !== 'band') return;
    const first = geometry.channels[route.verticals[index]];
    const second = geometry.channels[route.verticals[index + 1]];
    bandPieces.push({ edge, item: index + 1, low: Math.min(first.left, second.left), high: Math.max(first.right, second.right), band: piece.channel });
  }));
  bandPieces.sort((first, second) => first.band - second.band || first.low - second.low || first.high - second.high || first.edge - second.edge);
  // Greedy colouring in order of start needs as many rows as the most pieces over one x, which is the least possible; rows
  // beyond the band are counted as growth (and used for now, to be placed properly once the band has grown). (Colouring by
  // length instead, shortest or longest first, measured worse in crossings on big projects.)
  const bandRows = new Map<number, number[]>();
  let currentBand = -1;
  bandPieces.forEach((piece) => {
    if (piece.band !== currentBand) { bandRows.clear(); currentBand = piece.band; }
    const range = geometry.bands[piece.band];
    const [first, last] = latticeRange(range.top, range.bottom);
    let chosen = first;
    while (intervalsClash(bandRows.get(chosen), piece.low, piece.high)) chosen++;
    if (chosen > last) growth.bands.set(piece.band, Math.max(growth.bands.get(piece.band) ?? 0, (chosen - last) * TRACK_SPACING));
    pushInterval(bandRows, chosen, piece.low, piece.high);
    itemY[piece.edge][piece.item] = chosen * TRACK_SPACING;
  });

  // 2. ports and gap crossings, edge by edge: a lattice y free in every gutter the item touches, as close as possible to
  // where the route comes from. Neighbouring sub-columns use alternate lattice rows (their parity), so the items of one
  // sub-column never compete with those of the next across the gutter they share: ports compete only with the other ports of
  // their side, gap crossings only with the other crossings of their gap, and what they need is known exactly.
  const occupancy: Map<number, number>[] = geometry.channels.map(() => new Map());
  const itemRange: { low: number; high: number; channels: number[]; parity: number }[][] = routes.map(() => []);
  const pickLattice = (low: number, high: number, preferred: number, channels: number[], parity: number): number => {
    const [first, last] = latticeRange(low, high);
    let start = Math.min(last, Math.max(first, Math.round(preferred / TRACK_SPACING)));
    if (latticeParity(start) !== parity) start += start + 1 <= last ? 1 : -1;
    for (let distance = 0; distance <= last - first + 2; distance += 2) {
      for (const lattice of distance === 0 ? [start] : [start - distance, start + distance]) {
        if (lattice < first || lattice > last) continue;
        if (channels.every((channel) => !occupancy[channel].has(lattice))) return lattice;
      }
    }
    return -Infinity;
  };
  const sideFailures = new Map<string, number>();
  routes.forEach((route, edge) => {
    const { source, target } = edges[edge];
    const items = route.horizontals.length + 2;
    let previousLattice = Number.NaN;
    for (let item = 0; item < items; item++) {
      const isSource = item === 0;
      const isTarget = item === items - 1;
      if (!isSource && !isTarget && route.horizontals[item - 1].kind === 'band') {
        previousLattice = itemY[edge][item] / TRACK_SPACING;
        continue;
      }
      let low: number, high: number, preferred: number, channels: number[], parity: number;
      if (isSource || isTarget) {
        const nodeIndex = isSource ? source : target;
        const node = geometry.nodes[nodeIndex];
        low = node.y + PORT_MARGIN;
        high = node.y + node.height - PORT_MARGIN;
        channels = [isSource ? route.verticals[0] : route.verticals[route.verticals.length - 1]];
        parity = structure.nodeParity[nodeIndex];
        if (isSource) {
          // towards the next item: the middle of the next gap, the band below, or the target's middle
          const next = route.horizontals[0];
          preferred = !next
            ? middleY(geometry.nodes[target])
            : next.kind === 'gap' ? (geometry.gaps[next.channel].top + geometry.gaps[next.channel].bottom) / 2 : geometry.bands[next.channel].top;
          preferred = Math.min(high, Math.max(low, preferred));
          // spread several ports from the middle outwards rather than all at one end
          if (!next || next.kind === 'band') preferred = (low + high) / 2 + (preferred - (low + high) / 2) / 4;
        } else {
          preferred = previousLattice * TRACK_SPACING;
        }
      } else {
        const gap = route.horizontals[item - 1].channel;
        low = geometry.gaps[gap].top;
        high = geometry.gaps[gap].bottom;
        channels = [structure.gaps[gap].left, structure.gaps[gap].right];
        parity = structure.gapParity[gap];
        preferred = previousLattice * TRACK_SPACING;
      }
      itemRange[edge][item] = { low, high, channels, parity };
      let lattice = pickLattice(low, high, preferred, channels, parity);
      if (lattice === -Infinity) {
        if (isSource || isTarget) {
          const key = `${isSource ? source : target}:${isSource ? route.sourceSide : route.targetSide}`;
          sideFailures.set(key, (sideFailures.get(key) ?? 0) + 1);
        } else addGrowth(growth.gaps, route.horizontals[item - 1].channel, 2 * TRACK_SPACING);
        lattice = Math.round(Math.min(high, Math.max(low, preferred)) / TRACK_SPACING);
      }
      channels.forEach((channel) => { if (!occupancy[channel].has(lattice)) occupancy[channel].set(lattice, edge); });
      itemY[edge][item] = lattice * TRACK_SPACING;
      previousLattice = lattice;
    }
  });
  sideFailures.forEach((count, key) => {
    const nodeIndex = Number(key.slice(0, key.indexOf(':')));
    growth.nodes.set(nodeIndex, Math.max(growth.nodes.get(nodeIndex) ?? 0, count * 2 * TRACK_SPACING));
  });

  // 2b. straighten: where two consecutive items of a route meet in one gutter at different heights, move one onto the
  // other's line if that line is free in every gutter it touches (a route may run straight through a gutter)
  if (growth.nodes.size === 0 && growth.gaps.size === 0) {
    const moveItem = (edge: number, item: number, lattice: number): boolean => {
      const range = itemRange[edge][item];
      const [first, last] = latticeRange(range.low, range.high);
      if (lattice < first || lattice > last) return false;
      if (!range.channels.every((channel) => { const occupant = occupancy[channel].get(lattice); return occupant === undefined || occupant === edge; })) return false;
      const old = itemY[edge][item] / TRACK_SPACING;
      range.channels.forEach((channel) => {
        const stillUsed = itemRange[edge].some((other, otherItem) => otherItem !== item && other !== undefined
          && other.channels.includes(channel) && itemY[edge][otherItem] / TRACK_SPACING === old);
        if (!stillUsed && occupancy[channel].get(old) === edge) occupancy[channel].delete(old);
        occupancy[channel].set(lattice, edge);
      });
      itemY[edge][item] = lattice * TRACK_SPACING;
      return true;
    };
    routes.forEach((route, edge) => {
      const { source, target } = edges[edge];
      for (let item = 1; item < route.horizontals.length + 2; item++) {
        if (!itemRange[edge][item] || !itemRange[edge][item - 1]) continue; // a band piece stays where it is
        if (item === route.horizontals.length + 1 && source === target) continue; // never straight back into its own node
        if (itemY[edge][item] === itemY[edge][item - 1] || !itemRange[edge][item].channels.includes(route.verticals[item - 1])) continue;
        if (!moveItem(edge, item, itemY[edge][item - 1] / TRACK_SPACING)) moveItem(edge, item - 1, itemY[edge][item] / TRACK_SPACING);
      }
    });
  }

  // 3. vertical pieces: interval colouring of their y-spans per gutter, keyed by absolute x across all gutters
  const verticalPieces: VerticalPiece[] = [];
  const pieceX = routes.map((route) => new Array<number>(route.verticals.length).fill(NaN));
  routes.forEach((route, edge) => route.verticals.forEach((channel, index) => {
    const from = itemY[edge][index];
    const to = itemY[edge][index + 1];
    if (from === to) { pieceX[edge][index] = channelCenter(geometry, channel); return; }
    // the horizontal arm at each end comes from the left (-1) or the right (1) of the gutter: a port stub from its node, or
    // the gap or band piece towards the neighbouring vertical piece of the route
    const armAt = (item: number): number => {
      if (item === 0) return route.sourceSide === 'right' ? -1 : 1;
      if (item === route.verticals.length) return route.targetSide === 'right' ? -1 : 1;
      const other = route.verticals[item === index ? index - 1 : index + 1];
      return Math.sign(channelCenter(geometry, other) - channelCenter(geometry, channel));
    };
    const fromArm = armAt(index);
    const toArm = armAt(index + 1);
    verticalPieces.push({
      edge, index, channel, low: Math.min(from, to), high: Math.max(from, to),
      lowArm: from < to ? fromArm : toArm, highArm: from < to ? toArm : fromArm,
    });
  }));
  verticalPieces.sort((first, second) => first.channel - second.channel || first.low - second.low || first.high - second.high || first.edge - second.edge);
  const columns = new Map<number, number[]>();
  // tracks a gutter needs beyond its width, kept apart from the shared x index (they are not real positions yet)
  let overflow = new Map<number, number[]>();
  let overflowChannel = -1;
  // Pieces of the gutter placed so far that are still alive at the current start, with their lattice column.
  let alive: (VerticalPiece & { lattice: number })[] = [];
  let aliveChannel = -1;
  verticalPieces.forEach((piece) => {
    const range = geometry.channels[piece.channel];
    const [first, last] = latticeRange(range.left, range.right);
    if (aliveChannel !== piece.channel) { alive = []; aliveChannel = piece.channel; }
    alive = alive.filter((other) => other.high + TRACK_SPACING > piece.low);
    // of the free columns, the one where the fewest arms cross a piece of the gutter (ties: the leftmost)
    let chosen = Number.NaN;
    let fewest = Infinity;
    for (let lattice = first; lattice <= last; lattice++) {
      if (intervalsClash(columns.get(lattice), piece.low, piece.high)) continue;
      let crossings = 0;
      for (const other of alive) {
        if (other.lattice === lattice) continue;
        const otherIsLeft = other.lattice < lattice;
        crossings += armCrosses(piece, otherIsLeft, other) + armCrosses(other, !otherIsLeft, piece);
      }
      if (crossings < fewest) { fewest = crossings; chosen = lattice; }
      if (crossings === 0) break;
    }
    if (!Number.isNaN(chosen)) alive.push({ ...piece, lattice: chosen });
    if (Number.isNaN(chosen)) {
      if (overflowChannel !== piece.channel) { overflow = new Map(); overflowChannel = piece.channel; }
      let extra = last + 1;
      while (intervalsClash(overflow.get(extra), piece.low, piece.high)) extra++;
      pushInterval(overflow, extra, piece.low, piece.high);
      growth.channels.set(piece.channel, Math.max(growth.channels.get(piece.channel) ?? 0, (extra - first + 2) * TRACK_SPACING));
      pieceX[piece.edge][piece.index] = Math.min(last, Math.max(first, extra)) * TRACK_SPACING;
      return;
    }
    pushInterval(columns, chosen, piece.low, piece.high);
    pieceX[piece.edge][piece.index] = chosen * TRACK_SPACING;
  });

  const points = routes.map((route, edge) => {
    const { source, target } = edges[edge];
    const ys = itemY[edge];
    const routePoints: Point[] = [{ x: sideX(geometry.nodes[source], route.sourceSide), y: ys[0] }];
    route.verticals.forEach((_, index) => {
      routePoints.push({ x: pieceX[edge][index], y: ys[index] }, { x: pieceX[edge][index], y: ys[index + 1] });
    });
    routePoints.push({ x: sideX(geometry.nodes[target], route.targetSide), y: ys[ys.length - 1] });
    return simplifyPolyline(routePoints);
  });
  return { points, growth };
}

/** Drops repeated points and the middle one of three on one line. */
export const simplifyPolyline = (points: Point[]): Point[] => {
  const kept: Point[] = [];
  points.forEach((point) => {
    const last = kept[kept.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    const beforeLast = kept[kept.length - 2];
    if (last && beforeLast && ((beforeLast.x === last.x && last.x === point.x) || (beforeLast.y === last.y && last.y === point.y))) {
      kept[kept.length - 1] = point;
      return;
    }
    kept.push(point);
  });
  return kept;
};
