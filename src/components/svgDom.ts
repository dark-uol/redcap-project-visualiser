/* Helpers for reading the rendered graph SVG (Graphviz titles or Mermaid ids). No Solid, no store. */
import { groupIdFor } from '../lib/selection';
import type { ViewGroup, ViewNode } from '../lib/types';

/** Nearest ancestor-or-self of an event target matching `sel` (targets may be non-elements, e.g. text). */
export const closestEl = (t: EventTarget | null, sel: string): Element | null => (t instanceof Element ? t.closest(sel) : null);

/** Selector matching an edge in either renderer. */
export const EDGE_SEL = 'g.edge, path.flowchart-link';

/** Node key (`n<index>`) of a `g.node` element. */
export const nodeKey = (g: Element): string | null => {
  const keyed = g.getAttribute('data-key'); // layout-engine SVGs carry their key directly
  if (keyed) return keyed;
  const t = g.querySelector('title');
  if (t && /^n\d+$/.test(t.textContent ?? '')) return t.textContent;
  const m = /-(n\d+)-/.exec(g.id || '');
  return m ? m[1] : null;
};

/** `[from, to]` node keys of an edge element. */
export const edgeKey = (g: Element): [string, string] | null => {
  const t = g.querySelector('title');
  let m: RegExpExecArray | null = /^(n\d+)->(n\d+)$/.exec(g.getAttribute('data-key') ?? '') ?? (t ? /^(n\d+)->(n\d+)$/.exec(t.textContent ?? '') : null);
  if (m) return [m[1], m[2]];
  m = /L[_-](n\d+)[_-](n\d+)/.exec(g.id || '');
  return m ? [m[1], m[2]] : null;
};

/** Selector matching every box drawn for a group: the `g.cluster`, plus the `g.cluster-part` extras the swimlane engine
 * draws when a form's fields sit in several event columns. */
export const CLUSTER_SEL = 'g.cluster, g.cluster-part';

/** Index of the group a `g.cluster` or `g.cluster-part` element draws. */
export const clusterIndex = (g: Element): number | null => {
  const t = g.querySelector('title');
  const m = /^cluster_(\d+)$/.exec(g.getAttribute('data-key') ?? '') || (t && /^cluster_(\d+)$/.exec(t.textContent ?? '')) || /(?:^|[-_])g(\d+)$/.exec(g.id || '');
  return m ? +m[1] : null;
};

/** Graphviz cluster element for group index `groupIndex`. */
export const clusterEl = (s: SVGSVGElement, groupIndex: number): Element | null =>
  [...s.querySelectorAll('g.cluster')].find((c) => (c.getAttribute('data-key') ?? c.querySelector('title')?.textContent) === 'cluster_' + groupIndex) ?? null;

/** Size the svg to its viewBox (adding one if missing) and record the size in data attributes. */
export const normalizeSvg = (s: SVGSVGElement): void => {
  s.removeAttribute('style');
  const viewBox = s.viewBox.baseVal;
  const w = viewBox && viewBox.width ? viewBox.width : parseFloat(s.getAttribute('width') ?? '') || 800;
  const h = viewBox && viewBox.height ? viewBox.height : parseFloat(s.getAttribute('height') ?? '') || 600;
  if (!viewBox || !viewBox.width) s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(h));
  s.dataset.w = String(w);
  s.dataset.h = String(h);
};

/** Widen the clickable area of edges (thin lines are hard to hit). */
export const widenEdgeHits = (s: SVGSVGElement): void => {
  s.querySelectorAll('g.edge').forEach((g) => {
    const p = g.querySelector('path');
    if (!p) return;
    const hitPath = p.cloneNode() as SVGPathElement;
    hitPath.removeAttribute('marker-end');
    hitPath.setAttribute('class', 'edge-hit'); // styled in css/style.css; replaces the visible line's classes so they do not apply
    hitPath.removeAttribute('stroke'); // Graphviz and Mermaid paths carry presentation attributes; the class rule supplies the rest
    hitPath.removeAttribute('stroke-width');
    hitPath.removeAttribute('stroke-dasharray');
    g.appendChild(hitPath);
  });
};

export const isFormLike = (n: ViewNode | undefined, formIds: (id: string) => boolean): n is ViewNode =>
  !!n && n.kind !== 'field' && n.kind !== 'calc' && n.kind !== 'status' && (formIds(n.form || n.id) || n.id === '(unknown)');

/** Above this many nodes, link highlighting is skipped (too slow to toggle classes per hover). */
const MAX_HL_NODES = 2500;

/** Node key (`n<index>`) of the view node drawn for `sel` (a full node id or a bare field name). */
export const keyForSelection = (nodes: ViewNode[], sel: string): string | null => {
  let i = nodes.findIndex((n) => n.id === sel);
  if (i < 0) i = nodes.findIndex((n) => n.field && n.field === sel);
  return i >= 0 ? 'n' + i : null;
};

/** Mark the node `key` and its direct links / neighbours with class `on` (and `hl` on the svg); clears all when null. */
export const highlightLinks = (s: SVGSVGElement, key: string | null): void => {
  const nodes = s.querySelectorAll('g.node'), edges = s.querySelectorAll(EDGE_SEL);
  if (!key || nodes.length > MAX_HL_NODES) {
    s.classList.remove('hl');
    nodes.forEach((n) => n.classList.remove('on'));
    edges.forEach((n) => n.classList.remove('on'));
    return;
  }
  const keep = new Set<string>([key]);
  edges.forEach((el) => {
    const k = edgeKey(el), on = !!k && (k[0] === key || k[1] === key);
    el.classList.toggle('on', on);
    if (on && k) { keep.add(k[0]); keep.add(k[1]); }
  });
  nodes.forEach((n) => {
    const elKey = nodeKey(n);
    n.classList.toggle('on', elKey !== null && keep.has(elKey));
  });
  s.classList.add('hl');
};

/** Centre of `element` in stage coordinates, plus its on-screen size. Reads the element's current layout. */
export const centreInStage = (element: Element, stageRect: DOMRect): { x: number; y: number; w: number; h: number } => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - stageRect.left,
    y: rect.top + rect.height / 2 - stageRect.top,
    w: rect.width,
    h: rect.height,
  };
};

/** Mark the form or event box the selection stands for (an expanded node is drawn as a box, not a node) with class `on`. */
export const highlightCluster = (s: SVGSVGElement, groups: ViewGroup[], selection: string | null): void => {
  const groupIndex = selection === null ? -1 : groups.findIndex((group) => group.id === selection || groupIdFor(group.id) === selection);
  s.querySelectorAll(CLUSTER_SEL).forEach((element) => {
    element.classList.toggle('on', groupIndex >= 0 && clusterIndex(element) === groupIndex);
  });
};
