import { need, currentExploration, exploreVisible, setExplore } from '../../store';

export default function ExploringSection() {
  const onExitExploring = function onExitExploring(): void {
    setExplore(null);
  };

  return (
    <details class="sec" open>
      <summary><h2>Exploring</h2></summary>
      <p class="small" style="margin:0 0 6px">{exploreVisible(need(currentExploration())).size} nodes shown. Select a node and use <b>Expand / Collapse</b> in its panel.</p>
      <button class="btn sm" onClick={onExitExploring}>✕ Exit exploring</button>
    </details>
  );
}
