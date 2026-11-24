import { For } from 'solid-js';

/** <select> bound to a value; options are [value, label] pairs. */
export function Select<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <select onChange={(e) => props.onChange(e.currentTarget.value as T)}>
      <For each={props.options}>
        {(o) => <option value={o[0]} selected={props.value === o[0]}>{o[1]}</option>}
      </For>
    </select>
  );
}

/** Labelled checkbox. */
export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="chk">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} /> {props.label}
    </label>
  );
}
