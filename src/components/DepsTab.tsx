import { createMemo } from 'solid-js';
import { nodeInfo } from '../lib/graph';
import { need, model, opts, depQ, setDepQ, formLabel } from '../store';
import { DepsTabView, MAX_DISPLAYED_ROWS, type DependencyRow } from './DepsTabView';

export default function DepsTab() {
  const matching = createMemo(() => {
    const m = need(model()), o = need(opts()), q = depQ().toLowerCase().trim();
    return m.edges
      .filter((e) => o.types.has(e.type) && (o.showMissing || !e.missing))
      .filter((e) => !q || [e.from, e.to, e.type, nodeInfo(m, e.from).form, nodeInfo(m, e.to).form, e.expr].join(' ').toLowerCase().includes(q));
  });
  // Only the displayed rows are mapped, so typing in the filter stays cheap on large projects.
  const rows = createMemo((): DependencyRow[] => {
    const m = need(model());
    return matching().slice(0, MAX_DISPLAYED_ROWS).map((e) => ({
      from: e.from,
      fromFormLabel: formLabel(nodeInfo(m, e.from).form),
      to: e.to,
      toFormLabel: formLabel(nodeInfo(m, e.to).form),
      type: e.type,
      cross: e.cross,
      expression: e.expr,
    }));
  });
  return <DepsTabView rows={rows()} totalCount={matching().length} query={depQ()} onQueryChange={setDepQ} />;
}
