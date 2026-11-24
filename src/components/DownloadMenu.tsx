import { Show, onSettled } from 'solid-js';
import { downloadMenuOpen, setDownloadMenuOpen, downloadMermaid, downloadDot, downloadSvg, downloadCsv } from '../store';

export default function DownloadMenu() {
  onSettled(() => {
    const onClick = (e: MouseEvent) => {
      const inMenu = e.target instanceof Element && e.target.closest('.dlmenu');
      if (!inMenu) setDownloadMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDownloadMenuOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  });
  const pick = (fn: () => void) => () => { setDownloadMenuOpen(false); fn(); };
  return (
    <div class="dlmenu">
      <button class="btn sm" onClick={() => setDownloadMenuOpen(!downloadMenuOpen())}>⬇ Download ▾</button>
      <Show when={downloadMenuOpen()}>
        <div class="dlpop">
          <button onClick={pick(downloadMermaid)}>Mermaid (.mmd)</button>
          <button onClick={pick(downloadDot)}>Graphviz (.dot)</button>
          <button onClick={pick(downloadSvg)}>SVG image</button>
          <button onClick={pick(downloadCsv)}>Dependencies (.csv)</button>
        </div>
      </Show>
    </div>
  );
}
