/* Pan / zoom stage: a toolbar (+, −, Fit) over a stage whose canvas holds the children. Holds no app state. */
import { createEffect, onSettled } from 'solid-js';
import type { Element as SolidElement } from 'solid-js';
import { cssTransform, fitPan, zoomPan, type Pan } from './panzoom';

/** Pixels the pointer must travel between mousedown and mouseup before the gesture counts as a drag. */
const DRAG_THRESHOLD_PX = 3;

export type PanZoomStageViewProps = {
  /** Size of the content in stage-canvas pixels; the stage refits whenever either changes. */
  contentWidth: number;
  contentHeight: number;
  /** The content drawn on the canvas. */
  children: SolidElement;
};

/** Presentational: pan (drag), zoom (wheel at the cursor, or the + and − buttons) and Fit for arbitrary children. */
export function PanZoomStageView(props: PanZoomStageViewProps) {
  let stage!: HTMLDivElement;
  let canvas!: HTMLDivElement;
  let pan: Pan = { x: 0, y: 0, scale: 1 };

  const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const applyTransform = (): void => { canvas.style.transform = cssTransform(pan); };
  const fitToStage = (): void => {
    if (!stage.clientWidth) return;
    pan = fitPan(stageSize(), { w: props.contentWidth, h: props.contentHeight });
    applyTransform();
  };
  const zoomAt = (factor: number, clientX?: number, clientY?: number): void => {
    const rect = stage.getBoundingClientRect();
    pan = zoomPan(pan, factor, clientX == null ? rect.width / 2 : clientX - rect.left, clientY == null ? rect.height / 2 : clientY - rect.top);
    applyTransform();
  };
  const zoomIn = function zoomIn(): void { zoomAt(1.3); };
  const zoomOut = function zoomOut(): void { zoomAt(1 / 1.3); };

  // refit on mount and whenever the content size changes
  // (a frame later, so the stage has been laid out and has a size)
  createEffect(() => [props.contentWidth, props.contentHeight] as const, () => { requestAnimationFrame(fitToStage); });

  /** Wheel zoom, drag to pan, window resize refit and the drag-click guard. Returns a cleanup. */
  const attachListeners = (): (() => void) => {
    let drag: { startX: number; startY: number; panX: number; panY: number } | null = null;
    let movedPx = 0;
    const onWheel = function onWheel(e: WheelEvent): void { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
    const onDown = function onDown(e: MouseEvent): void {
      drag = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      movedPx = 0;
      stage.classList.add('drag');
    };
    const onMove = function onMove(e: MouseEvent): void {
      if (!drag) return;
      movedPx = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      pan = { ...pan, x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) };
      applyTransform();
    };
    const onUp = function onUp(): void { drag = null; stage.classList.remove('drag'); };
    // capture phase on the stage: a click that ends a drag never reaches the children
    const onClickCapture = function onClickCapture(e: MouseEvent): void { if (movedPx > DRAG_THRESHOLD_PX) e.stopPropagation(); };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('mousedown', onDown);
    stage.addEventListener('click', onClickCapture, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', fitToStage);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('mousedown', onDown);
      stage.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', fitToStage);
    };
  };

  onSettled(attachListeners);

  return (
    <div style="display:flex;flex-direction:column;flex:1;min-width:0;min-height:0">
      <div class="graphbar">
        <span class="grow"></span>
        <button class="btn sm" title="Zoom in" onClick={zoomIn}>+</button>
        <button class="btn sm" title="Zoom out" onClick={zoomOut}>−</button>
        <button class="btn sm" onClick={fitToStage}>Fit</button>
      </div>
      <div id="stage" ref={(el) => (stage = el)}>
        <div id="canvas" ref={(el) => (canvas = el)} style={{ width: `${props.contentWidth}px`, height: `${props.contentHeight}px` }}>
          {props.children}
        </div>
      </div>
    </div>
  );
}
