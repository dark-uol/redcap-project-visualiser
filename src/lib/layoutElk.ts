/* ELK layout (elkjs, layered algorithm) producing the engine-neutral Layout. Pure: no Solid, no DOM. elkjs is imported lazily
 * so the main bundle does not grow. ELK reports node coordinates relative to their compound parent and edge section points
 * relative to the edge's container; both are converted to absolute coordinates here. */
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion, Point } from './layout';
import type { EventDef, View, ViewOptions } from './types';

const NODE_WIDTH = 120;
const NODE_HEIGHT = 28;
const MARGIN = 20;
const ROOT_ID = 'root';
/** Room above the members for the group label. */
const GROUP_PADDING = '[top=36,left=16,bottom=16,right=16]';

interface ElkLayoutEngine { layout(graph: ElkNode): Promise<ElkNode> }

interface Box { x: number; y: number; width: number; height: number }

let elkEngine: Promise<ElkLayoutEngine> | undefined;

/** One ELK instance, created on first use; a failed import is retried next time. */
const loadElk = (): Promise<ElkLayoutEngine> => {
  elkEngine ??= import('elkjs/lib/elk.bundled.js')
    .then((elkModule) => new elkModule.default())
    .catch((error: unknown) => {
      elkEngine = undefined;
      throw error;
    });
  return elkEngine;
};

const nodeElkId = (nodeIndex: number): string => `n${nodeIndex}`;
const groupElkId = (groupIndex: number): string => `g${groupIndex}`;
const edgeElkId = (edgeIndex: number): string => `e${edgeIndex}`;
/** Group index -1 is the root graph. */
const containerElkId = (groupIndex: number): string => (groupIndex === -1 ? ROOT_ID : groupElkId(groupIndex));

/**
 * Partition per node index, or undefined when no node belongs to an event (then ELK is not partitioned).
 * Events are ranked by their day offset (events without one use their position in `events`); equal days share a partition.
 * Nodes with no event go to the last partition.
 */
const partitionByNodeIndex = (view: View, events: EventDef[]): number[] | undefined => {
  const eventIndexById = new Map(events.map((event, index) => [event.id, index] as const));
  const eventIdOf = (nodeIndex: number): string | undefined => {
    const node = view.nodes[nodeIndex];
    if (node.event && eventIndexById.has(node.event)) return node.event;
    if (view.level === 'event' && eventIndexById.has(node.id)) return node.id;
    return undefined;
  };
  const eventIdByNodeIndex = view.nodes.map((_, nodeIndex) => eventIdOf(nodeIndex));
  if (eventIdByNodeIndex.every((eventId) => eventId === undefined)) return undefined;

  const sortKeyOf = (eventId: string): number => {
    const event = events[eventIndexById.get(eventId) as number];
    return event.dayOffset ?? (eventIndexById.get(eventId) as number);
  };
  const sortKeys = [...new Set(eventIdByNodeIndex.flatMap((eventId) => (eventId === undefined ? [] : [sortKeyOf(eventId)])))]
    .sort((left, right) => left - right);
  const partitionOfKey = new Map(sortKeys.map((key, rank) => [key, rank] as const));
  return eventIdByNodeIndex.map((eventId) => (eventId === undefined ? sortKeys.length : (partitionOfKey.get(sortKeyOf(eventId)) as number)));
};

