import { need, focusing, formLabel } from '../../store';
import { createHint, HintToggle, HintText } from '../controls';

const { pair, setPair } = focusing;

export default function FormLinkFocusSection() {
  const help = createHint();
  const onClearPair = function onClearPair(): void {
    setPair(null);
  };

  return (
    <details class="sec" open>
      <summary><h2>Form link focus <HintToggle help={help} title="Form link focus" /></h2></summary>
      <HintText help={help}>Narrows the graph to the fields that create the link between two forms. Clear it to see everything again.</HintText>
      <p class="small" style="margin:0 0 6px">Showing only the fields linking <b>{formLabel(need(pair()).from)}</b> → <b>{formLabel(need(pair()).to)}</b></p>
      <button class="btn sm" onClick={onClearPair}>✕ Clear</button>
    </details>
  );
}
