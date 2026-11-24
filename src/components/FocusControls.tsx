/** Focus controls shared by the sidebar and the detail panel: direction, depth, and a note when depth hides part of the chain. */
import { For, Show } from 'solid-js';
import { focusing, view, clampDepth, setExplore, model, selection } from '../store';
import { MAX_FOCUS_DEPTH, focusKind } from '../lib/graph';
import type { FocusDir } from '../lib/types';
import { HintHeading, Labeled, Select } from './controls';

const { focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, setPair } = focusing;

const TRACE_DIRECTIONS: [FocusDir, string, string][] = [
  ['up', '▲ depends on', 'Show everything this field depends on, step by step'],
  ['down', '▼ used by', 'Show everything that depends on this field, step by step'],
  ['both', '◆ both', 'Show both directions'],
];

/** Max-depth stepper plus the "depth hides N fields" note. */
export function DepthControls() {
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
  const onShowFullChain = function onShowFullChain(): void {
    setFocusDepth(MAX_FOCUS_DEPTH);
  };
  const hiddenCount = (): number => view()?.focusHidden ?? 0;
  const noun = (): string => (selection.level() === 'event' && model() && focusKind(model() as NonNullable<ReturnType<typeof model>>, focus()) === 'event' ? 'event' : 'field');
  return (
    <>
      <Labeled label="Max depth" hint="How many steps along the dependency links to follow from the field. Raise it to reach further along the chain.">
        <span class="stepper"><button class="btn sm" onClick={onDepthDown}>−</button>
          <input type="number" inputmode="numeric" min="1" max={MAX_FOCUS_DEPTH} step="1" value={focusDepth()} onChange={onDepthInput} />
          <button class="btn sm" onClick={onDepthUp}>+</button></span></Labeled>
      <Show when={hiddenCount() > 0}>
        <p class="small focus-note">Depth {focusDepth()} hides {hiddenCount()} more {noun()}{hiddenCount() === 1 ? '' : 's'}. <button class="link" onClick={onShowFullChain}>Show full chain</button></p>
      </Show>
    </>
  );
}

/** Sidebar form: direction as a select, then the depth controls. */
export default function FocusControls() {
  return (
    <>
      <Labeled label="Show" hint="Which way to follow the links: what the field depends on, what depends on it, or both."><Select<FocusDir> value={focusDir()} onChange={setFocusDir} options={[['both', 'Upstream + downstream'], ['up', 'Upstream (what it depends on)'], ['down', 'Downstream (what depends on it)']]} /></Labeled>
      <DepthControls />
    </>
  );
}

/** Detail-panel form: one segmented control. Clicking a direction focuses the graph on this field; clicking the active one clears the focus. */
export function TraceControl(props: { id: string; what: 'field' | 'form' | 'event' }) {
  const isActive = (direction: FocusDir): boolean => focus() === props.id && focusDir() === direction;
  const onTrace = function onTrace(direction: FocusDir): void {
    if (isActive(direction)) { setFocus(''); return; }
    setExplore(null);
    setPair(null);
    setFocusDir(direction);
    setFocus(props.id);
  };
  return (
    <div class="focus-box">
      <HintHeading title="Show chain" hint={'Narrows the graph to the chain of dependencies running through this ' + props.what + (props.what === 'field' ? '' : ' (through any of its fields)') + ', as many steps as the depth allows. Stays at the current level and keeps what is expanded.'} />
      <span class="seg">
        <For each={TRACE_DIRECTIONS}>{([direction, label, tip]) => (
          <button class={isActive(direction) ? 'btn sm primary' : 'btn sm'} title={tip} onClick={() => onTrace(direction)}>{label}</button>
        )}</For>
      </span>
      <Show when={focus() === props.id}><DepthControls /></Show>
    </div>
  );
}
