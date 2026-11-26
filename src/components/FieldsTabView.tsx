import { createSignal, For } from 'solid-js';
import { nextSort, sortRows, type Sort } from '../lib/tableSort';

/** One display row of the Fields tab. All plain data. */
export type FieldRow = { variable: string; formLabel: string; type: string; label: string; dependsOn: number; usedBy: number; chainLength: number };

export type FieldColumn = 'variable' | 'formLabel' | 'type' | 'label' | 'dependsOn' | 'usedBy' | 'chainLength';

const COLUMNS: { key: FieldColumn; title: string; hint?: string }[] = [
  { key: 'variable', title: 'Variable' },
  { key: 'formLabel', title: 'Form' },
  { key: 'type', title: 'Type' },
  { key: 'label', title: 'Label' },
  { key: 'dependsOn', title: 'Depends on' },
  { key: 'usedBy', title: 'Used by' },
  { key: 'chainLength', title: 'Dependent chain', hint: 'Steps in the longest chain of logic (branching, calc, action tag) dependants that starts at this field' },
];

export type FieldsTabViewProps = { rows: FieldRow[]; query: string; onQueryChange: (query: string) => void; onSelectField: (variable: string) => void };

const valueOfColumn = (row: FieldRow, key: FieldColumn): string | number => row[key];

/** Presentational: filter box and table of fields. Typing calls `onQueryChange`; clicking a row calls `onSelectField`; clicking a column header sorts by it (first click ascending, second descending). */
export function FieldsTabView(props: FieldsTabViewProps) {
  const [sort, setSort] = createSignal<Sort<FieldColumn> | undefined>(undefined);
  const sortedRows = () => sortRows(props.rows, sort(), valueOfColumn);
  const ariaSort = (key: FieldColumn): 'ascending' | 'descending' | 'none' => {
    const current = sort();
    return current?.key !== key ? 'none' : current.direction === 'asc' ? 'ascending' : 'descending';
  };
  return (
    <div>
      <input class="filter" placeholder="Filter fields…" value={props.query} onInput={(e) => props.onQueryChange(e.currentTarget.value)} />
      <table id="fieldTable"><thead><tr>
        <For each={COLUMNS}>
          {(column) => (
            <th aria-sort={ariaSort(column.key)} title={column.hint}>
              <button class="sortbutton" onClick={() => setSort(nextSort(sort(), column.key))}>
                {column.title}<span class="sortarrow">{ariaSort(column.key) === 'ascending' ? ' ▲' : ariaSort(column.key) === 'descending' ? ' ▼' : ''}</span>
              </button>
            </th>
          )}
        </For>
      </tr></thead><tbody>
        <For each={sortedRows()}>
          {(row) => (
            <tr data-v="1" onClick={() => props.onSelectField(row.variable)}>
              <td>{row.variable}</td><td>{row.formLabel}</td><td>{row.type}</td><td>{row.label.slice(0, 80)}</td><td>{row.dependsOn}</td><td>{row.usedBy}</td><td>{row.chainLength}</td>
            </tr>
          )}
        </For>
      </tbody></table>
    </div>
  );
}
