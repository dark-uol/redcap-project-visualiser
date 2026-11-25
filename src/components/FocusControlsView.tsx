import { For, Show } from 'solid-js';
import type { Element as SolidElement } from 'solid-js';
import type { FocusDir } from '../lib/types';
import { HintHeading, Labeled, Select } from './controls';

const TRACE_DIRECTIONS: [FocusDir, string, string][] = [
  ['up', '▲ depends on', 'Show everything this field depends on, step by step'],
  ['down', '▼ used by', 'Show everything that depends on this field, step by step'],
  ['both', '◆ both', 'Show both directions'],
];

export type DepthControlsViewProps = {
  depth: number;
  hiddenCount: number;
  noun: 'field' | 'event';
  maxDepth: number;
  /** Sets the depth from the typed value and returns the clamped depth, which the input then shows. */
  onDepthChange: (raw: string) => number;
  onDepthStep: (delta: number) => void;
  onShowFullChain: () => void;
};

/** Presentational: max-depth stepper plus the "depth hides N fields" note. */
export function DepthControlsView(props: DepthControlsViewProps) {
  const onDepthDown = function onDepthDown(): void {
    props.onDepthStep(-1);
  };
  const onDepthUp = function onDepthUp(): void {
    props.onDepthStep(1);
  };
  const onDepthInput = function onDepthInput(event: Event & { currentTarget: HTMLInputElement }): void {
    event.currentTarget.value = String(props.onDepthChange(event.currentTarget.value));
  };
  return (
    <>
      <Labeled label="Max depth" hint="How many steps along the dependency links to follow from the field. Raise it to reach further along the chain.">
        <span class="stepper"><button class="btn sm" onClick={onDepthDown}>−</button>
          <input type="number" inputmode="numeric" min="1" max={props.maxDepth} step="1" value={props.depth} onChange={onDepthInput} />
          <button class="btn sm" onClick={onDepthUp}>+</button></span></Labeled>
      <Show when={props.hiddenCount > 0}>
        <p class="small focus-note">Depth {props.depth} hides {props.hiddenCount} more {props.noun}{props.hiddenCount === 1 ? '' : 's'}. <button class="link" onClick={props.onShowFullChain}>Show full chain</button></p>
      </Show>
    </>
  );
}

export type FocusControlsViewProps = {
  direction: FocusDir;
  onDirectionChange: (direction: FocusDir) => void;
  /** The depth controls, rendered after the direction select. */
  children: SolidElement;
};

/** Presentational: sidebar form with direction as a select, then the depth controls slot. */
export function FocusControlsView(props: FocusControlsViewProps) {
  return (
    <>
      <Labeled label="Show" hint="Which way to follow the links: what the field depends on, what depends on it, or both."><Select<FocusDir> value={props.direction} onChange={props.onDirectionChange} options={[['both', 'Upstream + downstream'], ['up', 'Upstream (what it depends on)'], ['down', 'Downstream (what depends on it)']]} /></Labeled>
      {props.children}
    </>
  );
}

export type TraceControlViewProps = {
  what: 'field' | 'form' | 'event';
  /** The direction currently focused on this id, or null when this id is not the focused one. */
  activeDirection: FocusDir | null;
  onTrace: (direction: FocusDir) => void;
  /** The depth controls, shown only while this id is focused. */
  children: SolidElement;
};

/** Presentational: detail-panel segmented control for tracing a chain. The depth slot shows only while a direction is active. */
export function TraceControlView(props: TraceControlViewProps) {
  return (
    <div class="focus-box">
      <HintHeading title="Show chain" hint={'Narrows the graph to the chain of dependencies running through this ' + props.what + (props.what === 'field' ? '' : ' (through any of its fields)') + ', as many steps as the depth allows. Stays at the current level and keeps what is expanded.'} />
      <span class="seg">
        <For each={TRACE_DIRECTIONS}>{([direction, label, tip]) => (
          <button class={props.activeDirection === direction ? 'btn sm primary' : 'btn sm'} title={tip} onClick={() => props.onTrace(direction)}>{label}</button>
        )}</For>
      </span>
      <Show when={props.activeDirection !== null}>{props.children}</Show>
    </div>
  );
}
