/* Header: title, open-file / sample buttons and project summary. */
import { model, readFile, loadSample } from '../store.js';

export default function Toolbar() {
  const summary = () => {
    const m = model(); if (!m) return '';
    const p = m.parsed;
    return `${p.projectName} · ${p.fields.length} fields · ${p.forms.length} forms` + (p.redcapVersion ? ` · REDCap ${p.redcapVersion}` : '');
  };
  return (
    <header>
      <h1>REDCap field dependencies</h1>
      <div class="hdr-actions">
        <label class="btn primary">Open metadata XML…<input type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; }} /></label>
        <button class="btn" onClick={loadSample}>Load sample</button>
        <span class="muted">{summary()}</span>
      </div>
    </header>
  );
}
