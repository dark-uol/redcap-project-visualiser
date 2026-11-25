import { For } from 'solid-js';
import type { DepType } from '../lib/types';
import { Tag } from './Tag';

/** One display row of the Deps tab. All plain data. */
export type DependencyRow = { from: string; fromFormLabel: string; to: string; toFormLabel: string; type: DepType; cross: boolean; expression: string };

export type DepsTabViewProps = { rows: DependencyRow[]; totalCount: number; query: string; onQueryChange: (query: string) => void };

/** The most rows the table shows; the connector may pass fewer than `totalCount` rows. */
export const MAX_DISPLAYED_ROWS = 1000;

/** Presentational: filter box, count line and table of dependencies. Shows at most the first 1000 rows. Typing calls `onQueryChange`. */
export function DepsTabView(props: DepsTabViewProps) {
  return (
    <div>
      <input class="filter" placeholder="Filter by field, form, type or expression…" value={props.query} onInput={(e) => props.onQueryChange(e.currentTarget.value)} />
      <p class="muted small">{props.totalCount} dependencies{props.totalCount > MAX_DISPLAYED_ROWS ? ' (showing first 1000)' : ''}</p>
      <table><thead><tr><th>Source field</th><th></th><th>Dependent field</th><th>Type</th><th>Expression</th></tr></thead><tbody>
        <For each={props.rows.slice(0, MAX_DISPLAYED_ROWS)}>
          {(row) => (
            <tr>
              <td>{row.from}<div class="muted small">{row.fromFormLabel}</div></td><td>→</td>
              <td>{row.to}<div class="muted small">{row.toFormLabel}</div></td>
              <td><Tag type={row.type} />{row.cross ? <span class="tag" style="background:#6b7280">cross-event</span> : ''}</td><td class="expr">{row.expression}</td>
            </tr>
          )}
        </For>
      </tbody></table>
    </div>
  );
}
