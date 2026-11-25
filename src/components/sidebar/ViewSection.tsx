import { need, model, selection, instances, setInstances, filters, presentation } from '../../store';
import { ViewSectionView } from './ViewSectionView';

const { level, setLevel } = selection;

const { hideIsoNodes, setHideIsoNodes, hideIso, setHideIso, showMissing, setShowMissing } = filters;
const { renderer, setRenderer, dir, setDir, labelMode, setLabelMode, groupBy, setGroupBy, edgeLabels, setEdgeLabels } = presentation;

/** Connector: the view options from the store, with each change written back to it. */
export default function ViewSection() {
  const hasEvents = (): boolean => (need(model()).parsed.events || []).length > 0;

  return (
    <ViewSectionView
      level={level()}
      renderer={renderer()}
      direction={dir()}
      labelMode={labelMode()}
      groupBy={groupBy()}
      hasEvents={hasEvents()}
      instances={instances() || renderer() === 'swimlane'}
      edgeLabels={edgeLabels()}
      hideIsolatedNodes={hideIsoNodes()}
      hideIsolatedFields={hideIso()}
      showMissing={showMissing()}
      onLevelChange={setLevel}
      onRendererChange={setRenderer}
      onDirectionChange={setDir}
      onLabelModeChange={setLabelMode}
      onGroupByChange={setGroupBy}
      onInstancesChange={setInstances}
      onEdgeLabelsChange={setEdgeLabels}
      onHideIsolatedNodesChange={setHideIsoNodes}
      onHideIsolatedFieldsChange={setHideIso}
      onShowMissingChange={setShowMissing}
    />
  );
}
