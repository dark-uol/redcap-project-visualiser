import { need, pair, setPair, formLabel } from '../../store';

export default function FormLinkFocusSection() {
  const onClearPair = function onClearPair(): void {
    setPair(null);
  };

  return (
    <details class="sec" open>
      <summary><h2>Form link focus</h2></summary>
      <p class="small" style="margin:0 0 6px">Showing only the fields linking <b>{formLabel(need(pair()).from)}</b> → <b>{formLabel(need(pair()).to)}</b></p>
      <button class="btn sm" onClick={onClearPair}>✕ Clear</button>
    </details>
  );
}
