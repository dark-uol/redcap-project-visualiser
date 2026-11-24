import { For } from 'solid-js';
import { need, model, focusing, setExplore } from '../../store';
import FocusControls from '../FocusControls';
import { Labeled, createHint, HintToggle, HintText } from '../controls';

const { focus, setFocus, setPair } = focusing;

export default function FocusSection() {
  const help = createHint();
  const fields = () => need(model()).parsed.fields;

  /** Accepts a typed field name only if it exists in the model; otherwise restores the current focus. */
  const pickField = (input: HTMLInputElement): void => {
    const value = input.value.trim();
    if (!value) { setFocus(''); return; }
    if (need(model()).byVar.has(value)) { setExplore(null); setPair(null); setFocus(value); }
    else input.value = focus();
  };

  const onFieldChange = function onFieldChange(event: Event & { currentTarget: HTMLInputElement }): void {
    pickField(event.currentTarget);
  };
  const onClearFocus = function onClearFocus(): void {
    setFocus('');
  };
  return (
    <details class="sec" open={focus() !== ''}>
      <summary><h2>Focus on a field <HintToggle help={help} title="Focus on a field" /></h2></summary>
      <HintText help={help}>Shows only one field's chain of dependencies, at the level you are on (fields, forms or events); expanded forms and events stay open. Select a node in the graph to see its logic code.</HintText>
      <Labeled label="Field (search)" hint="Type a variable name and press Enter. The graph then shows only that field's chain.">
        <span class="row2"><input type="search" list="fieldlist" placeholder="Type to search fields…" autocomplete="off" value={focus()} onChange={onFieldChange} />
          <button class="btn sm" title="Clear focus" onClick={onClearFocus}>✕</button></span>
        <datalist id="fieldlist"><For each={fields()}>{(field) => <option value={field.variable}>{field.label.slice(0, 70)}</option>}</For></datalist>
      </Labeled>
      <FocusControls />
    </details>
  );
}
