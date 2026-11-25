import { Show, createSignal, onSettled } from 'solid-js';

export type DownloadMenuViewProps = {
  onDownloadMermaid: () => void;
  onDownloadDot: () => void;
  onDownloadSvg: () => void;
  onDownloadCsv: () => void;
};

/** Presentational: a button that opens a menu of download choices. Owns only its open/closed state. */
export function DownloadMenuView(props: DownloadMenuViewProps) {
  const [open, setOpen] = createSignal(false);
  onSettled(() => {
    const closeOnOutsideClick = (e: MouseEvent) => {
      const inMenu = e.target instanceof Element && e.target.closest('.dlmenu');
      if (!inMenu) setOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  });
  const closeThen = (action: () => void) => function closeAndRun() { setOpen(false); action(); };
  return (
    <div class="dlmenu">
      <button class="btn sm" onClick={() => setOpen(!open())}>⬇ Download ▾</button>
      <Show when={open()}>
        <div class="dlpop">
          <button onClick={closeThen(props.onDownloadMermaid)}>Mermaid (.mmd)</button>
          <button onClick={closeThen(props.onDownloadDot)}>Graphviz (.dot)</button>
          <button onClick={closeThen(props.onDownloadSvg)}>SVG image</button>
          <button onClick={closeThen(props.onDownloadCsv)}>Dependencies (.csv)</button>
        </div>
      </Show>
    </div>
  );
}
