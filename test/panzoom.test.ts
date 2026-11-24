import { describe, expect, it } from 'vitest';
import { clampScale, cssTransform, fitPan, MIN_SCALE, zoomPan, zoomToBox } from '../src/components/panzoom';

describe('fitPan', () => {
  it('centres content and leaves a margin', () => {
    const p = fitPan({ w: 1000, h: 500 }, { w: 2000, h: 500 });
    expect(p.scale).toBeCloseTo(0.5 * 0.96);
    expect(p.x).toBeCloseTo((1000 - 2000 * p.scale) / 2);
    expect(p.y).toBeCloseTo((500 - 500 * p.scale) / 2);
  });
  it('never enlarges beyond 1.5x', () => {
    expect(fitPan({ w: 1000, h: 1000 }, { w: 10, h: 10 }).scale).toBeLessThanOrEqual(1.5);
  });
  it('is limited by the tighter dimension', () => {
    expect(fitPan({ w: 1000, h: 100 }, { w: 1000, h: 1000 }).scale).toBeCloseTo(0.1 * 0.96);
  });
});

describe('zoomPan', () => {
  it('keeps the anchor point fixed', () => {
    const p = { x: 40, y: 20, scale: 1 };
    const q = zoomPan(p, 2, 300, 200);
    expect((300 - q.x) / q.scale).toBeCloseTo((300 - p.x) / p.scale);
    expect((200 - q.y) / q.scale).toBeCloseTo((200 - p.y) / p.scale);
  });
  it('is clamped at both ends', () => {
    expect(zoomPan({ x: 0, y: 0, scale: 9 }, 5, 0, 0).scale).toBe(10);
    expect(zoomPan({ x: 0, y: 0, scale: 0.03 }, 0.01, 0, 0).scale).toBe(MIN_SCALE);
    expect(clampScale(-1, 10)).toBe(MIN_SCALE);
  });
});

describe('zoomToBox', () => {
  const stage = { w: 800, h: 600 };
  it('centres the box on the stage', () => {
    const p = { x: 0, y: 0, scale: 1 };
    const q = zoomToBox(p, stage, 100, 100, { w: 200, h: 100 });
    expect(q.x + 100 * (q.scale / p.scale)).toBeCloseTo(400);
    expect(q.y + 100 * (q.scale / p.scale)).toBeCloseTo(300);
  });
  it('makes the box fill 70% of the tighter dimension', () => {
    const q = zoomToBox({ x: 0, y: 0, scale: 1 }, stage, 0, 0, { w: 400, h: 100 });
    expect(400 * q.scale).toBeCloseTo(800 * 0.7);
  });
  it('caps the zoom at 6x', () => {
    expect(zoomToBox({ x: 0, y: 0, scale: 1 }, stage, 0, 0, { w: 1, h: 1 }).scale).toBe(6);
  });
});

describe('cssTransform', () => {
  it('formats translate and scale', () => {
    expect(cssTransform({ x: 1, y: 2, scale: 3 })).toBe('translate(1px,2px) scale(3)');
  });
});
