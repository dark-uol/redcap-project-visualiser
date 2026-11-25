/** Focus controls shared by the sidebar and the detail panel: direction, depth, and a note when depth hides part of the chain. */
import { focusing, view, clampDepth, setExplore, model, selection } from '../store';
import { MAX_FOCUS_DEPTH, focusKind } from '../lib/graph';
import type { FocusDir } from '../lib/types';
import { DepthControlsView, FocusControlsView, TraceControlView } from './FocusControlsView';

const { focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, setPair } = focusing;

/** Max-depth stepper plus the "depth hides N fields" note. */
export function DepthControls() {
  const onDepthChange = function onDepthChange(raw: string): number {
    setFocusDepth(raw);
    return clampDepth(raw);
  };
  const onDepthStep = function onDepthStep(delta: number): void {
    setFocusDepth(focusDepth() + delta);
  };
  const onShowFullChain = function onShowFullChain(): void {
    setFocusDepth(MAX_FOCUS_DEPTH);
  };
  const hiddenCount = (): number => view()?.focusHidden ?? 0;
  const noun = (): 'field' | 'event' => (selection.level() === 'event' && model() && focusKind(model() as NonNullable<ReturnType<typeof model>>, focus()) === 'event' ? 'event' : 'field');
  return (
    <DepthControlsView
      depth={focusDepth()}
      hiddenCount={hiddenCount()}
      noun={noun()}
      maxDepth={MAX_FOCUS_DEPTH}
      onDepthChange={onDepthChange}
      onDepthStep={onDepthStep}
      onShowFullChain={onShowFullChain}
    />
  );
}

/** Sidebar form: direction as a select, then the depth controls. */
export default function FocusControls() {
  const onDirectionChange = function onDirectionChange(direction: FocusDir): void {
    setFocusDir(direction);
  };
  return (
    <FocusControlsView direction={focusDir()} onDirectionChange={onDirectionChange}>
      <DepthControls />
    </FocusControlsView>
  );
}

/** Detail-panel form: one segmented control. Clicking a direction focuses the graph on this field; clicking the active one clears the focus. */
export function TraceControl(props: { id: string; what: 'field' | 'form' | 'event' }) {
  const activeDirection = (): FocusDir | null => (focus() === props.id ? focusDir() : null);
  const onTrace = function onTrace(direction: FocusDir): void {
    if (focus() === props.id && focusDir() === direction) { setFocus(''); return; }
    setExplore(null);
    setPair(null);
    setFocusDir(direction);
    setFocus(props.id);
  };
  return (
    <TraceControlView what={props.what} activeDirection={activeDirection()} onTrace={onTrace}>
      <DepthControls />
    </TraceControlView>
  );
}
