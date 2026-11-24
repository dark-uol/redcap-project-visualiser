import { For } from 'solid-js';
import { need, model, focusing, clampDepth, setLevel, setExplore } from '../../store';
import { Select } from '../controls';
import type { FocusDir } from '../../lib/types';

const { focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, setPair } = focusing;

export default function FocusSection() {
  const fields = () => need(model()).parsed.fields;

  /** Accepts a typed field name only if it exists in the model; otherwise restores the current focus. */
  const pickField = (input: HTMLInputElement): void => {
    const value = input.value.trim();
    if (!value) { setFocus(''); return; }
    if (need(model()).byVar.has(value)) { setLevel('field'); setExplore(null); setPair(null); setFocus(value); }
    else input.value = focus();
  };

  const onFieldChange = function onFieldChange(event: Event & { currentTarget: HTMLInputElement }): void {
    pickField(event.currentTarget);
  };
  const onClearFocus = function onClearFocus(): void {
    setFocus('');
  };
  const onDepthDown = function onDepthDown(): void {
    setFocusDepth(focusDepth() - 1);
  };
  const onDepthUp = function onDepthUp(): void {
    setFocusDepth(focusDepth() + 1);
  };
  const onDepthInput = function onDepthInput(event: Event & { currentTarget: HTMLInputElement }): void {
    setFocusDepth(event.currentTarget.value);
    event.currentTarget.value = String(clampDepth(event.currentTarget.value));
  };

  return (
    <details class="sec">
      <summary><h2>Focus on a field</h2></summary>
      <label>Field (search)
        <span class="row2"><input type="search" list="fieldlist" placeholder="Type to search fields…" autocomplete="off" value={focus()} onChange={onFieldChange} />
          <button class="btn sm" title="Clear focus" onClick={onClearFocus}>✕</button></span>
        <datalist id="fieldlist"><For each={fields()}>{(field) => <option value={field.variable}>{field.label.slice(0, 70)}</option>}</For></datalist>
      </label>
      <label>Show <Select<FocusDir> value={focusDir()} onChange={setFocusDir} options={[['both', 'Upstream + downstream'], ['up', 'Upstream (what it depends on)'], ['down', 'Downstream (what depends on it)']]} /></label>
      <label>Max depth
        <span class="stepper"><button class="btn sm" onClick={onDepthDown}>−</button>
          <input type="number" inputmode="numeric" min="1" max="50" step="1" value={focusDepth()} onChange={onDepthInput} />
          <button class="btn sm" onClick={onDepthUp}>+</button></span></label>
      <p class="muted small">Choosing a field switches to the field-level view. Tip: click a node to see its logic code.</p>
    </details>
  );
}
