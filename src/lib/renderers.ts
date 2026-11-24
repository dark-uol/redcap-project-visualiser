/* Graph renderers: Graphviz (@viz-js/viz) and Mermaid, both loaded lazily on first use. */

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
