import { need, model, selection, effectiveRenderer, instances, setInstances, filters, presentation, captureAnchor } from '../../store';
import type { Level, Renderer } from '../../lib/types';
import { ViewSectionView } from './ViewSectionView';

const { level, setLevel, selected } = selection;

const { hideIsoNodes, setHideIsoNodes, hideIso, setHideIso, showMissing, setShowMissing } = filters;
const { renderer, setRenderer, dir, setDir, labelMode, setLabelMode, groupBy, setGroupBy, edgeLabels, setEdgeLabels } = presentation;

/** Connector: the view options from the store, with each change written back to it. */
export default function ViewSection() {
  const hasEvents = (): boolean => (need(model()).parsed.events || []).length > 0;
  /** Swimlane draws form instances, so choosing it (or the Forms level while it is chosen) turns Instances on for real. */
  const changeLevel = function changeLevel(next: Level): void {
    if (next === 'form' && renderer() === 'swimlane' && hasEvents()) setInstances(true);
    setLevel(next);
  };
  /** The selected node keeps its place on screen across the switch: the stage anchors on it before the new engine draws. */
  const changeRenderer = function changeRenderer(next: Renderer): void {
    captureAnchor(selected() ?? '');
    if (next === 'swimlane' && level() === 'form' && hasEvents()) setInstances(true);
    setRenderer(next);
  };

  return (
    <ViewSectionView
      level={level()}
      renderer={effectiveRenderer()}
      direction={dir()}
      labelMode={labelMode()}
      groupBy={groupBy()}
      hasEvents={hasEvents()}
      instances={instances()}
      edgeLabels={edgeLabels()}
      hideIsolatedNodes={hideIsoNodes()}
      hideIsolatedFields={hideIso()}
      showMissing={showMissing()}
      onLevelChange={changeLevel}
      onRendererChange={changeRenderer}
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
