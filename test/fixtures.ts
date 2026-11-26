/* Hand-written SVG in the shapes Graphviz and Mermaid produce, plus small View builders. */
import type { Edge, Field, View, ViewNode } from '../src/lib/types';

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

export const field = (over: Partial<Field> = {}): Field => ({
  variable: 'v', oid: 'v', type: 'text', label: 'V', section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form: 'f', ...over,
});

export const edge = (over: Partial<Edge> = {}): Edge => ({ from: 'a', to: 'b', type: 'branching', expr: "[a] = '1'", cross: false, missing: false, ...over });

/** The keys of nodes in a `layoutToSvg` string whose text lines stick out of the node's rect (first line's ascent above it,
 * last line's descent below it). Regex-based so it also runs in the node test environment. */
export const nodesWithOverflowingText = (svg: string): string[] => {
  const overflowing: string[] = [];
  const ascent = 9;
  const descent = 3;
  for (const match of svg.matchAll(/<g class="node" data-key="([^"]*)">(.*?)<\/g>/g)) {
    const rect = /<rect x="[^"]*" y="([^"]*)" width="[^"]*" height="([^"]*)"/.exec(match[2]);
    const baselines = [...match[2].matchAll(/<text [^>]*? y="([^"]*)"/g)].map((textMatch) => Number(textMatch[1]));
    if (!rect || baselines.length === 0) continue;
    const top = Number(rect[1]);
    const bottom = top + Number(rect[2]);
    if (Math.min(...baselines) - ascent < top || Math.max(...baselines) + descent > bottom) overflowing.push(match[1]);
  }
  return overflowing;
};
