import { For, Show } from 'solid-js';
import { TYPES } from '../lib/graph';

export type LegendViewProps = { formLevel: boolean };

/** Presentational: shows the dependency-type key, plus the line-thickness note at form level. */
export function LegendView(props: LegendViewProps) {
  return (
    <div class="legend">
      <For each={Object.values(TYPES)}>{(t) => <span><i class="sw" style={`border-color:${t.color}`}></i>{t.label}</span>}</For>
      <Show when={props.formLevel}><span><b>Line thickness = number of dependent fields</b> (log scale)</span></Show>
      <span>Nodes: blue = field, orange = calculated, grey = form, red dashed = undefined reference</span>
    </div>
  );
}
