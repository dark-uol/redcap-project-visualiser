import { For, createMemo } from 'solid-js';
import { model, fieldQ, setFieldQ, setSelected, setTab, formLabel } from '../store.js';

export default function FieldsTab() {
  const rows = createMemo(() => {
    const q = fieldQ().toLowerCase().trim();
    return model().parsed.fields.filter((f) => !q || [f.variable, f.form, f.type, f.label].join(' ').toLowerCase().includes(q));
  });
  const deg = (v) => model().analysis.degree.get(v);
  return (
    <div>
      <input class="filter" placeholder="Filter fields…" value={fieldQ()} onInput={(e) => setFieldQ(e.target.value)} />
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
