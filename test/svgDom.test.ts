import { describe, expect, it } from 'vitest';
import {
  centreInStage, clusterEl, clusterIndex, closestEl, edgeKey, highlightLinks, keyForSelection, nodeKey, normalizeSvg,
  widenEdgeHits,
} from '../src/components/svgDom';
import { graphvizSvg, node, svgFrom } from './fixtures';

const q = (s: SVGSVGElement, sel: string) => s.querySelector(sel) as Element;

describe('nodeKey / edgeKey', () => {
  it('read Graphviz titles', () => {
    const s = graphvizSvg();
    expect(nodeKey(q(s, 'g.node'))).toBe('n0');
    expect(edgeKey(q(s, 'g.edge'))).toEqual(['n0', 'n1']);
  });
  it('read Mermaid ids', () => {
    const s = svgFrom('<g class="node" id="flowchart-n7-12"></g><path class="flowchart-link" id="L_n1_n2_0"/>');
    expect(nodeKey(q(s, 'g.node'))).toBe('n7');
    expect(edgeKey(q(s, 'path'))).toEqual(['n1', 'n2']);
  });
  it('return null for unrecognised elements', () => {
    const s = svgFrom('<g class="node"><title>other</title></g><g class="edge" id="x"></g>');
    expect(nodeKey(q(s, 'g.node'))).toBeNull();
    expect(edgeKey(q(s, 'g.edge'))).toBeNull();
  });
});

describe('clusters', () => {
  it('clusterIndex reads Graphviz titles and Mermaid ids', () => {
    expect(clusterIndex(q(graphvizSvg(), 'g.cluster'))).toBe(0);
    expect(clusterIndex(q(svgFrom('<g class="cluster" id="flowchart-g3"></g>'), 'g'))).toBe(3);
    expect(clusterIndex(q(svgFrom('<g class="cluster" id="nope"></g>'), 'g'))).toBeNull();
  });
  it('clusterEl finds a cluster by index', () => {
    const s = graphvizSvg();
    expect(clusterEl(s, 0)).toBe(q(s, 'g.cluster'));
    expect(clusterEl(s, 1)).toBeNull();
  });
});

describe('closestEl', () => {
  it('walks up from nested elements and tolerates non-elements', () => {
    const s = graphvizSvg();
    expect(closestEl(q(s, 'g.node text'), 'g.node')).toBe(q(s, 'g.node'));
    expect(closestEl(document.createTextNode('x'), 'g.node')).toBeNull();
    expect(closestEl(null, 'g.node')).toBeNull();
  });
});

describe('keyForSelection', () => {
  const nodes = [node('a@@1', { field: 'a' }), node('b'), node('a@@2', { field: 'a' })];
  it('prefers an exact id', () => expect(keyForSelection(nodes, 'a@@2')).toBe('n2'));
  it('falls back to the first node for a bare field name', () => expect(keyForSelection(nodes, 'a')).toBe('n0'));
  it('returns null when nothing matches', () => expect(keyForSelection(nodes, 'zzz')).toBeNull());
});

describe('highlightLinks', () => {
  const on = (s: SVGSVGElement, sel: string) => [...s.querySelectorAll(sel)].map((e) => e.classList.contains('on'));
  it('marks the node, its edges and its neighbours', () => {
    const s = graphvizSvg();
    highlightLinks(s, 'n0');
    expect(s.classList.contains('hl')).toBe(true);
    expect(on(s, 'g.node')).toEqual([true, true, false]);
    expect(on(s, 'g.edge')).toEqual([true, false]);
  });
  it('clears everything when the key is null', () => {
    const s = graphvizSvg();
    highlightLinks(s, 'n1');
    highlightLinks(s, null);
    expect(s.classList.contains('hl')).toBe(false);
    expect(on(s, 'g.node, g.edge').some(Boolean)).toBe(false);
  });
  it('skips very large graphs', () => {
    const s = svgFrom(Array.from({ length: 2501 }, (_, i) => `<g class="node"><title>n${i}</title></g>`).join(''));
    highlightLinks(s, 'n0');
    expect(s.classList.contains('hl')).toBe(false);
  });
});

describe('normalizeSvg', () => {
  it('uses the viewBox size and records it', () => {
    const s = svgFrom('', 'viewBox="0 0 300 200" style="width:5px"');
    normalizeSvg(s);
    expect(s.dataset.w).toBe('300');
    expect(s.dataset.h).toBe('200');
    expect(s.getAttribute('width')).toBe('300');
    expect(s.hasAttribute('style')).toBe(false);
  });
  it('adds a viewBox from width/height when missing', () => {
    const s = svgFrom('', 'width="120" height="80"');
    normalizeSvg(s);
    expect(s.getAttribute('viewBox')).toBe('0 0 120 80');
  });
  it('falls back to 800x600', () => {
    const s = svgFrom('');
    normalizeSvg(s);
    expect([s.dataset.w, s.dataset.h]).toEqual(['800', '600']);
  });
});

describe('widenEdgeHits', () => {
  it('adds a transparent, clickable copy of each edge path', () => {
    const s = graphvizSvg();
    widenEdgeHits(s);
    const paths = s.querySelectorAll('g.edge')[0].querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(paths[1].getAttribute('stroke')).toBe('transparent');
    expect(paths[1].getAttribute('stroke-width')).toBe('14');
    expect(paths[1].hasAttribute('marker-end')).toBe(false);
  });
});

describe('centreInStage', () => {
  const stageRect = { left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50, toJSON: () => ({}) } as DOMRect;
  it('returns the element centre relative to the stage, with its size', () => {
    const element = svgFrom('<g class="node"></g>').querySelector('g') as Element;
    element.getBoundingClientRect = () =>
      ({ left: 150, top: 90, width: 40, height: 20, right: 190, bottom: 110, x: 150, y: 90, toJSON: () => ({}) }) as DOMRect;
    expect(centreInStage(element, stageRect)).toEqual({ x: 170 - 100, y: 100 - 50, w: 40, h: 20 });
  });
  it('is zero-sized for an element at the stage origin with no size', () => {
    const element = svgFrom('<g class="node"></g>').querySelector('g') as Element;
    element.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 0, height: 0, right: 100, bottom: 50, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;
    expect(centreInStage(element, stageRect)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
