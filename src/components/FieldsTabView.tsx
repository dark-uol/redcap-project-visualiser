import { For } from 'solid-js';

/** One display row of the Fields tab. All plain data. */
export type FieldRow = { variable: string; formLabel: string; type: string; label: string; dependsOn: number; usedBy: number };

export type FieldsTabViewProps = { rows: FieldRow[]; query: string; onQueryChange: (query: string) => void; onSelectField: (variable: string) => void };

/** Presentational: filter box and table of fields. Typing calls `onQueryChange`; clicking a row calls `onSelectField`. */
export function FieldsTabView(props: FieldsTabViewProps) {
  return (
    <div>
      <input class="filter" placeholder="Filter fields…" value={props.query} onInput={(e) => props.onQueryChange(e.currentTarget.value)} />
      <table id="fieldTable"><thead><tr><th>Variable</th><th>Form</th><th>Type</th><th>Label</th><th>Depends on</th><th>Used by</th></tr></thead><tbody>
        <For each={props.rows}>
          {(row) => (
            <tr data-v="1" onClick={() => props.onSelectField(row.variable)}>
              <td>{row.variable}</td><td>{row.formLabel}</td><td>{row.type}</td><td>{row.label.slice(0, 80)}</td><td>{row.dependsOn}</td><td>{row.usedBy}</td>
            </tr>
          )}
        </For>
      </tbody></table>
    </div>
  );
}
