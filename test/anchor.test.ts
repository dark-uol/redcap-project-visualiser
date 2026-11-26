import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANCHOR_STALE_MS, createAnchorController } from '../src/components/anchor';
import { type Pan } from '../src/components/panzoom';
import { graphvizSvg, makeView, node } from './fixtures';

/*
 * A fake layout: the content node 'n0' sits at (100, 50) in svg units, 20x10 in size. Its on-screen rect follows the
 * transform last applied to the canvas (livePan), so measuring it after applyTransform behaves like a browser.
 */
const NODE_CENTRE = { x: 100, y: 50 }, NODE_SIZE = { w: 20, h: 10 };

const rectOf = (left: number, top: number, w: number, h: number): DOMRect =>
  ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

interface Harness {
  controller: ReturnType<typeof createAnchorController>;
  stage: HTMLDivElement;
  canvas: HTMLDivElement;
  fitToStage: ReturnType<typeof vi.fn>;
  currentPan: () => Pan;
  livePan: () => Pan;
  clock: { t: number };
  setPanState: (next: Pan) => void;
  nodeElement: Element;
  clusterElement: Element;
}

const makeHarness = (): Harness => {
  const svg = graphvizSvg();
  const view = makeView({
    nodes: [node('a'), node('b'), node('c')],
    groups: [{ id: 'f1', label: 'Form 1', nodes: ['a'] }],
  });
  const stage = document.createElement('div');
  const canvas = document.createElement('div');
  Object.defineProperty(stage, 'clientWidth', { value: 800 });
  Object.defineProperty(stage, 'clientHeight', { value: 600 });
  stage.getBoundingClientRect = () => rectOf(0, 0, 800, 600);

  let pan: Pan = { x: 0, y: 0, scale: 1 };
  let livePan: Pan = { ...pan };
  const applyTransform = vi.fn(() => { livePan = { ...pan }; });
  const fitToStage = vi.fn();
  const clock = { t: 0 };

  const nodeElement = svg.querySelector('g.node') as Element; // n0 is drawn for view node 'a'
  nodeElement.getBoundingClientRect = () => {
    const p = livePan;
    return rectOf(
      p.x + (NODE_CENTRE.x - NODE_SIZE.w / 2) * p.scale,
      p.y + (NODE_CENTRE.y - NODE_SIZE.h / 2) * p.scale,
      NODE_SIZE.w * p.scale,
      NODE_SIZE.h * p.scale,
    );
  };
  const clusterElement = svg.querySelector('g.cluster') as Element; // cluster_0 is group 0 ('f1')
  clusterElement.getBoundingClientRect = () => rectOf(100, 100, 300, 200);

  const controller = createAnchorController({
    getSvg: () => svg,
    getView: () => view,
    getStage: () => stage,
    getCanvas: () => canvas,
    getPan: () => pan,
    setPan: (next) => { pan = next; },
    applyTransform,
    fitToStage,
    now: () => clock.t,
  });

  return {
    controller, stage, canvas, fitToStage,
    currentPan: () => pan,
    livePan: () => livePan,
    clock,
    setPanState: (next) => { pan = next; livePan = { ...next }; },
    nodeElement, clusterElement,
  };
};

/** Stage position of the centre of the node. */
const nodeCentreOnStage = (harness: Harness): { x: number; y: number } => {
  const rect = harness.nodeElement.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

describe('anchor controller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('falls back to fit when the anchor is stale (older than 15s)', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 30, y: 40, scale: 1.5 });
    harness.controller.capture('a');
    harness.clock.t = ANCHOR_STALE_MS + 1;
    harness.controller.restoreOrFit();
    expect(harness.fitToStage).toHaveBeenCalledTimes(1);
    expect(harness.currentPan().scale).toBe(1.5); // the captured pan was not re-applied
  });

  it('still restores an anchor exactly at the 15s limit', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 30, y: 40, scale: 1.5 });
    harness.controller.capture('a');
    harness.clock.t = ANCHOR_STALE_MS;
    harness.setPanState({ x: 0, y: 0, scale: 0.4 });
    harness.controller.restoreOrFit();
    expect(harness.fitToStage).not.toHaveBeenCalled();
    expect(harness.currentPan().scale).toBe(1.5);
  });

  it('restores the last capture: an animation-only capture made after the node capture drops the node', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 30, y: 40, scale: 1.5 });
    harness.controller.capture('a');
    harness.controller.capture(''); // e.g. a filter setter snapshotting the graph afterwards
    harness.controller.restoreOrFit();
    expect(harness.fitToStage).toHaveBeenCalledTimes(1); // fitOnly: the node's place is not kept
  });

  it('fits when there is no pending anchor', () => {
    const harness = makeHarness();
    harness.controller.restoreOrFit();
    expect(harness.fitToStage).toHaveBeenCalledTimes(1);
  });

  it('fits when the target is no longer drawn', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 30, y: 40, scale: 1.5 });
    harness.controller.capture('missing-node');
    harness.controller.restoreOrFit();
    expect(harness.fitToStage).toHaveBeenCalledTimes(1);
  });

  it('keeps the acted-on node at the same stage position after restoring', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 30, y: 40, scale: 1.5 });
    const before = nodeCentreOnStage(harness);
    harness.controller.capture('a');

    // the graph re-renders at a different pan and scale; restoring must bring the node back to where it was
    harness.setPanState({ x: -200, y: 15, scale: 0.7 });
    harness.controller.restoreOrFit();

    const after = nodeCentreOnStage(harness);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(harness.currentPan().scale).toBe(1.5);
    expect(harness.fitToStage).not.toHaveBeenCalled();
  });

  it('stores the scale on zoom and returns to it on a later back capture', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 0, y: 0, scale: 0.5 });
    harness.controller.capture('a', { zoom: true }); // remembers 0.5

    harness.setPanState({ x: 0, y: 0, scale: 3 });
    harness.controller.capture('a', { back: true }); // consumes 0.5
    harness.controller.restoreOrFit();
    expect(harness.currentPan().scale).toBe(0.5);

    // the remembered scale was consumed, so a second back capture uses the current scale
    harness.setPanState({ x: 0, y: 0, scale: 2 });
    harness.controller.capture('a', { back: true });
    harness.controller.restoreOrFit();
    expect(harness.currentPan().scale).toBe(2);
  });

  it('zooms onto the form box and animates the canvas transition when zoom is requested', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 0, y: 0, scale: 1 });
    harness.controller.capture('f1', { zoom: true }); // a bare form id, as the store passes it
    harness.controller.restoreOrFit();
    // the cluster box (300x200 at 100,100) is zoomed to fill most of the 800x600 stage
    expect(harness.currentPan().scale).toBeGreaterThan(1);
    expect(harness.canvas.style.transition).toMatch(/^transform 0?\.45s/); // jsdom normalises the shorthand
    vi.advanceTimersByTime(500);
    expect(harness.canvas.style.transition).toBe('');
  });

  it('does not zoom when the anchor has no zoom flag', () => {
    const harness = makeHarness();
    harness.setPanState({ x: 0, y: 0, scale: 1 });
    harness.controller.capture('a');
    harness.controller.restoreOrFit();
    expect(harness.canvas.style.transition).toBe('');
    expect(harness.currentPan().scale).toBe(1);
  });
});
