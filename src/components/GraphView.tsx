/* Graph tab: connector that reads the store and renders GraphViewView with the detail panel beside it. */
import { model, view, selection, presentation,svgEl, svgView, busy, renderMsg, tooBig, setForcedFor, dotSrc, setAnchorCapture } from '../store';
import type { ClickAction } from './hitTest';
import Detail from './Detail';
import { GraphViewView } from './GraphViewView';

const { tab, level, selected, setSelected, setSelectedKeepingEdge, setSelectedEdge } = selection;

export default function GraphView() {
  const isForm = (id: string): boolean => !!model()?.formsById.has(id);
  const applyClickAction = function applyClickAction(action: ClickAction): void {
    if (action.type === 'edge') { setSelectedKeepingEdge(null); setSelectedEdge({ from: action.from, to: action.to }); }
    else if (action.type === 'select') setSelected(action.id);
    else if (action.type === 'clear') { setSelected(null); setSelectedEdge(null); } // empty background closes the detail pane
  };
  const renderAnyway = function renderAnyway(): void { setForcedFor(dotSrc()); };
  return (
    <GraphViewView
      svg={svgEl()}
      drawnView={svgView()}
      view={view()}
      selected={selected()}
      activeTab={tab()}
      busy={busy()}
      renderMessage={renderMsg()}
      tooBig={tooBig()}
      lineWidths={presentation.lineWidths() && level() !== 'field'}
      isForm={isForm}
      onClickAction={applyClickAction}
      onRenderAnyway={renderAnyway}
      onAnchorCapture={setAnchorCapture}
    >
      <Detail />
    </GraphViewView>
  );
}
