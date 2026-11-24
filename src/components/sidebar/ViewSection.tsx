import { Show } from 'solid-js';
import type { Direction, GroupBy, LabelMode, Level, Renderer } from '../../lib/types';
import { Select, Check } from '../controls';
import {
  need, model, level, setLevel, renderer, setRenderer, dir, setDir, labelMode, setLabelMode, groupBy, setGroupBy,
  instances, setInstances, edgeLabels, setEdgeLabels, hideIsoNodes, setHideIsoNodes, hideIso, setHideIso,
  showMissing, setShowMissing,
} from '../../store';

export default function ViewSection() {
  const hasEvents = (): boolean => (need(model()).parsed.events || []).length > 0;

  return (
    <details class="sec" open>
      <summary><h2>View</h2></summary>
      <label>Level <Select<Level> value={level()} onChange={setLevel} options={[['field', 'Fields'], ['form', 'Forms (aggregated)'], ['event', 'Events (cross-event links)']]} /></label>
      <label>Renderer <Select<Renderer> value={renderer()} onChange={setRenderer} options={[['graphviz', 'Graphviz'], ['mermaid', 'Mermaid']]} /></label>
      <label>Direction <Select<Direction> value={dir()} onChange={setDir} options={[['LR', 'Left → right'], ['TD', 'Top → down']]} /></label>
      <label>Node text <Select<LabelMode> value={labelMode()} onChange={setLabelMode} options={[['var', 'Variable name'], ['label', 'Name + field label']]} /></label>
      <label>Group fields by <Select<GroupBy> value={groupBy()} onChange={setGroupBy} options={[['form', 'Form'], ['event', 'Event (longitudinal)'], ['arm', 'Arm (longitudinal)'], ['none', 'No grouping']]} /></label>
      <Show when={level() === 'form' && hasEvents()}>
        <Check checked={instances()} onChange={setInstances} label="Instances (one node per form per event)" />
        <Show when={instances()}>
          <p class="muted small" style="margin:0 0 6px">A form collected in several events gets one node per event, banded by event (or by arm via Group by). Select a node to expand its back / forward references or zoom into its fields.</p>
        </Show>
      </Show>
      <Check checked={edgeLabels()} onChange={setEdgeLabels} label="Edge labels" />
      <Show when={level() !== 'field'}>
        <Check checked={hideIsoNodes()} onChange={setHideIsoNodes} label={(level() === 'event' ? 'Hide events' : 'Hide forms') + ' with no dependencies'} />
      </Show>
      <Show when={level() !== 'event'}>
        <Check checked={hideIso()} onChange={setHideIso} label="Hide fields with no dependencies" />
      </Show>
      <Check checked={showMissing()} onChange={setShowMissing} label="Show undefined references" />
    </details>
  );
}
