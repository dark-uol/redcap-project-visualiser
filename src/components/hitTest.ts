/* Decides what a click on the graph stage means, without touching app state. */
import { groupIdFor } from '../lib/selection';
import type { View } from '../lib/types';
import { CLUSTER_SEL, EDGE_SEL, clusterIndex, closestEl, edgeKey, isFormLike, nodeKey } from './svgDom';

export type ClickAction =
  | { type: 'edge'; from: string; to: string } // a form-to-form edge
  | { type: 'select'; id: string }              // a node, or a form box
  | { type: 'clear' }                           // empty background
  | { type: 'none' };

/** Map a click target inside the rendered svg to the selection change it should cause. */
export const resolveClick = (target: EventTarget | null, view: View, isForm: (id: string) => boolean): ClickAction => {
  const nodeAt = (k: string | undefined) => (k ? view.nodes[+k.slice(1)] : undefined);

  const edge = closestEl(target, EDGE_SEL);
  if (edge && view.level === 'form') {
    const k = edgeKey(edge);
    const a = nodeAt(k?.[0]), b = nodeAt(k?.[1]);
    if (isFormLike(a, isForm) && isFormLike(b, isForm)) return { type: 'edge', from: a.form || a.id, to: b.form || b.id };
  }

  const node = closestEl(target, 'g.node');
  if (node) {
    const n = nodeAt(nodeKey(node) ?? undefined);
    return n ? { type: 'select', id: n.id } : { type: 'none' }; // full node id (variable@@instance) so the right copy is highlighted
  }

  const cluster = closestEl(target, CLUSTER_SEL);
  if (cluster && (view.level === 'field' || view.mixed)) {
    const groupIndex = clusterIndex(cluster);
    const group = groupIndex == null ? undefined : view.groups[groupIndex];
    return group && !group.noSelect ? { type: 'select', id: view.mixed ? group.id : groupIdFor(group.id) } : { type: 'none' };
  }
  return closestEl(target, `${EDGE_SEL}, .edgeLabel`) ? { type: 'none' } : { type: 'clear' };
};
