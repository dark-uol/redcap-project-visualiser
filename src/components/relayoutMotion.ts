/* Smooths the jump when a re-render lays the graph out again (expand / collapse): nodes present before and after slide
   from their old position to their new one; new nodes grow out of the acted-on node; edges and boxes fade in. No Solid, no store. */
import type { View } from '../lib/types';
import { centreInStage, nodeKey } from './svgDom';

export const MOTION_MS = 450;

export interface Point { x: number; y: number }

/** Stage-relative centre of every node currently drawn, keyed by node id. */
export const snapshotNodeCentres = (svg: SVGSVGElement, view: View, stageRect: DOMRect): Map<string, Point> => {
  const centres = new Map<string, Point>();
  svg.querySelectorAll('g.node').forEach((element) => {
    const key = nodeKey(element);
    const node = key ? view.nodes[+key.slice(1)] : undefined;
    if (!node) return;
    const { x, y } = centreInStage(element, stageRect);
    centres.set(node.id, { x, y });
  });
  return centres;
};

/** Whether `element` positions itself with a transform attribute (Mermaid does); a CSS transform would replace it. */
const hasOwnTransform = (element: Element): boolean => element.hasAttribute('transform');

/**
 * Animate the freshly mounted svg from the old layout. `scale` is the canvas scale, converting screen pixels to svg units.
 * `origin` is where new nodes start (the acted-on node's old position). Does nothing where the Web Animations API is missing.
 */
export const animateRelayout = (
  svg: SVGSVGElement, view: View, before: Map<string, Point>, origin: Point | undefined, scale: number, stageRect: DOMRect,
): void => {
  if (typeof svg.animate !== 'function' || !before.size || !scale) return;
  const options: KeyframeAnimationOptions = { duration: MOTION_MS, easing: 'ease-in-out' };
  svg.querySelectorAll('g.node').forEach((element) => {
    const key = nodeKey(element);
    const node = key ? view.nodes[+key.slice(1)] : undefined;
    if (!node || hasOwnTransform(element)) return;
    const now = centreInStage(element, stageRect);
    const old = before.get(node.id);
    const start = old ?? origin;
    if (!start) { element.animate([{ opacity: 0 }, { opacity: 1 }], options); return; }
    const from = `translate(${(start.x - now.x) / scale}px, ${(start.y - now.y) / scale}px)`;
    element.animate([{ transform: from, opacity: old ? 1 : 0 }, { transform: 'translate(0px, 0px)', opacity: 1 }], options);
  });
  // edges and form boxes have no stable identity across layouts: let them appear once the nodes are nearly in place
  svg.querySelectorAll('g.edge, g.cluster').forEach((element) => {
    element.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], options);
  });
};
