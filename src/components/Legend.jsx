import { For, Show } from 'solid-js';
import { TYPES } from '../lib/graph.js';
import { level } from '../store.js';

export default function Legend() {
  return (
    <div class="legend">
      <For each={Object.values(TYPES)}>{(t) => <span><i class="sw" style={`border-color:${t.color}`}></i>{t.label}</span>}</For>
      <Show when={level() === 'form'}><span><b>Line thickness = number of dependent fields</b> (log scale)</span></Show>
      <span>Nodes: blue = field, orange = calculated, grey = form, red dashed = undefined reference</span>
    </div>
  );
}
