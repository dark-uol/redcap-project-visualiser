import { createMemo } from 'solid-js';
import { nodeInfo } from '../lib/graph';
import { filterEdges } from '../lib/tableFilters';
import type { Edge } from '../lib/types';
import { need, model, opts, depQ, setDepQ, formLabel } from '../store';
import { DepsTabView, MAX_DISPLAYED_ROWS, type DependencyRow } from './DepsTabView';

export default function DepsTab() {
  const matching = createMemo(() => filterEdges(need(model()), need(opts()), depQ()));
  // A row is built once per edge and model, so the displayed rows keep their identity (and their <tr>) while the filter changes.
  const rowCache = createMemo(() => { need(model()); return new Map<Edge, DependencyRow>(); });
  const rowFor = (e: Edge): DependencyRow => {
    const cache = rowCache();
    let row = cache.get(e);
    if (!row) {
      const m = need(model());
      row = {
        from: e.from,
        fromFormLabel: formLabel(nodeInfo(m, e.from).form),
        to: e.to,
        toFormLabel: formLabel(nodeInfo(m, e.to).form),
        type: e.type,
        cross: e.cross,
        expression: e.expr,
      };
      cache.set(e, row);
    }
    return row;
  };
  // Only the displayed rows are built, so typing in the filter stays cheap on large projects.
  const rows = createMemo((): DependencyRow[] => matching().slice(0, MAX_DISPLAYED_ROWS).map(rowFor));
  return <DepsTabView rows={rows()} totalCount={matching().length} query={depQ()} onQueryChange={setDepQ} />;
}
