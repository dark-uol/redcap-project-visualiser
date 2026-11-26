import { describe, expect, it } from 'vitest';
import { edgeAppearance, toDot, toMermaid } from '../src/lib/exporters';
import { layoutToSvg } from '../src/lib/layoutToSvg';
import type { Layout } from '../src/lib/layout';
import type { Level, View, ViewEdge, ViewOptions } from '../src/lib/types';
import { makeView, node } from './fixtures';

const baseOptions: ViewOptions = {
  level: 'field', eventSet: null, types: new Set(), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both',
  focusDepth: 0, showMissing: false, hideIsolated: false, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'var', group: false, groupBy: 'none', edgeLabels: false, lineWidths: true,
};

const optionsFor = (level: Level, edgeLabels: boolean, lineWidths = true): ViewOptions => ({ ...baseOptions, level, edgeLabels, lineWidths });

/** A three-node view with two edges, in the shape the real view builder produces for each level. */
const viewFor = (level: Level): View => {
  const aggregated = level !== 'field';
  const kind = aggregated ? 'form' : 'field';
  const nodes = ['a', 'b', 'c'].map((id) => node(id, { kind }));
  const edges: ViewEdge[] = aggregated
    ? [
      { from: 'a', to: 'b', types: ['branching', 'calc'], count: 3, byType: { branching: 2, calc: 1 } },
      { from: 'b', to: 'c', types: ['piping'], count: 8, byType: { piping: 8 } },
    ]
    : [
      { from: 'a', to: 'b', types: ['branching', 'piping'], count: 2, byType: { branching: 1, piping: 1 }, fieldLevel: true },
      { from: 'b', to: 'c', types: ['calc'], count: 1, byType: { calc: 1 }, fieldLevel: true },
    ];
  return makeView({ level, nodes, edges });
};

const layoutFor = (view: View): Layout => ({
  width: 500,
  height: 100,
  nodes: view.nodes.map((viewNode, index) => ({ id: viewNode.id, x: index * 160, y: 10, width: 120, height: 28 })),
  edges: view.edges.map((viewEdge, index) => ({
    from: viewEdge.from,
    to: viewEdge.to,
    curve: [{ x: index * 160 + 120, y: 24 }, { x: index * 160 + 135, y: 24 }, { x: index * 160 + 145, y: 24 }, { x: index * 160 + 160, y: 24 }],
    backward: false,
  })),
  regions: [],
});

const dotLabels = (dot: string): string[] =>
  dot.split('\n').filter((line) => line.includes(' -> ')).map((line) => /label="([^"]*)"/.exec(line)?.[1]).filter((text): text is string => text !== undefined);

const mermaidLabels = (mermaid: string): string[] =>
  mermaid.split('\n').map((line) => /\|"([^"]*)"\|/.exec(line)?.[1]).filter((text): text is string => text !== undefined);

const svgLabels = (svg: string): string[] =>
  Array.from(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('g.edge text')).map((text) => text.textContent ?? '');

const labelsFromEveryRenderer = (view: View, options: ViewOptions): Record<'graphviz' | 'mermaid' | 'layout', string[]> => ({
  graphviz: dotLabels(toDot(view, options)),
  mermaid: mermaidLabels(toMermaid(view, options)),
  layout: svgLabels(layoutToSvg(layoutFor(view), view, options)),
});

describe('edge labels are the same in every renderer', () => {
  const expectedWhenOn: Record<Level, string[]> = {
    field: ['branching+piping', 'calc'],
    form: ['branching 2, calc 1 · 3 fields', 'piping 8 · 8 fields'],
    event: ['branching 2, calc 1 · 3 fields', 'piping 8 · 8 fields'],
  };

  for (const level of ['field', 'form', 'event'] as const) {
    it(`draws no label on any edge when the toggle is off, at ${level} level`, () => {
      const labels = labelsFromEveryRenderer(viewFor(level), optionsFor(level, false));
      expect(labels.graphviz).toEqual([]);
      expect(labels.mermaid).toEqual([]);
      expect(labels.layout).toEqual([]);
    });

    it(`draws the same label on every edge when the toggle is on, at ${level} level`, () => {
      const labels = labelsFromEveryRenderer(viewFor(level), optionsFor(level, true));
      expect(labels.graphviz).toEqual(expectedWhenOn[level]);
      expect(labels.mermaid).toEqual(expectedWhenOn[level]);
      expect(labels.layout).toEqual(expectedWhenOn[level]);
    });
  }
});

/** The quantised width class (`w-3-5`) of each edge in a layout svg. */
const widthClasses = (svg: string): string[] =>
  Array.from(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('g.edge'))
    .flatMap((edgeGroup) => [...edgeGroup.classList].filter((name) => /^w-\d/.test(name)));

describe('line widths option', () => {
  const view = viewFor('form');

  it('writes a thickness per aggregated edge in every renderer when on', () => {
    const options = optionsFor('form', false, true);
    expect(toDot(view, options)).toMatch(/penwidth=/);
    expect(toMermaid(view, options)).not.toContain('stroke-width:1.5px');
    expect(new Set(widthClasses(layoutToSvg(layoutFor(view), view, options))).size).toBe(2);
    expect(edgeAppearance(view, view.edges[1], options).width).toBeGreaterThan(edgeAppearance(view, view.edges[0], options).width!);
  });

  it('writes no thickness when off, so every edge gets the default width', () => {
    const options = optionsFor('form', false, false);
    expect(toDot(view, options)).not.toMatch(/penwidth=/);
    expect(toMermaid(view, options).match(/stroke-width:[\d.]+px/g)).toEqual(['stroke-width:1.5px', 'stroke-width:1.5px']);
    expect(widthClasses(layoutToSvg(layoutFor(view), view, optionsFor('form', false, true)))).toHaveLength(2);
    expect(widthClasses(layoutToSvg(layoutFor(view), view, options))).toEqual([]);
    expect(edgeAppearance(view, view.edges[0], options).width).toBeNull();
  });

  it('never applies at field level', () => {
    const fieldView = viewFor('field');
    expect(edgeAppearance(fieldView, fieldView.edges[0], optionsFor('field', false, true)).width).toBeNull();
  });
});
