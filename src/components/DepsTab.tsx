import { For, createMemo } from 'solid-js';
import { nodeInfo } from '../lib/graph';
import { need, model, opts, depQ, setDepQ, formLabel } from '../store';
import { Tag } from './Detail';

export default function DepsTab() {
  const rows = createMemo(() => {
    const m = need(model()), o = need(opts()), q = depQ().toLowerCase().trim();
    return m.edges
      .filter((e) => o.types.has(e.type) && (o.showMissing || !e.missing))
      .filter((e) => !q || [e.from, e.to, e.type, nodeInfo(m, e.from).form, nodeInfo(m, e.to).form, e.expr].join(' ').toLowerCase().includes(q));
  });
  return (
    <div>
      <input class="filter" placeholder="Filter by field, form, type or expression…" value={depQ()} onInput={(e) => setDepQ(e.currentTarget.value)} />
      <p class="muted small">{rows().length} dependencies{rows().length > 1000 ? ' (showing first 1000)' : ''}</p>
      <table><thead><tr><th>Source field</th><th></th><th>Dependent field</th><th>Type</th><th>Expression</th></tr></thead><tbody>
        <For each={rows().slice(0, 1000)}>
          {(e) => (
            <tr>
              <td>{e.from}<div class="muted small">{formLabel(nodeInfo(need(model()), e.from).form)}</div></td><td>→</td>
              <td>{e.to}<div class="muted small">{formLabel(nodeInfo(need(model()), e.to).form)}</div></td>
              <td><Tag type={e.type} />{e.cross ? <span class="tag" style="background:#6b7280">cross-event</span> : ''}</td><td class="expr">{e.expr}</td>
            </tr>
          )}
        </For>
      </tbody></table>
    </div>
  );
}
