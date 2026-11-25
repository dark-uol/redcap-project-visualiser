/* Spike: swimlane graph connector. Lays the instance view out with layoutSwimlane and draws it with LayoutSvgView, no SVG renderer involved. */
import { createMemo, Show } from 'solid-js';
import { model, view, selection } from '../store';
import { layoutSwimlane } from '../lib/layoutSwimlane';
import type { ViewNode } from '../lib/types';
import Detail from './Detail';
import { LayoutSvgView } from './LayoutSvgView';

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
      <div class="graphbar"><span class="muted">Swimlane layout (spike)</span></div>
      <div id="graphwrap">
        <div id="stage" style="overflow:auto">
          <Show when={layout()} fallback={<div id="msg"><div>Swimlanes need form instances: set Level to Forms and tick “Instances” (longitudinal projects only).</div></div>}>
            {(currentLayout) => (
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
            )}
          </Show>
        </div>
        <Detail />
      </div>
    </div>
  );
}
