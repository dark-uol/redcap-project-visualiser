import { describe, expect, it, vi } from 'vitest';
import { DepthControlsView, FocusControlsView, TraceControlView } from '../src/components/FocusControlsView';
import type { FocusDir } from '../src/lib/types';
import { renderComponent } from './renderComponent';

function renderDepth(overrides: Partial<{ depth: number; hiddenCount: number; noun: 'field' | 'event'; clampTo: number }> = {}) {
  const handlers = {
    onDepthChange: vi.fn((_raw: string) => overrides.clampTo ?? 5),
    onDepthStep: vi.fn((_delta: number) => {}),
    onShowFullChain: vi.fn(),
  };
  const container = renderComponent(() => (
    <DepthControlsView
      depth={overrides.depth ?? 2}
      hiddenCount={overrides.hiddenCount ?? 0}
      noun={overrides.noun ?? 'field'}
      maxDepth={10}
      onDepthChange={handlers.onDepthChange}
      onDepthStep={handlers.onDepthStep}
      onShowFullChain={handlers.onShowFullChain}
    />
  ));
  return { container, handlers };
}

describe('DepthControlsView', () => {
  it('calls onDepthStep with -1 and +1 from the stepper buttons', async () => {
    const { container, handlers } = renderDepth();
    const buttons = container.querySelectorAll<HTMLButtonElement>('.stepper button');
    buttons[0].click();
    await Promise.resolve();
    buttons[1].click();
    await Promise.resolve();
    expect(handlers.onDepthStep.mock.calls).toEqual([[-1], [1]]);
  });

  it('hides the note when nothing is hidden', () => {
    const { container } = renderDepth({ hiddenCount: 0 });
    expect(container.querySelector('.focus-note')).toBeNull();
  });

  it('uses the singular for one hidden item and the plural otherwise', () => {
    expect(renderDepth({ depth: 2, hiddenCount: 1 }).container.textContent).toContain('Depth 2 hides 1 more field. ');
    expect(renderDepth({ depth: 2, hiddenCount: 3 }).container.textContent).toContain('Depth 2 hides 3 more fields');
  });

  it('names events when the noun is event', () => {
    expect(renderDepth({ depth: 1, hiddenCount: 2, noun: 'event' }).container.textContent).toContain('Depth 1 hides 2 more events');
  });

  it('calls onShowFullChain from the Show full chain button', async () => {
    const { container, handlers } = renderDepth({ hiddenCount: 1 });
    (container.querySelector('.focus-note button') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(handlers.onShowFullChain).toHaveBeenCalledOnce();
  });

  it('passes the typed value to onDepthChange and writes back the returned depth', () => {
    const { container, handlers } = renderDepth({ clampTo: 5 });
    const input = container.querySelector('input') as HTMLInputElement;
    input.value = '99';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(handlers.onDepthChange).toHaveBeenCalledWith('99');
    expect(input.value).toBe('5');
  });
});

function renderTrace(activeDirection: FocusDir | null) {
  const handlers = { onTrace: vi.fn((_direction: FocusDir) => {}) };
  const container = renderComponent(() => (
    <TraceControlView what="field" activeDirection={activeDirection} onTrace={handlers.onTrace}>
      <span class="kid">depth</span>
    </TraceControlView>
  ));
  return { container, handlers };
}

describe('TraceControlView', () => {
  it('renders the three direction buttons and marks the active one as primary', () => {
    const { container } = renderTrace('down');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.seg button'));
    expect(buttons.map((button) => button.textContent)).toEqual(['▲ depends on', '▼ used by', '◆ both']);
    expect(buttons.map((button) => button.classList.contains('primary'))).toEqual([false, true, false]);
  });

  it('calls onTrace with the clicked direction', async () => {
    const { container, handlers } = renderTrace(null);
    (container.querySelectorAll<HTMLButtonElement>('.seg button')[2]).click();
    await Promise.resolve();
    expect(handlers.onTrace).toHaveBeenCalledWith('both');
  });

  it('shows the depth controls only when a direction is active', () => {
    expect(renderTrace('up').container.querySelector('.kid')).not.toBeNull();
    expect(renderTrace(null).container.querySelector('.kid')).toBeNull();
  });
});

describe('FocusControlsView', () => {
  it('calls onDirectionChange with the selected direction', () => {
    const onDirectionChange = vi.fn((_direction: FocusDir) => {});
    const container = renderComponent(() => (
      <FocusControlsView direction="both" onDirectionChange={onDirectionChange}>
        <span class="kid">depth</span>
      </FocusControlsView>
    ));
    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = 'up';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onDirectionChange).toHaveBeenCalledWith('up');
    expect(container.querySelector('.kid')).not.toBeNull();
  });
});
