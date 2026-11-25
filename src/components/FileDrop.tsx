/* Empty-state drop zone; also wires page-wide drag & drop of an XML file. */
import { onSettled } from 'solid-js';
import { dragOver, setDragOver, readFile } from '../store';
import { FileDropView } from './FileDropView';

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
  return <FileDropView over={dragOver()} />;
}
