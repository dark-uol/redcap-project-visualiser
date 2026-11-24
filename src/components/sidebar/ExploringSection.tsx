import { need, currentExploration, exploreVisible, setExplore } from '../../store';
import { createHint, HintToggle, HintText } from '../controls';

export default function ExploringSection() {
  const help = createHint();
  const onExitExploring = function onExitExploring(): void {
    setExplore(null);
  };

  return (
    <details class="sec" open>
      <summary><h2>Exploring <HintToggle help={help} title="Exploring" /></h2></summary>
      <HintText help={help}>The graph shows only what you have added with Add to graph in a node's panel. Exit to go back to the full graph.</HintText>
      <p class="small" style="margin:0 0 6px">{exploreVisible(need(currentExploration())).size} nodes shown. Select a node and use <b>Add to graph</b> in its panel.</p>
      <button class="btn sm" onClick={onExitExploring}>✕ Exit exploring</button>
    </details>
  );
}
