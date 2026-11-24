import { For, createMemo } from 'solid-js';
import { need, model, fieldQ, setFieldQ, selection, formLabel } from '../store';

const { setSelected, setTab } = selection;

export default function FieldsTab() {
  const rows = createMemo(() => {
    const q = fieldQ().toLowerCase().trim();
    return need(model()).parsed.fields.filter((f) => !q || [f.variable, f.form, f.type, f.label].join(' ').toLowerCase().includes(q));
  });
  const deg = (v: string) => need(model()).analysis.degree.get(v) ?? { in: 0, out: 0 };
  return (
    <div>
      <input class="filter" placeholder="Filter fields…" value={fieldQ()} onInput={(e) => setFieldQ(e.currentTarget.value)} />
      <table id="fieldTable"><thead><tr><th>Variable</th><th>Form</th><th>Type</th><th>Label</th><th>Depends on</th><th>Used by</th></tr></thead><tbody>
        <For each={rows()}>
          {(f) => (
            <tr data-v="1" onClick={() => { setSelected(f.variable); setTab('graph'); }}>
              <td>{f.variable}</td><td>{formLabel(f.form)}</td><td>{f.type}</td><td>{f.label.slice(0, 80)}</td><td>{deg(f.variable).in}</td><td>{deg(f.variable).out}</td>
            </tr>
          )}
        </For>
      </tbody></table>
    </div>
  );
}
