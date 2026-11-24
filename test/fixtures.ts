/* Hand-written SVG in the shapes Graphviz and Mermaid produce, plus small View builders. */
import type { View, ViewNode } from '../src/lib/types';

export const svgFrom = (inner: string, attrs = ''): SVGSVGElement => {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
  return host.firstElementChild as SVGSVGElement;
};

/** Graphviz: n0 -> n1, n1 -> n2; one cluster around n0. */
export const graphvizSvg = (): SVGSVGElement => svgFrom(`
  <g class="cluster"><title>cluster_0</title></g>
  <g class="node"><title>n0</title><text>a</text></g>
  <g class="node"><title>n1</title><text>b</text></g>
  <g class="node"><title>n2</title><text>c</text></g>
  <g class="edge"><title>n0->n1</title><path d="M0 0L1 1"/></g>
  <g class="edge"><title>n1->n2</title><path d="M1 1L2 2"/></g>`);

export const node = (id: string, over: Partial<ViewNode> = {}): ViewNode =>
  ({ id, label: id, form: 'f1', kind: 'field', ...over });

export const makeView = (over: Partial<View> = {}): View =>
  ({ level: 'field', nodes: [node('a'), node('b'), node('c')], edges: [], groups: [], ...over });
