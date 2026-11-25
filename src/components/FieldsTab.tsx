import { createMemo } from 'solid-js';
import { need, model, fieldQ, setFieldQ, selection, formLabel } from '../store';
import { FieldsTabView, type FieldRow } from './FieldsTabView';

function selectField(variable: string): void {
  selection.setSelected(variable);
  selection.setTab('graph');
}

export default function FieldsTab() {
  const rows = createMemo((): FieldRow[] => {
    const q = fieldQ().toLowerCase().trim();
    const degree = need(model()).analysis.degree;
    return need(model()).parsed.fields
      .filter((f) => !q || [f.variable, f.form, f.type, f.label].join(' ').toLowerCase().includes(q))
      .map((f) => {
        const deg = degree.get(f.variable) ?? { in: 0, out: 0 };
        return { variable: f.variable, formLabel: formLabel(f.form), type: f.type, label: f.label, dependsOn: deg.in, usedBy: deg.out };
      });
  });
  return <FieldsTabView rows={rows()} query={fieldQ()} onQueryChange={setFieldQ} onSelectField={selectField} />;
}
