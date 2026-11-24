import { For, Show, createSignal } from 'solid-js';
import type { Element as SolidElement } from 'solid-js';

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

/** Labelled checkbox, with an optional ⓘ explanation shown below it. */
export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const help = createHint();
  return (
    <>
      <label class="chk">
        <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} /> {props.label}
        <Show when={props.hint}><HintToggle help={help} title={props.label} /></Show>
      </label>
      <Show when={props.hint}><HintText help={help}>{props.hint}</HintText></Show>
    </>
  );
}

/** Open / closed state of one explanation. */
export interface HintState { open: () => boolean; toggle: () => void }

export function createHint(): HintState {
  const [open, setOpen] = createSignal(false);
  const toggle = function toggleHint(): void {
    setOpen(!open());
  };
  return { open, toggle };
}

/** The ⓘ button. Its click is stopped so it never toggles a surrounding <label> or <summary>. */
export function HintToggle(props: { help: HintState; title: string }) {
  const onToggle = function onToggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    props.help.toggle();
  };
  return (
    <button class="hint-toggle" type="button" title="What does this do?" aria-expanded={props.help.open() ? 'true' : 'false'} aria-label={'About: ' + props.title} onClick={onToggle}>ⓘ</button>
  );
}

/** The explanation, visible only while its ⓘ is on. */
export function HintText(props: { help: HintState; children: SolidElement }) {
  return <Show when={props.help.open()}><span class="muted small hint-text">{props.children}</span></Show>;
}

/** A control label with an ⓘ; the explanation appears below the control. The control goes in the children. */
export function Labeled(props: { label: string; hint: string; children: SolidElement }) {
  const help = createHint();
  return (
    <>
      <label>{props.label} <HintToggle help={help} title={props.label} />{props.children}</label>
      <HintText help={help}>{props.hint}</HintText>
    </>
  );
}

/** A bold heading with an ⓘ button that shows or hides its explanation. */
export function HintHeading(props: { title: string; hint: string }) {
  const help = createHint();
  return (
    <div class="exhead">
      <b>{props.title}</b>
      <HintToggle help={help} title={props.title} />
      <HintText help={help}>{props.hint}</HintText>
    </div>
  );
}
