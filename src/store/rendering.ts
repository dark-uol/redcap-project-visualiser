/* Graph rendering: the render effect and the async render with stale-result discarding. */
import { createEffect } from 'solid-js';
import { errorMessage } from './common';
import type { RenderInput } from './common';
import type { Derived } from './derived';
import type { State } from './state';
import { renderEngine } from '../lib/renderers';

export function setupRendering(state: State, derived: Derived): void {
  const { setSvgEl, setSvgView, setBusy, setRenderMsg } = state;
  const { effectiveRenderer, graphSrc, tooBig, graphStatus, view, opts } = derived;
  const { model } = state;

  // untracked: monotonic id so a stale async render is discarded when a newer one has started
  let token = 0;
  let svgNow: SVGSVGElement | null = null; // mirrors svgEl for the (untracked) render step below
  const setSvg = (v: SVGSVGElement | null): void => { svgNow = v; setSvgEl(v); };
  createEffect(
    (): RenderInput => ({ source: graphSrc(), rendererName: effectiveRenderer(), tooBig: tooBig(), status: graphStatus(), view: view(), options: opts(), events: model()?.parsed.events ?? [] }),
    (input) => { renderGraph(input); },
  );
  async function renderGraph(input: RenderInput): Promise<void> {
    const { source, rendererName, tooBig: big, status, view: v, options, events } = input;
    if (source == null) return;
    const renderToken = ++token;
    const clear = (msg: string): void => { setBusy(false); setSvg(null); setSvgView(null); setRenderMsg(msg); };
    if (status) { clear(status); return; }
    if (big) { clear(''); return; }
    setRenderMsg(svgNow ? '' : 'Rendering…');
    setBusy(true); // keep the previous SVG on screen (dimmed) until the new one is ready
    try {
      const svg = await renderEngine(rendererName, { source, view: v, options, events, mermaidId: 'mmd' + renderToken });
      if (!svg) { clear(''); return; }
      if (renderToken !== token) return;
      setRenderMsg(''); setBusy(false); setSvgView(v); setSvg(svg);
    } catch (e) {
      if (renderToken !== token) return;
      clear('Could not render graph: ' + errorMessage(e) + ' (check your network connection). The Mermaid and DOT downloads still work.');
    }
  }
}
