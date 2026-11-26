/* Engine contract: every engine draws exactly one keyed element per view node, edge and group, sized and labelled
   the same way. Graphviz, ELK and Swimlane are drawn for real in jsdom; each is compared to the reference engine. */
import { beforeAll, describe, expect, it } from 'vitest';
import { clusterIndex, nodeKey, normalizeSvg } from '../../src/components/svgDom';
import {
  CONFIGS, DRAWABLE_ENGINES, REFERENCE_ENGINE, currentDrawInput, drawWithEngine, elementsByKey, expectedKeys, unexpectedAndStale,
} from './harness';
import type { DrawableEngine, KnownDifference } from './harness';

const PREFIX = 'contract:';

/** Text drawn inside an element, ignoring its tooltip title. */
const drawnText = (element: Element): string =>
  [...element.querySelectorAll('text')].map((text) => text.textContent ?? '').join(' ').trim();

const edgeKeysWithText = (edges: Map<string, Element>): string[] =>
  [...edges].filter(([, element]) => drawnText(element) !== '').map(([key]) => key).sort();

/** Differences between what an engine drew and what the view asked for (and, for labels, what the reference drew). */
async function observeContract(engine: DrawableEngine, configName: string, referenceLabelled: string[] | null): Promise<{ differences: KnownDifference[]; labelled: string[] }> {
  const input = currentDrawInput();
  const svg = await drawWithEngine(engine, input);
  const found: string[] = [];
  const expected = expectedKeys(input.view);
  const drawn = elementsByKey(svg);

  const compare = (kind: string, wanted: (string | number)[], got: (string | number)[]): void => {
    if (wanted.some((key) => !got.includes(key))) found.push(`${PREFIX} missing ${kind}`);
    if (got.some((key) => !wanted.includes(key))) found.push(`${PREFIX} extra ${kind}`);
  };
  compare('node', expected.nodes, [...drawn.nodes.keys()]);
  compare('edge', expected.edges, [...drawn.edges.keys()]);
  compare('cluster', expected.clusters, [...drawn.clusters.keys()]);
  if (drawn.duplicates.length) found.push(`${PREFIX} duplicate keyed element`);
  if ([...svg.querySelectorAll('g.node')].some((element) => nodeKey(element) === null)) found.push(`${PREFIX} node without a key`);
  if ([...svg.querySelectorAll('g.cluster')].some((element) => clusterIndex(element) === null)) found.push(`${PREFIX} cluster without a key`);

  normalizeSvg(svg);
  if (!(Number(svg.dataset.w) > 0 && Number(svg.dataset.h) > 0)) found.push(`${PREFIX} no positive size`);
  if ([...drawn.nodes.values()].some((element) => drawnText(element) === '')) found.push(`${PREFIX} node without text`);

  const labelled = edgeKeysWithText(drawn.edges);
  if (input.options.edgeLabels) {
    if (expected.edges.length && !labelled.length) found.push(`${PREFIX} no edge labels with labels on`);
    if (referenceLabelled && JSON.stringify(labelled) !== JSON.stringify(referenceLabelled)) found.push(`${PREFIX} edge labels differ from the reference`);
  } else if (labelled.length) {
    found.push(`${PREFIX} edge labels with labels off`);
  }
  return { differences: [...new Set(found)].map((behaviour) => ({ engine, config: configName, behaviour, reason: '' })), labelled };
}

const observedAcrossConfigs: KnownDifference[] = [];

describe('engine contract on the sample', () => {
  beforeAll(() => { observedAcrossConfigs.length = 0; });

  for (const config of CONFIGS) {
    it(`${config.name}: one keyed element per view node, edge and group`, async () => {
      config.apply();
      const reference = await observeContract(REFERENCE_ENGINE, config.name, null);
      const observed = [...reference.differences];
      for (const engine of DRAWABLE_ENGINES.filter((candidate) => candidate !== REFERENCE_ENGINE)) {
        observed.push(...(await observeContract(engine, config.name, reference.labelled)).differences);
      }
      observedAcrossConfigs.push(...observed);
      const { unlisted } = unexpectedAndStale(observed, { engines: DRAWABLE_ENGINES, configs: [config.name], behaviourPrefix: PREFIX });
      expect(unlisted).toEqual([]);
    }, 60_000);
  }

  it('lists no contract difference that no longer occurs', () => {
    const { stale } = unexpectedAndStale(observedAcrossConfigs, { engines: DRAWABLE_ENGINES, configs: CONFIGS.map((config) => config.name), behaviourPrefix: PREFIX });
    expect(stale).toEqual([]);
  });
});
