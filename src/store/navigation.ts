/* Navigation state (tab, level, focus, selection) and the browser history that steps through it. */
import { createEffect } from 'solid-js';
import type { HistoryState, Navigation } from './common';
import type { State } from './state';

export function createNavigation(state: State) {
  const {
    model, currentModelSequence,
  } = state;
  const { focus, setFocus, pair, setPair } = state.focusing;
  const { tab, setTab, level, setLevel, selected, setSelected, setSelectedRaw, selectedEdge, setSelectedEdge } = state.selection;

  const currentNav = (): Navigation => ({ tab: tab(), level: level(), focus: focus(), pair: pair(), selection: selected(), edge: selectedEdge() });
  const applyNav = (n: Navigation): void => { setTab(n.tab); setLevel(n.level); setFocus(n.focus); setPair(n.pair); setSelectedRaw(n.selection); setSelectedEdge(n.edge); };
  const resetNav = (): void => { setTab('graph'); setLevel('form'); setFocus(''); setPair(null); setSelectedEdge(null); setSelected(null); };

  // ================= shared navigation helpers =================
  const jumpToField = (v: string): void => { setLevel('field'); setFocus(v); setPair(null); setSelectedEdge(null); setSelected(v); setTab('graph'); };
  const pickNode = (id: string): void => { setSelectedEdge(null); setSelected(id); };

  // ================= browser history: back/forward step through tab / level / focus / selection =================
  let lastKey: string | null = null;
  createEffect(
    (): HistoryState | null => (model() ? { m: currentModelSequence(), ...currentNav() } : null),
    (st) => {
      if (!st) return;
      const key = JSON.stringify(st);
      if (key === lastKey) return;
      const sameFile = lastKey !== null && (JSON.parse(lastKey) as HistoryState).m === st.m;
      try {
        if (sameFile) history.pushState(st, '');
        else history.replaceState(st, '');
      } catch { /* history unavailable */ }
      lastKey = key;
    },
  );
  window.addEventListener('popstate', (e: PopStateEvent) => {
    const st = e.state as HistoryState | null;
    if (!st || !model() || st.m !== currentModelSequence()) return;
    lastKey = JSON.stringify(st);
    applyNav(st);
  });

  return { currentNav, applyNav, resetNav, jumpToField, pickNode };
}
