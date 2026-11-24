import { Show } from 'solid-js';
import type { Direction, GroupBy, LabelMode, Level, Renderer } from '../../lib/types';
import { Select, Check, Labeled, createHint, HintToggle, HintText } from '../controls';
import {
  need, model, selection,
  instances, setInstances, filters, presentation,
} from '../../store';

const { level, setLevel } = selection;

const { hideIsoNodes, setHideIsoNodes, hideIso, setHideIso, showMissing, setShowMissing } = filters;
const { renderer, setRenderer, dir, setDir, labelMode, setLabelMode, groupBy, setGroupBy, edgeLabels, setEdgeLabels } = presentation;

export default function ViewSection() {
  const help = createHint();
  const hasEvents = (): boolean => (need(model()).parsed.events || []).length > 0;

  return (
    <details class="sec" open>
      <summary><h2>View <HintToggle help={help} title="View" /></h2></summary>
      <HintText help={help}>How the graph is drawn and which nodes it includes.</HintText>
      <Labeled label="Level" hint="Fields: one node per field. Forms: fields rolled up into forms, with links between forms. Events: only references that name another event, such as [event][field]."><Select<Level> value={level()} onChange={setLevel} options={[['field', 'Fields'], ['form', 'Forms (aggregated)'], ['event', 'Events (cross-event links)']]} /></Labeled>
      <Labeled label="Renderer" hint="Which library draws the graph. Both show the same data; Graphviz is the default."><Select<Renderer> value={renderer()} onChange={setRenderer} options={[['graphviz', 'Graphviz'], ['mermaid', 'Mermaid']]} /></Labeled>
      <Labeled label="Direction" hint="Which way the graph flows: left to right, or top to bottom."><Select<Direction> value={dir()} onChange={setDir} options={[['LR', 'Left → right'], ['TD', 'Top → down']]} /></Labeled>
      <Labeled label="Node text" hint="What each node says: just the variable name, or the name with the field's label."><Select<LabelMode> value={labelMode()} onChange={setLabelMode} options={[['var', 'Variable name'], ['label', 'Name + field label']]} /></Labeled>
      <Labeled label="Group fields by" hint="At field level, draws a box around the fields that share a form, event or arm. Has no effect at form or event level."><Select<GroupBy> value={groupBy()} onChange={setGroupBy} options={[['form', 'Form'], ['event', 'Event (longitudinal)'], ['arm', 'Arm (longitudinal)'], ['none', 'No grouping']]} /></Labeled>
      <Show when={level() === 'form' && hasEvents()}>
        <Check checked={instances()} onChange={setInstances} label="Instances (one node per form per event)" hint="A form collected in several events gets one node per event, banded by event (or by arm via Group by). Select a node to add its links or zoom into its fields." />
      </Show>
      <Check checked={edgeLabels()} onChange={setEdgeLabels} label="Edge labels" hint="Writes the dependency type (branching, calc and so on) on each edge." />
      <Show when={level() !== 'field'}>
        <Check checked={hideIsoNodes()} onChange={setHideIsoNodes} label={(level() === 'event' ? 'Hide events' : 'Hide forms') + ' with no dependencies'} hint="Leaves out nodes that have no links to anything else." />
      </Show>
      <Check checked={hideIso()} onChange={setHideIso} label="Hide fields with no dependencies" hint="Leaves out fields that neither use nor are used by any other field. Applies to fields listed inside a zoomed form." />
      <Check checked={showMissing()} onChange={setShowMissing} label="Show undefined references" hint="Includes names that logic refers to but the project does not define, drawn as separate nodes." />
    </details>
  );
}
