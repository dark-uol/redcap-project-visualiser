/* Empty-state drop zone; also wires page-wide drag & drop of an XML file. */
import { onSettled } from 'solid-js';
import { dragOver, setDragOver, readFile } from '../store';

/** Page-wide drag & drop listeners (mounted once, from App). */
export function useFileDrop(): void {
  onSettled(() => {
    const over = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const leave = (e: DragEvent) => { e.preventDefault(); setDragOver(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files[0];
      if (f) readFile(f);
    };
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
    };
  });
}

export default function FileDrop() {
  return (
    <div class={{ drop: true, over: dragOver() }}>
      <div><strong>Drop a REDCap project XML here</strong><br /><span class="muted">Export from REDCap: Project Setup → Other Functionality → “Download metadata only (XML)”. Everything is processed locally in your browser.</span></div>
    </div>
  );
}
