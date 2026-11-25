import { Show } from 'solid-js';
import type { Direction, GroupBy, LabelMode, Level, Renderer } from '../../lib/types';
import { Select, Check, Labeled, createHint, HintToggle, HintText } from '../controls';

export type ViewSectionViewProps = {
  level: Level;
  renderer: Renderer;
  direction: Direction;
  labelMode: LabelMode;
  groupBy: GroupBy;
  /** Whether the project defines any events. The instances option only applies to a longitudinal project. */
  hasEvents: boolean;
  instances: boolean;
  edgeLabels: boolean;
  hideIsolatedNodes: boolean;
  hideIsolatedFields: boolean;
  showMissing: boolean;
  onLevelChange: (level: Level) => void;
  onRendererChange: (renderer: Renderer) => void;
  onDirectionChange: (direction: Direction) => void;
  onLabelModeChange: (labelMode: LabelMode) => void;
  onGroupByChange: (groupBy: GroupBy) => void;
  onInstancesChange: (value: boolean) => void;
  onEdgeLabelsChange: (value: boolean) => void;
  onHideIsolatedNodesChange: (value: boolean) => void;
  onHideIsolatedFieldsChange: (value: boolean) => void;
  onShowMissingChange: (value: boolean) => void;
};

/** Presentational: the view options (level, renderer, layout, labels, grouping and which nodes are included). Owns only the hint's open/closed state. */
export function ViewSectionView(props: ViewSectionViewProps) {
  const help = createHint();
  /** The swimlane spike needs events and a form or event level. It stays listed when it is already the current renderer, so the select never shows blank. */
  const rendererOptions = (): [Renderer, string][] => {
    const options: [Renderer, string][] = [['graphviz', 'Graphviz'], ['mermaid', 'Mermaid']];
    if ((props.hasEvents && props.level !== 'field') || props.renderer === 'swimlane') options.push(['swimlane', 'Swimlane (spike)']);
    return options;
  };
  return (
    <details class="sec" open>
      <summary><h2>View <HintToggle help={help} title="View" /></h2></summary>
      <HintText help={help}>How the graph is drawn and which nodes it includes.</HintText>
      <Labeled label="Level" hint="Fields: one node per field. Forms: fields rolled up into forms, with links between forms. Events: only references that name another event, such as [event][field]."><Select<Level> value={props.level} onChange={props.onLevelChange} options={[['field', 'Fields'], ['form', 'Forms (aggregated)'], ['event', 'Events (cross-event links)']]} /></Labeled>
      <Labeled label="Renderer" hint="Which library draws the graph. Both show the same data; Graphviz is the default."><Select<Renderer> value={props.renderer} onChange={props.onRendererChange} options={rendererOptions()} /></Labeled>
      <Show when={props.renderer !== 'swimlane'}>
        <Labeled label="Direction" hint="Which way the graph flows: left to right, or top to bottom."><Select<Direction> value={props.direction} onChange={props.onDirectionChange} options={[['LR', 'Left → right'], ['TD', 'Top → down']]} /></Labeled>
      </Show>
      <Labeled label="Node text" hint="What each node says: just the variable name, or the name with the field's label."><Select<LabelMode> value={props.labelMode} onChange={props.onLabelModeChange} options={[['var', 'Variable name'], ['label', 'Name + field label']]} /></Labeled>
      <Show when={props.level === 'field'}>
        <Labeled label="Group fields by" hint="Draws a box around the fields that share a form, event or arm."><Select<GroupBy> value={props.groupBy} onChange={props.onGroupByChange} options={[['form', 'Form'], ['event', 'Event (longitudinal)'], ['arm', 'Arm (longitudinal)'], ['none', 'No grouping']]} /></Labeled>
      </Show>
      <Show when={props.level === 'form' && props.hasEvents && props.renderer !== 'swimlane'}>
        <Check checked={props.instances} onChange={props.onInstancesChange} label="Instances (one node per form per event)" hint="A form collected in several events gets one node per event, banded by event (or by arm via Group by). Select a node to add its links or zoom into its fields." />
      </Show>
      <Show when={props.renderer !== 'swimlane'}>
        <Check checked={props.edgeLabels} onChange={props.onEdgeLabelsChange} label="Edge labels" hint="Writes the dependency type (branching, calc and so on) on each edge." />
      </Show>
      <Show when={props.level !== 'field'}>
        <Check checked={props.hideIsolatedNodes} onChange={props.onHideIsolatedNodesChange} label={(props.level === 'event' ? 'Hide events' : 'Hide forms') + ' with no dependencies'} hint="Leaves out nodes that have no links to anything else." />
      </Show>
      <Check checked={props.hideIsolatedFields} onChange={props.onHideIsolatedFieldsChange} label="Hide fields with no dependencies" hint="Leaves out fields that neither use nor are used by any other field. Applies to fields listed inside a zoomed form." />
      <Check checked={props.showMissing} onChange={props.onShowMissingChange} label="Show undefined references" hint="Includes names that logic refers to but the project does not define, drawn as separate nodes." />
    </details>
  );
}
