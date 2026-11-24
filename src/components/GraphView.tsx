/* Graph tab: pan / zoom stage showing the rendered SVG, link highlighting and click selection. */
import { Show, createEffect, onCleanup, onSettled } from 'solid-js';
import type { View, ViewNode } from '../lib/types';
import {
  model, view, tab, selected, setSelected, setSelectedRaw, setSelEdge, svgEl, svgView, busy, renderMsg, tooBig,
  setForcedFor, dotSrc, setAnchorCapture,
} from '../store';
import Detail from './Detail';
import Legend from './Legend';
import {
  clusterEl, closestEl, highlightLinks, keyForSelection, nodeKey, normalizeSvg, widenEdgeHits,
} from './svgDom';
import { resolveClick } from './hitTest';
import { cssTransform, fitPan, zoomPan, zoomToBox, type Pan } from './panzoom';

/** Where the graph was when a node was acted on, so re-rendering can keep that node in place. */
interface Anchor {
  target: string;
  scale: number;
  time: number;
  zoom: boolean;
  stageX?: number;
  stageY?: number;
}

export default function GraphView() {
  let stage!: HTMLDivElement;
  let canvas!: HTMLDivElement;
  let pan: Pan = { x: 0, y: 0, scale: 1 };
  // latest committed svg / view / selection, mirrored by the effects below so helpers and listeners need no signal reads
  let pendingAnchor: Anchor | null = null;
  const zoomBack = new Map<string, number>();
  let currentSvg: SVGSVGElement | null = null;
  let currentView: View | null = null;
  let currentSelection: string | null = null;
  let hover: string | null = null;

  const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const applyTransform = (): void => { canvas.style.transform = cssTransform(pan); };
  const fitToStage = (): void => {
    const s = currentSvg;
    if (!s || !stage.clientWidth) return;
    pan = fitPan(stageSize(), { w: +(s.dataset.w || 0), h: +(s.dataset.h || 0) });
    applyTransform();
  };
  const zoomAt = (f: number, cx?: number, cy?: number): void => {
    const r = stage.getBoundingClientRect();
    pan = zoomPan(pan, f, cx == null ? r.width / 2 : cx - r.left, cy == null ? r.height / 2 : cy - r.top);
    applyTransform();
  };

  /** Centre of `el` in stage coordinates. */
  const centreInStage = (el: Element, stageRect: DOMRect): { x: number; y: number; w: number; h: number } => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - stageRect.left, y: r.top + r.height / 2 - stageRect.top, w: r.width, h: r.height };
  };

  // ---- keep zoom and the acted-on node in place across expand/collapse ----
  const elementFor = (target: string): Element | null => {
    const s = currentSvg, v = currentView;
    if (!s || !v) return null;
    if (target.startsWith('@form:')) {
      const groupIndex = v.groups.findIndex((g) => g.id === target.slice(6));
      return groupIndex < 0 ? null : clusterEl(s, groupIndex);
    }
    const nodeIndex = v.nodes.findIndex((n) => n.id === target);
    if (nodeIndex < 0) { // a form that is now drawn as a box of fields
      const groupIndex = v.groups.findIndex((g) => g.id === target);
      return groupIndex < 0 ? null : clusterEl(s, groupIndex);
    }
    return [...s.querySelectorAll('g.node')].find((n) => nodeKey(n) === 'n' + nodeIndex) || null;
  };
  setAnchorCapture((target, options = {}) => {
    if (!currentSvg) { pendingAnchor = null; return; }
    const el = elementFor(target), stageRect = stage.getBoundingClientRect();
    const anchor: Anchor = { target, scale: pan.scale, time: Date.now(), zoom: !!options.zoom };
    if (options.zoom) zoomBack.set(target, pan.scale);
    if (options.back && zoomBack.has(target)) {
      anchor.scale = zoomBack.get(target) as number;
      zoomBack.delete(target);
    }
    if (el) {
      const c = centreInStage(el, stageRect);
      anchor.stageX = c.x;
      anchor.stageY = c.y;
    }
    pendingAnchor = anchor;
  });
  onCleanup(() => setAnchorCapture(null));
  const restoreOrFit = (): void => {
    const anchor = pendingAnchor;
    pendingAnchor = null;
    if (!anchor || Date.now() - anchor.time > 15000) { fitToStage(); return; }
    pan = { scale: anchor.scale, x: 0, y: 0 };
    applyTransform();
    const el = elementFor(anchor.target);
    if (!el || anchor.stageX == null || anchor.stageY == null) { fitToStage(); return; }
    const stageRect = stage.getBoundingClientRect();
    const c = centreInStage(el, stageRect);
    pan.x = anchor.stageX - c.x;
    pan.y = anchor.stageY - c.y;
    applyTransform();
    if (anchor.zoom) { // animate: zoom the expanded form's box to fill most of the stage, neighbours stay visible around it
      const cluster = elementFor('@form:' + anchor.target);
      if (!cluster) return;
      const box = centreInStage(cluster, stageRect);
      const next = zoomToBox(pan, stageSize(), box.x, box.y, box);
      canvas.style.transition = 'transform .45s ease';
      void canvas.offsetWidth;
      pan = next;
      applyTransform();
      setTimeout(() => { canvas.style.transition = ''; }, 500);
    }
  };

  // ---- highlight a node's direct links (hover, or the selected node) ----
  const applyHighlight = (): void => {
    const s = currentSvg;
    if (!s) return;
    highlightLinks(s, hover ?? (currentSelection && currentView ? keyForSelection(currentView.nodes, currentSelection) : null));
  };

  // new svg: mount it, restore / fit the view, widen form-level edge hit areas, re-apply highlighting
  createEffect(
    () => [svgEl(), svgView()] as const,
    ([s, drawnView]) => {
      currentSvg = s;
      currentView = drawnView;
      canvas.innerHTML = '';
      if (!s) return;
      normalizeSvg(s);
      canvas.appendChild(s);
      restoreOrFit();
      if (drawnView && drawnView.level === 'form') widenEdgeHits(s);
      applyHighlight();
    },
  );
  createEffect(selected, (sel) => { currentSelection = sel; applyHighlight(); });

  createEffect(busy, (b) => { stage.classList.toggle('busy', b); });
  // refit only when returning to the tab; opening the detail panel must not change the view
  createEffect(tab, () => { requestAnimationFrame(fitToStage); }, { defer: true });

  onSettled(() => {
    let drag: { x: number; y: number } | null = null;
    let moved = 0;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
    const onDown = (e: MouseEvent) => { drag = { x: e.clientX - pan.x, y: e.clientY - pan.y }; moved = 0; stage.classList.add('drag'); };
    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      moved++;
      pan.x = e.clientX - drag.x;
      pan.y = e.clientY - drag.y;
      applyTransform();
    };
    const onUp = () => { drag = null; stage.classList.remove('drag'); };
    const onOver = (e: MouseEvent) => {
      const g = closestEl(e.target, 'g.node');
      const k = g ? nodeKey(g) : null;
      if (k !== hover) { hover = k; applyHighlight(); }
    };
    const onLeave = () => { if (hover) { hover = null; applyHighlight(); } };
    const onClick = (e: MouseEvent) => {
      if (moved > 4) return;
      const drawnView = currentView;
      if (!drawnView) return;
      const act = resolveClick(e.target, drawnView, (id) => !!model()?.formsById.has(id));
      if (act.type === 'edge') { setSelectedRaw(null); setSelEdge({ from: act.from, to: act.to }); }
      else if (act.type === 'select') setSelected(act.id);
      else if (act.type === 'clear') { setSelected(null); setSelEdge(null); } // empty background closes the detail pane
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', fitToStage);
    stage.addEventListener('mouseover', onOver);
    stage.addEventListener('mouseleave', onLeave);
    stage.addEventListener('click', onClick);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('mousedown', onDown);
      stage.removeEventListener('mouseover', onOver);
      stage.removeEventListener('mouseleave', onLeave);
      stage.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', fitToStage);
    };
  });

  return (
    <div>
      <div class="graphbar">
        <span class="muted">{view() ? `${view()?.nodes.length} nodes · ${view()?.edges.length} edges` : ''}</span><span class="grow"></span>
        <button class="btn sm" title="Zoom in" onClick={() => zoomAt(1.3)}>+</button>
        <button class="btn sm" title="Zoom out" onClick={() => zoomAt(1 / 1.3)}>−</button>
        <button class="btn sm" onClick={fitToStage}>Fit</button>
      </div>
      <div id="graphwrap">
        <div id="stage" ref={(el) => (stage = el)}>
          <Show when={renderMsg() || tooBig()}>
            <div id="msg">
              <Show when={tooBig()} fallback={<div>{renderMsg()}</div>}>
                <div>Large graph ({view()?.edges.length} edges). Rendering may be slow.<br /><br />
                  <button class="btn primary" onClick={() => setForcedFor(dotSrc())}>Render anyway</button><br /><br />
                  <span class="muted small">Or narrow it with the filters / focus, or just download the .mmd / .dot files.</span></div>
              </Show>
            </div>
          </Show>
          <div id="canvas" ref={(el) => (canvas = el)}></div>
        </div>
        <Detail />
      </div>
      <Legend />
    </div>
  );
}
