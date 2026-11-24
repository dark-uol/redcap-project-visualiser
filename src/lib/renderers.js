/* Graph renderers: Graphviz (@viz-js/viz) and Mermaid, both loaded lazily on first use. */
let vizPromise = null;
let mermaidPromise = null;

/** Render DOT source to an SVG element. */
export async function renderDot(src) {
  if (!vizPromise) vizPromise = import('@viz-js/viz').then((m) => m.instance());
  let viz;
  try { viz = await vizPromise; } catch (e) { vizPromise = null; throw e; }
  return viz.renderSVGElement(src);
}

/** Render Mermaid source to an SVG element. `id` must be unique per call. */
export async function renderMermaid(id, src) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', maxTextSize: 5e6, maxEdges: 20000, flowchart: { htmlLabels: false, useMaxWidth: false }, theme: 'default' });
      return mermaid;
    });
  }
  let mermaid;
  try { mermaid = await mermaidPromise; } catch (e) { mermaidPromise = null; throw e; }
  const out = await mermaid.render(id, src);
  const d = document.createElement('div');
  d.innerHTML = out.svg;
  return d.querySelector('svg');
}