export async function layoutElk(view: View, options: Pick<ViewOptions, 'dir'>, events: EventDef[]): Promise<Layout> {
  const engine = await loadElk();
  const nodeIndexById = new Map(view.nodes.map((node, index) => [node.id, index] as const));
  const groupIndexById = new Map(view.groups.map((group, index) => [group.id, index] as const));
  const partitions = partitionByNodeIndex(view, events);

  // Parent group per group (-1 for top level). A cycle in `parent` would never terminate, so the group that closes it becomes top level.
  const parentIndexes = view.groups.map((group) => {
    const parentIndex = group.parent === undefined ? undefined : groupIndexById.get(group.parent);
    return parentIndex === undefined ? -1 : parentIndex;
  });
  parentIndexes.forEach((_, groupIndex) => {
    let current = parentIndexes[groupIndex];
    for (let step = 0; current !== -1 && step <= view.groups.length; step++) {
      if (current === groupIndex) {
        parentIndexes[groupIndex] = -1;
        break;
      }
      current = parentIndexes[current];
    }
  });
  const ancestorsOf = (groupIndex: number): number[] => {
    const chain: number[] = [];
    let current = parentIndexes[groupIndex];
    while (current !== -1 && current !== groupIndex && !chain.includes(current)) {
      chain.push(current);
      current = parentIndexes[current];
    }
    return chain;
  };

  // Innermost group listing each node (-1 for none): the deepest of the groups that list it.
  const depthByGroup = view.groups.map((_, groupIndex) => ancestorsOf(groupIndex).length);
  const groupOfNodeIndex = view.nodes.map(() => -1);
  view.groups.forEach((group, groupIndex) => {
    for (const memberId of group.nodes) {
      const nodeIndex = nodeIndexById.get(memberId);
      if (nodeIndex === undefined) continue;
      const current = groupOfNodeIndex[nodeIndex];
      if (current === -1 || depthByGroup[groupIndex] > depthByGroup[current]) groupOfNodeIndex[nodeIndex] = groupIndex;
    }
  });

  // A group is drawn when it holds a node, directly or through a nested group; its ancestors are drawn too.
  const includedGroups = new Set<number>();
  for (const groupIndex of groupOfNodeIndex) {
    let current = groupIndex;
    while (current !== -1 && !includedGroups.has(current)) {
      includedGroups.add(current);
      current = parentIndexes[current];
    }
  }

  // Container chain from a group outwards to the root (-1), used to find the lowest common container of an edge.
  const containerChainOf = (groupIndex: number): number[] => (groupIndex === -1 ? [-1] : [groupIndex, ...ancestorsOf(groupIndex), -1]);
  const lowestCommonContainer = (sourceIndex: number, targetIndex: number): number => {
    const targetChain = new Set(containerChainOf(groupOfNodeIndex[targetIndex]));
    return containerChainOf(groupOfNodeIndex[sourceIndex]).find((groupIndex) => targetChain.has(groupIndex)) as number;
  };

  // Build the ELK graph: compound group nodes, leaf nodes, then edges (in the root; ELK may report another container).
  const groupElkNodes = new Map<number, ElkNode>();
  for (const groupIndex of includedGroups) {
    groupElkNodes.set(groupIndex, { id: groupElkId(groupIndex), children: [], layoutOptions: { 'elk.padding': GROUP_PADDING } });
  }
  const rootChildren: ElkNode[] = [];
  for (const [groupIndex, groupElk] of groupElkNodes) {
    const parentIndex = parentIndexes[groupIndex];
    (parentIndex === -1 ? rootChildren : (groupElkNodes.get(parentIndex) as ElkNode).children as ElkNode[]).push(groupElk);
  }
  view.nodes.forEach((_, nodeIndex) => {
    const leaf: ElkNode = { id: nodeElkId(nodeIndex), width: NODE_WIDTH, height: NODE_HEIGHT };
    if (partitions) leaf.layoutOptions = { 'elk.partitioning.partition': String(partitions[nodeIndex]) };
    const groupIndex = groupOfNodeIndex[nodeIndex];
    (groupIndex === -1 ? rootChildren : (groupElkNodes.get(groupIndex) as ElkNode).children as ElkNode[]).push(leaf);
  });

  const elkEdges: ElkExtendedEdge[] = [];
  const edgeMetaByElkId = new Map<string, { edgeIndex: number; sourceIndex: number; targetIndex: number; containerId: string }>();
  view.edges.forEach((edge, edgeIndex) => {
    const sourceIndex = nodeIndexById.get(edge.from);
    const targetIndex = nodeIndexById.get(edge.to);
    if (sourceIndex === undefined || targetIndex === undefined) return;
    const elkId = edgeElkId(edgeIndex);
    elkEdges.push({ id: elkId, sources: [nodeElkId(sourceIndex)], targets: [nodeElkId(targetIndex)] });
    edgeMetaByElkId.set(elkId, {
      edgeIndex, sourceIndex, targetIndex, containerId: containerElkId(lowestCommonContainer(sourceIndex, targetIndex)),
    });
  });

  const elkGraph: ElkNode = {
    id: ROOT_ID,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': options.dir === 'LR' ? 'RIGHT' : 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '24',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      ...(partitions ? { 'elk.partitioning.activate': 'true' } : {}),
    },
    children: rootChildren,
    edges: elkEdges,
  };
  const laidOut = await engine.layout(elkGraph);

  // ELK child coordinates are relative to their parent: accumulate the origin of every container.
  const absoluteBoxById = new Map<string, Box>();
  const originById = new Map<string, Point>([[ROOT_ID, { x: 0, y: 0 }]]);
  const placeChildren = (parent: ElkNode, originX: number, originY: number): void => {
    for (const child of parent.children ?? []) {
      const absoluteX = originX + (child.x ?? 0);
      const absoluteY = originY + (child.y ?? 0);
      absoluteBoxById.set(child.id, { x: absoluteX, y: absoluteY, width: child.width ?? 0, height: child.height ?? 0 });
      originById.set(child.id, { x: absoluteX, y: absoluteY });
      placeChildren(child, absoluteX, absoluteY);
    }
  };
  placeChildren(laidOut, 0, 0);

  const nodes: LayoutNode[] = view.nodes.map((node, nodeIndex) => {
    const box = absoluteBoxById.get(nodeElkId(nodeIndex));
    if (!box) throw new Error(`ELK did not place node ${node.id}`);
    return { id: node.id, ...box };
  });

  // Edge sections are relative to the edge's container; points are the start, the bends and the end of the first section.
  const edges: LayoutEdge[] = [];
  for (const elkEdge of laidOut.edges ?? []) {
    const meta = edgeMetaByElkId.get(elkEdge.id);
    const section = elkEdge.sections?.[0];
    if (!meta || !section) continue;
    const origin = originById.get(elkEdge.container ?? meta.containerId) ?? { x: 0, y: 0 };
    const relativePoints: Point[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    const viewEdge = view.edges[meta.edgeIndex];
    edges.push({
      from: viewEdge.from,
      to: viewEdge.to,
      points: relativePoints.map((point) => ({ x: origin.x + point.x, y: origin.y + point.y })),
      backward: partitions !== undefined && partitions[meta.targetIndex] < partitions[meta.sourceIndex],
    });
  }

  const regions: LayoutRegion[] = [];
  for (const groupIndex of [...includedGroups].sort((left, right) => left - right)) {
    const box = absoluteBoxById.get(groupElkId(groupIndex));
    const group = view.groups[groupIndex];
    if (!box) continue;
    regions.push({ id: group.id, kind: 'cluster', label: group.label, groupIndex, ...box });
  }

  const right = Math.max(0, ...nodes.map((node) => node.x + node.width), ...regions.map((region) => region.x + region.width),
    ...edges.flatMap((edge) => (edge.points ?? []).map((point) => point.x)));
  const bottom = Math.max(0, ...nodes.map((node) => node.y + node.height), ...regions.map((region) => region.y + region.height),
    ...edges.flatMap((edge) => (edge.points ?? []).map((point) => point.y)));

  return { width: right + MARGIN, height: bottom + MARGIN, nodes, edges, regions };
}
