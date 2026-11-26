import { need, model, selection, effectiveRenderer, instances, setInstances, filters, presentation, captureAnchor } from '../../store';
import type { Renderer } from '../../lib/types';
import { ViewSectionView } from './ViewSectionView';

const { level, setLevel, selected } = selection;

const { hideIsoNodes, setHideIsoNodes, hideIso, setHideIso, showMissing, setShowMissing } = filters;
const { setRenderer, dir, setDir, labelMode, setLabelMode, groupBy, setGroupBy, edgeLabels, setEdgeLabels, lineWidths, setLineWidths } = presentation;

/** Connector: the view options from the store, with each change written back to it. */
export default function ViewSection() {
  const hasEvents = (): boolean => (need(model()).parsed.events || []).length > 0;
  /** The selected node keeps its place on screen across the switch: the stage anchors on it before the new engine draws.
   * Switching renderer only changes geometry, never the view, so nothing else (Instances, exploration) is touched. */
  const changeRenderer = function changeRenderer(next: Renderer): void {
    captureAnchor(selected() ?? '');
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
      lineWidths={lineWidths()}
      hideIsolatedNodes={hideIsoNodes()}
      hideIsolatedFields={hideIso()}
      showMissing={showMissing()}
      onLevelChange={setLevel}
      onRendererChange={changeRenderer}
      onDirectionChange={setDir}
      onLabelModeChange={setLabelMode}
      onGroupByChange={setGroupBy}
      onInstancesChange={setInstances}
      onEdgeLabelsChange={setEdgeLabels}
      onLineWidthsChange={setLineWidths}
      onHideIsolatedNodesChange={setHideIsoNodes}
      onHideIsolatedFieldsChange={setHideIso}
      onShowMissingChange={setShowMissing}
    />
  );
}
