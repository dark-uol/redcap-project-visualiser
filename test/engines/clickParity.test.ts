/* Click parity: resolveClick gives the same action for the same logical node, edge and cluster in every engine,
   compared to the reference engine. Background clicks clear, and edge labels are ignored. */
import { describe, expect, it } from 'vitest';
import {
  CONFIGS, DRAWABLE_ENGINES, REFERENCE_ENGINE, clickOn, currentDrawInput, drawWithEngine, elementsByKey, unexpectedAndStale,
} from './harness';
import type { DrawableEngine, KnownDifference } from './harness';

const PREFIX = 'click:';

/** Click action per logical element, as `kind:key` to JSON. */
async function clickActions(engine: DrawableEngine): Promise<{ actions: Map<string, string>; svg: SVGSVGElement }> {
  const input = currentDrawInput();
  const svg = await drawWithEngine(engine, input);
  const drawn = elementsByKey(svg);
  const actions = new Map<string, string>();
  drawn.nodes.forEach((element, key) => actions.set(`node:${key}`, JSON.stringify(clickOn(element, input.view))));
  drawn.edges.forEach((element, key) => actions.set(`edge:${key}`, JSON.stringify(clickOn(element, input.view))));
  drawn.clusters.forEach((element, key) => actions.set(`cluster:${key}`, JSON.stringify(clickOn(element, input.view))));
  return { actions, svg };
}

const observedAcrossConfigs: KnownDifference[] = [];

describe('click parity on the sample', () => {
  for (const config of CONFIGS) {
    it(`${config.name}: every element resolves like the reference engine`, async () => {
      config.apply();
      const reference = await clickActions(REFERENCE_ENGINE);
      const observed: KnownDifference[] = [];
      for (const engine of DRAWABLE_ENGINES) {
        const { actions, svg } = engine === REFERENCE_ENGINE ? reference : await clickActions(engine);
        const view = currentDrawInput().view;
        const found = new Set<string>();
        for (const [element, action] of reference.actions) {
          const other = actions.get(element);
          if (other === undefined) continue; // a missing element is the contract test's business
          if (other !== action) found.add(`${PREFIX} ${element.split(':')[0]} action differs from the reference`);
        }
        // the background clears; an edge label does nothing
        if (JSON.stringify(clickOn(svg, view)) !== JSON.stringify({ type: 'clear' })) found.add(`${PREFIX} background does not clear`);
        const label = [...svg.querySelectorAll('g.edge')].map((edge) => edge.querySelector('text')).find((text) => text);
        if (label && JSON.stringify(clickOn(label, view)) !== JSON.stringify(clickOn(label.closest('g.edge')!, view))) {
          found.add(`${PREFIX} edge label acts differently from its edge`);
        }
        for (const behaviour of found) observed.push({ engine, config: config.name, behaviour, reason: '' });
        found.clear();
      }
      observedAcrossConfigs.push(...observed);
      expect(unexpectedAndStale(observed, { engines: DRAWABLE_ENGINES, configs: [config.name], behaviourPrefix: PREFIX }).unlisted).toEqual([]);
    }, 60_000);
  }

  it('lists no click difference that no longer occurs', () => {
    const { stale } = unexpectedAndStale(observedAcrossConfigs, { engines: DRAWABLE_ENGINES, configs: CONFIGS.map((config) => config.name), behaviourPrefix: PREFIX });
    expect(stale).toEqual([]);
  });
});
