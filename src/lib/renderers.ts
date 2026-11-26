/* Graph renderers: Graphviz (@viz-js/viz) and Mermaid, both loaded lazily on first use. */
import type { EventDef, Renderer, View, ViewOptions } from './types';

const loadViz = () => import('@viz-js/viz').then((m) => m.instance());

const loadMermaid = () =>
  import('mermaid').then((m) => {
    const mermaid = m.default;
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'loose', maxTextSize: 5e6, maxEdges: 20000,
      flowchart: { htmlLabels: false, useMaxWidth: false }, theme: 'default',
    });
    return mermaid;
  });

let vizPromise: ReturnType<typeof loadViz> | null = null;
let mermaidPromise: ReturnType<typeof loadMermaid> | null = null;

/** Render DOT source to an SVG element. */
export async function renderDot(src: string): Promise<SVGSVGElement> {
  if (!vizPromise) vizPromise = loadViz();
  let viz: Awaited<ReturnType<typeof loadViz>>;
  try { viz = await vizPromise; } catch (e) { vizPromise = null; throw e; }
  return viz.renderSVGElement(src);
}

/** Render Mermaid source to an SVG element. `id` must be unique per call. */
export async function renderMermaid(id: string, src: string): Promise<SVGSVGElement | null> {
  if (!mermaidPromise) mermaidPromise = loadMermaid();
  let mermaid: Awaited<ReturnType<typeof loadMermaid>>;
  try { mermaid = await mermaidPromise; } catch (e) { mermaidPromise = null; throw e; }
  const out = await mermaid.render(id, src);
  const d = document.createElement('div');
  d.innerHTML = out.svg;
  return d.querySelector('svg');
}

/** Lay the view out with one of our own engines and draw it as a Graphviz-shaped SVG element (loaded lazily, like the other renderers). */
export async function renderLayout(engine: 'swimlane' | 'elk', view: View, options: ViewOptions, events: EventDef[]): Promise<SVGSVGElement> {
  const layout = engine === 'elk'
    ? await import('./layoutElk').then((module) => module.layoutElk(view, options, events))
    : await import('./layoutSwimlane').then((module) => module.layoutSwimlane(view, events));
  const { layoutToSvg } = await import('./layoutToSvg');
  const document = new DOMParser().parseFromString(layoutToSvg(layout, view, options), 'image/svg+xml');
  return document.documentElement as unknown as SVGSVGElement;
}

/** What an engine needs to draw: the DOT or Mermaid source for the external engines, the view, options and events for our own. */
export interface EngineInput {
  source: string;
  view: View | null;
  options: ViewOptions | null;
  events: EventDef[];
  /** Unique id for each Mermaid render. */
  mermaidId: string;
}

/** Draw with the named engine; null when there is nothing to draw (Mermaid found no svg, or a layout engine has no view). */
export async function renderEngine(name: Renderer, input: EngineInput): Promise<SVGSVGElement | null> {
  if (name === 'graphviz') return renderDot(input.source);
  if (name === 'mermaid') return renderMermaid(input.mermaidId, input.source);
  return input.view && input.options ? renderLayout(name, input.view, input.options, input.events) : null;
}
