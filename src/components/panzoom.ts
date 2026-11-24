/* Pure pan/zoom maths for the graph stage: transforms in, transforms out. */

export type Pan = { x: number; y: number; scale: number };
export interface Size { w: number; h: number }

export const MIN_SCALE = 0.02;
const MAX_ZOOM = 10;       // wheel / button zoom limit
const MAX_BOX_ZOOM = 6;    // limit when zooming onto a form box
const MAX_FIT = 1.5;       // never enlarge a small graph beyond this when fitting
const FIT_MARGIN = 0.96;   // leave a little breathing room around a fitted graph
export const clampScale = (scale: number, max: number): number => Math.min(max, Math.max(MIN_SCALE, scale));

/** CSS transform for a pan. */
export const cssTransform = (p: Pan): string => `translate(${p.x}px,${p.y}px) scale(${p.scale})`;

/** Centre `content` in `stage`, shrinking (or modestly enlarging) it to fit. */
export const fitPan = (stage: Size, content: Size): Pan => {
  const scale = Math.min(stage.w / content.w, stage.h / content.h, MAX_FIT) * FIT_MARGIN;
  return { scale, x: (stage.w - content.w * scale) / 2, y: (stage.h - content.h * scale) / 2 };
};

/** Zoom by factor `f` keeping the stage point (px, py) fixed. */
export const zoomPan = (p: Pan, f: number, px: number, py: number): Pan => {
  const scale = clampScale(p.scale * f, MAX_ZOOM);
  return { scale, x: px - (px - p.x) * (scale / p.scale), y: py - (py - p.y) * (scale / p.scale) };
};

/** Zoom so a box (centre cx, cy and size, in stage px) fills `fill` of the stage, centred. */
export const zoomToBox = (p: Pan, stage: Size, cx: number, cy: number, box: Size, fill = 0.7): Pan => {
  const scale = clampScale(p.scale * Math.min(stage.w * fill / box.w, stage.h * fill / box.h), MAX_BOX_ZOOM);
  const f = scale / p.scale;
  return { scale, x: stage.w / 2 - (cx - p.x) * f, y: stage.h / 2 - (cy - p.y) * f };
};
