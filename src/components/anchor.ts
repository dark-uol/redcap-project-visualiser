/* Keeps zoom and the acted-on node in place across expand/collapse. No Solid, no store. */
import { groupFormIdOf, groupIdFor } from '../lib/selection';
import type { View } from '../lib/types';
import { centreInStage, clusterEl, nodeKey } from './svgDom';
import { zoomToBox, type Pan } from './panzoom';

/** Where the graph was when a node was acted on, so re-rendering can keep that node in place. */
export interface Anchor {
  target: string;
  scale: number;
  time: number;
  zoom: boolean;
  stageX?: number;
  stageY?: number;
}

export interface AnchorOptions {
  /** Zoom onto the acted-on form box after restoring; remembers the scale to return to. */
  zoom?: boolean;
  /** Restore the scale remembered by an earlier zoom on the same target. */
  back?: boolean;
}

/** Anchors older than this are ignored and the graph is fitted instead. */
export const ANCHOR_STALE_MS = 15000;

export interface AnchorControllerDeps {
  getSvg: () => SVGSVGElement | null;
  getView: () => View | null;
  getStage: () => HTMLElement;
  getCanvas: () => HTMLElement;
  getPan: () => Pan;
  setPan: (next: Pan) => void;
  applyTransform: () => void;
  fitToStage: () => void;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
}

export interface AnchorController {
  capture: (target: string, options?: AnchorOptions) => void;
  restoreOrFit: () => void;
}

export const createAnchorController = (deps: AnchorControllerDeps): AnchorController => {
  const now = deps.now ?? Date.now;
  let pendingAnchor: Anchor | null = null;
  const zoomBack = new Map<string, number>();

  const stageSize = () => ({ w: deps.getStage().clientWidth, h: deps.getStage().clientHeight });

  /** The element drawn for `target`: a node, a form box (cluster), or a form that is now drawn as a box of fields. */
  const elementFor = (target: string): Element | null => {
    const svg = deps.getSvg(), view = deps.getView();
    if (!svg || !view) return null;
    const formId = groupFormIdOf(target);
    if (formId !== null) {
      const groupIndex = view.groups.findIndex((group) => group.id === formId);
      return groupIndex < 0 ? null : clusterEl(svg, groupIndex);
    }
    const nodeIndex = view.nodes.findIndex((node) => node.id === target);
    if (nodeIndex < 0) { // a form that is now drawn as a box of fields
      const groupIndex = view.groups.findIndex((group) => group.id === target);
      return groupIndex < 0 ? null : clusterEl(svg, groupIndex);
    }
    return [...svg.querySelectorAll('g.node')].find((node) => nodeKey(node) === 'n' + nodeIndex) || null;
  };

  const capture = (target: string, options: AnchorOptions = {}): void => {
    if (!deps.getSvg()) { pendingAnchor = null; return; }
    const element = elementFor(target), stageRect = deps.getStage().getBoundingClientRect();
    const pan = deps.getPan();
    const anchor: Anchor = { target, scale: pan.scale, time: now(), zoom: !!options.zoom };
    if (options.zoom) zoomBack.set(target, pan.scale);
    if (options.back && zoomBack.has(target)) {
      anchor.scale = zoomBack.get(target) as number;
      zoomBack.delete(target);
    }
    if (element) {
      const centre = centreInStage(element, stageRect);
      anchor.stageX = centre.x;
      anchor.stageY = centre.y;
    }
    pendingAnchor = anchor;
  };

  /** Animate: zoom the expanded form's box to fill most of the stage, neighbours stay visible around it. */
  const animateZoomToCluster = (target: string, stageRect: DOMRect): void => {
    const cluster = elementFor(groupIdFor(target));
    if (!cluster) return;
    const canvas = deps.getCanvas();
    const box = centreInStage(cluster, stageRect);
    const next = zoomToBox(deps.getPan(), stageSize(), box.x, box.y, box);
    canvas.style.transition = 'transform .45s ease';
    void canvas.offsetWidth;
    deps.setPan(next);
    deps.applyTransform();
    setTimeout(() => { canvas.style.transition = ''; }, 500);
  };

  const restoreOrFit = (): void => {
    const anchor = pendingAnchor;
    pendingAnchor = null;
    if (!anchor || now() - anchor.time > ANCHOR_STALE_MS) { deps.fitToStage(); return; }
    // Apply the scale with no offset first: the node's position is measured under this transform.
    const pan: Pan = { scale: anchor.scale, x: 0, y: 0 };
    deps.setPan(pan);
    deps.applyTransform();
    const element = elementFor(anchor.target);
    if (!element || anchor.stageX == null || anchor.stageY == null) { deps.fitToStage(); return; }
    const stageRect = deps.getStage().getBoundingClientRect();
    const centre = centreInStage(element, stageRect);
    pan.x = anchor.stageX - centre.x;
    pan.y = anchor.stageY - centre.y;
    deps.applyTransform();
    if (anchor.zoom) animateZoomToCluster(anchor.target, stageRect);
  };

  return { capture, restoreOrFit };
};
