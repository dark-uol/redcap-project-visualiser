export type FileDropViewProps = { over: boolean };

/** Presentational: the empty-state drop zone; highlighted while a file is dragged over the page. */
export function FileDropView(props: FileDropViewProps) {
  return (
    <div class={{ drop: true, over: props.over }}>
      <div><strong>Drop a REDCap project XML here</strong><br /><span class="muted">Export from REDCap: Project Setup → Other Functionality → “Download metadata only (XML)”. Everything is processed locally in your browser.</span></div>
    </div>
  );
}
