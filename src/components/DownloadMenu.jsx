import { Show, onSettled } from 'solid-js';
import { dlOpen, setDlOpen, dlMermaid, dlDot, dlSvg, dlCsv } from '../store.js';

export default function DownloadMenu() {
  onSettled(() => {
    const onClick = (e) => { if (!(e.target.closest && e.target.closest('.dlmenu'))) setDlOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setDlOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  });
  const pick = (fn) => () => { setDlOpen(false); fn(); };
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
