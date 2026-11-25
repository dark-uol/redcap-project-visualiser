export type ToolbarViewProps = {
  summary: string;
  onOpenFile: (file: File) => void;
  onLoadSample: () => void;
};

/** Presentational: header with title, open-file and sample buttons, and the project summary. */
export function ToolbarView(props: ToolbarViewProps) {
  function openSelectedFile(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    if (file) props.onOpenFile(file);
    e.currentTarget.value = '';
  }
  return (
    <header>
      <h1>REDCap field dependencies</h1>
      <div class="hdr-actions">
        <label class="btn primary">Open metadata XML…<input type="file" accept=".xml,text/xml,application/xml" hidden onChange={openSelectedFile} /></label>
        <button class="btn" onClick={() => props.onLoadSample()}>Load sample</button>
        <span class="muted">{props.summary}</span>
      </div>
    </header>
  );
}
