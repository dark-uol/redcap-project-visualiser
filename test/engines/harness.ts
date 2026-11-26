/* Engine-neutral harness for the layout-engine parity tests: draws the store's view with Graphviz, ELK or Swimlane in
   jsdom through the same renderEngine the app uses, and reads the result back with the app's own svgDom readers.
   Mermaid cannot render in jsdom (no getBBox), so it is not drawable here. */
import sampleRaw from '../../public/sample/sample.xml?raw';
import { flush } from 'solid-js';
import * as store from '../../src/store';
import { renderEngine } from '../../src/lib/renderers';
import { clusterIndex, edgeKey, EDGE_SEL, nodeKey } from '../../src/components/svgDom';
import { resolveClick } from '../../src/components/hitTest';
import type { ClickAction } from '../../src/components/hitTest';
import type { EventDef, Renderer, View, ViewOptions } from '../../src/lib/types';

export type DrawableEngine = 'graphviz' | 'elk' | 'swimlane';
export const DRAWABLE_ENGINES: DrawableEngine[] = ['graphviz', 'elk', 'swimlane'];
/** Every other engine is compared against this one. */
export const REFERENCE_ENGINE: DrawableEngine = 'elk';

export interface DrawInput { view: View; options: ViewOptions; events: EventDef[]; dotSource: string }

/** Draw `input` with one engine, as the store's render effect does. */
export async function drawWithEngine(engine: DrawableEngine, input: DrawInput): Promise<SVGSVGElement> {
  const svg = await renderEngine(engine as Renderer, {
    source: engine === 'graphviz' ? input.dotSource : '', view: input.view, options: input.options, events: input.events, mermaidId: 'unused',
  });
  if (!svg) throw new Error(`${engine} drew nothing`);
  return svg;
}

/** One level of the matrix the parity tests walk, applied by driving the real store setters. */
export interface EngineConfig {
  name: string;
  apply: () => void;
}

const settle = (write: () => void): void => { write(); flush(); };

/** Reload the sample with default state, then apply `changes`. */
const configure = (changes: () => void): void => {
  store.loadText(sampleRaw, 'sample');
  flush();
  settle(() => { store.setInstances(false); store.presentation.setRenderer('graphviz'); });
  settle(changes);
};

const fieldLevel = (groupBy: 'form' | 'event' | 'arm' | 'none'): (() => void) => () => {
  store.selection.setLevel('field');
  store.presentation.setGroupBy(groupBy);
};

/** First view node id satisfying `predicate`, read at apply time (so configs follow the sample, not hard-coded ids). */
const firstNodeId = (predicate: (id: string) => boolean): string => {
  const found = store.view()!.nodes.find((node) => predicate(node.id));
  if (!found) throw new Error('no matching node in the view');
  return found.id;
};

export const CONFIGS: EngineConfig[] = [
  ...(['form', 'event', 'arm', 'none'] as const).map((groupBy) => ({
    name: `field, group by ${groupBy}`, apply: () => configure(fieldLevel(groupBy)),
  })),
  { name: 'field, edge labels and label text', apply: () => configure(() => { fieldLevel('form')(); store.presentation.setEdgeLabels(true); store.presentation.setLabelMode('label'); }) },
  { name: 'field, top-down', apply: () => configure(() => { fieldLevel('form')(); store.presentation.setDir('TD'); }) },
  { name: 'form', apply: () => configure(() => store.selection.setLevel('form')) },
  { name: 'form, Instances', apply: () => configure(() => { store.selection.setLevel('form'); store.setInstances(true); }) },
  { name: 'event', apply: () => configure(() => store.selection.setLevel('event')) },
  {
    name: 'event, into forms',
    apply: () => {
      configure(() => store.selection.setLevel('event'));
      settle(() => store.toggleExpandEvent(firstNodeId(() => true)));
    },
  },
  {
    name: 'form instance, into fields',
    apply: () => {
      configure(() => { store.selection.setLevel('form'); store.setInstances(true); });
      settle(() => store.toggleExpandForm(firstNodeId((id) => id.includes('@'))));
    },
  },
  {
    name: 'field, focused and selected',
    apply: () => {
      configure(fieldLevel('form'));
      const withEdges = store.view()!.edges[0]!.from;
      settle(() => { store.focusing.setFocus(withEdges.split('@@')[0]!); store.selection.setSelected(withEdges); });
    },
  },
];

