import { createMemo } from 'solid-js';
import { need, model, fieldQ, setFieldQ, selection, formLabel } from '../store';
import { fieldSearchText, matchesQuery } from '../lib/tableFilters';
import { FieldsTabView, type FieldRow } from './FieldsTabView';

function selectField(variable: string): void {
  selection.setSelected(variable);
  selection.setTab('graph');
}

export default function FieldsTab() {
  // Rows and their search text depend only on the model, so the row objects keep their identity (and their <tr>) while the filter changes.
  const entries = createMemo(() => {
    const degree = need(model()).analysis.degree;
    return need(model()).parsed.fields.map((f) => {
      const deg = degree.get(f.variable) ?? { in: 0, out: 0 };
      const row: FieldRow = { variable: f.variable, formLabel: formLabel(f.form), type: f.type, label: f.label, dependsOn: deg.in, usedBy: deg.out };
      return { row, searchText: fieldSearchText(f) };
    });
  });
  const rows = createMemo((): FieldRow[] => {
    const query = fieldQ();
    return entries().filter((entry) => matchesQuery(entry.searchText, query)).map((entry) => entry.row);
  });
  return <FieldsTabView rows={rows()} query={fieldQ()} onQueryChange={setFieldQ} onSelectField={selectField} />;
}
