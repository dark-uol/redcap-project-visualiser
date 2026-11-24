import { Show, onSettled } from 'solid-js';
import { dlOpen, setDlOpen, dlMermaid, dlDot, dlSvg, dlCsv } from '../store';

export default function DownloadMenu() {
  onSettled(() => {
    const onClick = (e: MouseEvent) => {
      const inMenu = e.target instanceof Element && e.target.closest('.dlmenu');
      if (!inMenu) setDlOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDlOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  });
  const pick = (fn: () => void) => () => { setDlOpen(false); fn(); };
  return (
    <div class="dlmenu">
      <button class="btn sm" onClick={() => setDlOpen(!dlOpen())}>⬇ Download ▾</button>
      <Show when={dlOpen()}>
        <div class="dlpop">
          <button onClick={pick(dlMermaid)}>Mermaid (.mmd)</button>
          <button onClick={pick(dlDot)}>Graphviz (.dot)</button>
          <button onClick={pick(dlSvg)}>SVG image</button>
          <button onClick={pick(dlCsv)}>Dependencies (.csv)</button>
        </div>
      </Show>
    </div>
  );
}