/** What the harness hands a test: the store's view, its options and the DOT source, for the config just applied. */
export function currentDrawInput(): DrawInput {
  return {
    view: store.view()!, options: store.opts()!, events: store.model()!.parsed.events, dotSource: store.dotSrc(),
  };
}

export interface ElementsByKey {
  nodes: Map<string, Element>;
  edges: Map<string, Element>;
  clusters: Map<number, Element>;
  /** Keyed elements that appear more than once, as `kind:key`. */
  duplicates: string[];
}

/** Index a drawn SVG by node key (`n3`), edge key (`n1->n2`) and cluster index, with the app's own readers. */
export function elementsByKey(svg: SVGSVGElement): ElementsByKey {
  const result: ElementsByKey = { nodes: new Map(), edges: new Map(), clusters: new Map(), duplicates: [] };
  const record = <Key,>(map: Map<Key, Element>, kind: string, key: Key | null, element: Element): void => {
    if (key === null) return;
    if (map.has(key)) result.duplicates.push(`${kind}:${String(key)}`);
    map.set(key, element);
  };
  svg.querySelectorAll('g.node').forEach((element) => record(result.nodes, 'node', nodeKey(element), element));
  svg.querySelectorAll(EDGE_SEL).forEach((element) => {
    const pair = edgeKey(element);
    record(result.edges, 'edge', pair ? `${pair[0]}->${pair[1]}` : null, element);
  });
  svg.querySelectorAll('g.cluster').forEach((element) => record(result.clusters, 'cluster', clusterIndex(element), element));
  return result;
}

/** The keys a view expects to be drawn. */
export function expectedKeys(view: View): { nodes: string[]; edges: string[]; clusters: number[] } {
  const indexById = new Map(view.nodes.map((node, index) => [node.id, index]));
  return {
    nodes: view.nodes.map((_, index) => `n${index}`),
    edges: [...new Set(view.edges.map((edge) => `n${indexById.get(edge.from)}->n${indexById.get(edge.to)}`))],
    clusters: view.groups.map((_, index) => index),
  };
}

/** Run the app's own click resolution for one element. */
export const clickOn = (element: Element, view: View): ClickAction =>
  resolveClick(element, view, (id) => store.model()!.formsById.has(id));

/** Whether swimlane draws this config, or the store falls back to ELK. */
export const swimlaneApplies = (): boolean => (store.model()?.parsed.events ?? []).length > 0;

/** A named, reviewed difference between an engine and the reference engine. */
export interface KnownDifference {
  engine: DrawableEngine;
  /** Config name, or `*` for every config. */
  config: string;
  /** Which check shows it, for example `contract: missing edge`. */
  behaviour: string;
  reason: string;
}

/** Filled from real gaps found by the contract and click tests. Mermaid entries are checked in layer C only. */
export const KNOWN_DIFFERENCES: KnownDifference[] = [
  ...['field, group by event', 'field, group by arm', 'form, Instances', 'form instance, into fields'].map((config): KnownDifference => ({
    engine: 'swimlane', config, behaviour: 'contract: missing cluster',
    reason: 'the swimlane engine draws an event group as a column and an arm group as a lane (g.region elements, not g.cluster), so there is no g.cluster per such group; those groups are noSelect (nothing clicks or highlights them) and the columns and lanes are the grouping; see "Known engine differences" in docs/engine-parity-tests-plan.md',
  })),
];

/**
 * Compare observed differences to the table: a difference not listed fails, and a listed one that did not occur fails.
 * `checked` limits stale-entry detection to the behaviours the calling test file can observe.
 */
export function unexpectedAndStale(
  observed: KnownDifference[],
  checked: { engines: DrawableEngine[]; configs: string[]; behaviourPrefix: string },
): { unlisted: string[]; stale: string[] } {
  const matches = (left: KnownDifference, right: KnownDifference): boolean =>
    left.engine === right.engine && left.behaviour === right.behaviour && (left.config === '*' || right.config === '*' || left.config === right.config);
  const unlisted = observed.filter((difference) => !KNOWN_DIFFERENCES.some((known) => matches(known, difference)));
  const stale = KNOWN_DIFFERENCES.filter((known) =>
    known.behaviour.startsWith(checked.behaviourPrefix) && checked.engines.includes(known.engine)
    && (known.config === '*' || checked.configs.includes(known.config))
    && !observed.some((difference) => matches(known, difference)));
  const describe = (difference: KnownDifference): string => `${difference.engine} / ${difference.config} / ${difference.behaviour}`;
  return { unlisted: unlisted.map(describe), stale: stale.map(describe) };
}
