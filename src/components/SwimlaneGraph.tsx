/* Spike: swimlane graph connector. Lays the instance view out with layoutSwimlane and draws it with LayoutSvgView, no SVG renderer involved. */
import { createMemo, Show } from 'solid-js';
import { model, view, selection } from '../store';
import { layoutSwimlane } from '../lib/layoutSwimlane';
import type { ViewNode } from '../lib/types';
import Detail from './Detail';
import { LayoutSvgView } from './LayoutSvgView';
import { PanZoomStageView } from './PanZoomStageView';

const { selected, setSelected, selectedEdge, setSelectedEdge, setSelectedKeepingEdge } = selection;

export default function SwimlaneGraph() {
  const nodesById = createMemo(() => new Map<string, ViewNode>((view()?.nodes ?? []).map((node) => [node.id, node])));
  const layout = createMemo(() => {
    const currentView = view(), currentModel = model();
    return currentView && currentModel && currentView.instances ? layoutSwimlane(currentView, currentModel.parsed.events) : null;
  });
  const selectNode = function selectNode(id: string): void { setSelected(id); };
  const selectEdge = function selectEdge(from: string, to: string): void { setSelectedKeepingEdge(null); setSelectedEdge({ from, to }); };
  const clearSelection = function clearSelection(): void { setSelected(null); setSelectedEdge(null); };
  return (
    <div>
      <div id="graphwrap">
        <Show when={layout()} fallback={<div id="stage"><div id="msg"><div>Swimlanes show form instances: set Level to Forms (longitudinal projects only).</div></div></div>}>
          {(currentLayout) => (
            <PanZoomStageView contentWidth={currentLayout().width} contentHeight={currentLayout().height}>
              <LayoutSvgView
                layout={currentLayout()}
                nodeLabel={(id) => nodesById().get(id)?.label ?? id}
                nodeSublabel={(id) => nodesById().get(id)?.sub ?? ''}
                selected={selected()}
                selectedEdge={selectedEdge()}
                onSelectNode={selectNode}
                onSelectEdge={selectEdge}
                onClear={clearSelection}
              />
            </PanZoomStageView>
          )}
        </Show>
        <Detail />
      </div>
    </div>
  );
}
