/* Graph tab: pan / zoom stage showing the rendered SVG, link highlighting and click selection. */
import { Show, createEffect, onCleanup, onSettled } from 'solid-js';
import type { View } from '../lib/types';
import {
  model, view, tab, selected, setSelected, setSelectedRaw, setSelectedEdge, svgEl, svgView, busy, renderMsg, tooBig,
  setForcedFor, dotSrc, setAnchorCapture,
} from '../store';
import Detail from './Detail';
import Legend from './Legend';
import { closestEl, highlightLinks, keyForSelection, nodeKey, normalizeSvg, widenEdgeHits } from './svgDom';
import { resolveClick } from './hitTest';
import { cssTransform, fitPan, zoomPan, type Pan } from './panzoom';
import { createAnchorController } from './anchor';

export default function GraphView() {
  let stage!: HTMLDivElement;
  let canvas!: HTMLDivElement;
  let pan: Pan = { x: 0, y: 0, scale: 1 };
  /*
   * Mirrors of the latest committed svg, view, selection and hover. The effects below and the hover listener write
   * them, so event listeners and the highlight/anchor helpers can read them synchronously without subscribing to
   * signals (reading a signal inside a listener or an effect would track it). Hover is not a store signal because it
   * changes on every mouse move and must not re-run anything.
   */
  const state: { svg: SVGSVGElement | null; view: View | null; selection: string | null; hover: string | null } = {
    svg: null, view: null, selection: null, hover: null,
  };

  const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const applyTransform = (): void => { canvas.style.transform = cssTransform(pan); };
  const fitToStage = (): void => {
    const svg = state.svg;
    if (!svg || !stage.clientWidth) return;
    pan = fitPan(stageSize(), { w: +(svg.dataset.w || 0), h: +(svg.dataset.h || 0) });
    applyTransform();
  };
  const zoomAt = (factor: number, clientX?: number, clientY?: number): void => {
    const rect = stage.getBoundingClientRect();
    pan = zoomPan(pan, factor, clientX == null ? rect.width / 2 : clientX - rect.left, clientY == null ? rect.height / 2 : clientY - rect.top);
    applyTransform();
  };

  // ---- keep zoom and the acted-on node in place across expand/collapse ----
  const setPan = (next: Pan): void => { pan = next; };
  const anchor = createAnchorController({
    getSvg: () => state.svg,
    getView: () => state.view,
    getStage: () => stage,
    getCanvas: () => canvas,
    getPan: () => pan,
    setPan,
    applyTransform,
    fitToStage,
  });
  setAnchorCapture(anchor.capture);
  onCleanup(() => setAnchorCapture(null));

  // ---- highlight a node's direct links (hover, or the selected node) ----
  const applyHighlight = (): void => {
    const svg = state.svg;
    if (!svg) return;
    highlightLinks(svg, state.hover ?? (state.selection && state.view ? keyForSelection(state.view.nodes, state.selection) : null));
  };

  // new svg: mount it, restore / fit the view, widen form-level edge hit areas, re-apply highlighting
  const mountSvg = ([svg, drawnView]: readonly [SVGSVGElement | null, View | null]): void => {
    state.svg = svg;
    state.view = drawnView;
    canvas.innerHTML = '';
    if (!svg) return;
    normalizeSvg(svg);
    canvas.appendChild(svg);
    anchor.restoreOrFit();
    if (drawnView && drawnView.level === 'form') widenEdgeHits(svg);
    applyHighlight();
  };
  const mirrorSelection = (sel: string | null): void => { state.selection = sel; applyHighlight(); };
  createEffect(() => [svgEl(), svgView()] as const, mountSvg);
  createEffect(selected, mirrorSelection);

  createEffect(busy, (b) => { stage.classList.toggle('busy', b); });
  // refit only when returning to the tab; opening the detail panel must not change the view
  createEffect(tab, () => { requestAnimationFrame(fitToStage); }, { defer: true });

  /** Wheel zoom, drag to pan and window resize. Returns a cleanup, plus the distance moved since the last mousedown. */
  const attachPanZoomListeners = (): { detach: () => void; movedDistance: () => number } => {
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
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', fitToStage);
    return {
      movedDistance: () => moved,
      detach: () => {
        stage.removeEventListener('wheel', onWheel);
        stage.removeEventListener('mousedown', onDown);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('resize', fitToStage);
      },
    };
  };

  /** Hover highlighting and click selection. Clicks that followed a drag (`movedDistance() > 4`) are ignored. */
  const attachSelectionListeners = (movedDistance: () => number): (() => void) => {
    const onOver = (e: MouseEvent) => {
      const hoveredNode = closestEl(e.target, 'g.node');
      const key = hoveredNode ? nodeKey(hoveredNode) : null;
      if (key !== state.hover) { state.hover = key; applyHighlight(); }
    };
    const onLeave = () => { if (state.hover) { state.hover = null; applyHighlight(); } };
    const onClick = (e: MouseEvent) => {
      if (movedDistance() > 4) return;
      const drawnView = state.view;
      if (!drawnView) return;
      const action = resolveClick(e.target, drawnView, (id) => !!model()?.formsById.has(id));
      if (action.type === 'edge') { setSelectedRaw(null); setSelectedEdge({ from: action.from, to: action.to }); }
      else if (action.type === 'select') setSelected(action.id);
      else if (action.type === 'clear') { setSelected(null); setSelectedEdge(null); } // empty background closes the detail pane
    };
    stage.addEventListener('mouseover', onOver);
    stage.addEventListener('mouseleave', onLeave);
    stage.addEventListener('click', onClick);
    return () => {
      stage.removeEventListener('mouseover', onOver);
      stage.removeEventListener('mouseleave', onLeave);
      stage.removeEventListener('click', onClick);
    };
  };

  onSettled(() => {
    const panZoom = attachPanZoomListeners();
    const detachSelection = attachSelectionListeners(panZoom.movedDistance);
    return () => {
      detachSelection();
      panZoom.detach();
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
