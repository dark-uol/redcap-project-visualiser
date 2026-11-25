/* Dependency structure matrix: connector that reads the store and renders MatrixTabView. */
import { createMemo } from 'solid-js';
import { buildMatrix } from '../lib/matrix';
import type { MxData } from '../lib/matrix';
import { need, model, view, presentation, mxCell, setMxCell, selection } from '../store';
import { MatrixTabView } from './MatrixTabView';
import Detail from './Detail';

const { setSelected } = selection;

const { groupBy } = presentation;

export default function MatrixTab() {
  const data = createMemo<MxData>(() =>
    buildMatrix(need(view()), need(model()), { groupBy: groupBy(), cellOverride: mxCell() }),
  );
  const levelNoun = (): 'fields' | 'nodes' => (view() && view()?.level === 'field' ? 'fields' : 'nodes');

  return (
    <MatrixTabView data={data()} levelNoun={levelNoun()} onCellSizeChange={setMxCell} onSelect={setSelected}>
      <Detail />
    </MatrixTabView>
  );
}
