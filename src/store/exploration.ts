/* Interactive expansion of back / forward references, and the effects that keep it and the selection consistent with the level and instance mode. */
import { createEffect } from 'solid-js';
import { need } from './common';
import type { Derived } from './derived';
import type { State } from './state';
import { neighbors } from '../lib/graph';
import { isInstanceScopedId } from '../lib/selection';
import type { NeighborDir } from '../lib/types';

export function createExplorationActions(state: State, derived: Derived) {
  const { model, expanded, setExpanded, setExplore, captureAnchor } = state;
  const { level, selected, setSelectedRaw } = state.selection;
  const { setPair, setFocus } = state.focusing;
  const { filter, instanceMode, currentExploration, exploreVisible } = derived;

  function expandRef(t: string, direction: NeighborDir): void {
    captureAnchor(t);
    const exploration = currentExploration() || { level: level(), seeds: [], exp: [] };
    const neighborIds = neighbors(need(model()), need(filter()), t, direction);
    const seeds = exploreVisible(exploration).has(t) ? exploration.seeds : [...exploration.seeds, t];
    setExplore({ level: exploration.level, inst: instanceMode(), seeds, exp: [...exploration.exp, { node: t, dir: direction, added: neighborIds }] });
    setPair(null);
    setFocus('');
  }
  function collapseRef(t: string, direction: NeighborDir): void {
    const exploration = currentExploration();
    if (!exploration) return;
    captureAnchor(t);
    let exp = exploration.exp.filter((x) => !(x.node === t && x.dir === direction));
    for (;;) { // drop expansions whose own node is no longer visible
      const vis = exploreVisible({ seeds: exploration.seeds, exp });
      const keep = exp.filter((x) => vis.has(x.node));
      if (keep.length === exp.length) break;
      exp = keep;
    }
    setExplore({ ...exploration, exp });
  }
  createEffect(level, () => { setExplore(null); }, { defer: true });
  // node ids differ between plain and Instances mode (form vs form@event): drop a selection that may no longer exist
  // untracked: compares against the last value so selection is only dropped when the mode actually flips
  let previousInstanceMode = false;
  createEffect(
    () => [instanceMode(), selected()] as const,
    ([im, s]) => {
      if (im === previousInstanceMode) return;
      previousInstanceMode = im;
      if (s && isInstanceScopedId(s)) setSelectedRaw(null);
    },
  );
  function toggleExpandForm(formId: string): void {
    const on = expanded().has(formId);
    captureAnchor(formId, on ? { back: true } : { zoom: true });
    const next = new Set(expanded());
    if (on) next.delete(formId);
    else next.add(formId);
    setExpanded(next);
  }

  return { expandRef, collapseRef, toggleExpandForm };
}
