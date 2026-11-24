import { For } from 'solid-js';

/** <select> bound to a value; options are [value, label] pairs. */
export function Select(props) {
  return (
    <select onChange={(e) => props.onChange(e.target.value)}>
      <For each={props.options}>
        {(o) => <option value={o[0]} selected={props.value === o[0]}>{o[1]}</option>}
      </For>
    </select>
  );
}

/** Labelled checkbox. */
export function Check(props) {
  return (
    <label class="chk">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} /> {props.label}
    </label>
  );
}
