import { describe, expect, it, vi } from 'vitest';
import { EventsSectionView } from '../src/components/sidebar/EventsSectionView';
import type { ArmRow } from '../src/components/sidebar/EventsSectionView';
import type { EventDef } from '../src/lib/types';
import { renderComponent } from './renderComponent';

function event(id: string, label: string, arm: string, repeating = false): EventDef {
  return { id, label, arm, armName: arm ? 'Arm ' + arm : '', repeating, forms: ['f1', 'f2'] };
}

const ARMS: ArmRow[] = [
  { num: '1', name: 'Control', events: [event('baseline', 'Baseline', '1'), event('week4', 'Week 4', '1', true)] },
  { num: '2', name: 'Treatment', events: [event('baseline2', 'Baseline', '2')] },
];

function renderEvents(overrides: Partial<{ arms: ArmRow[]; checkedById: Record<string, boolean>; crossOnly: boolean; instanceOnly: boolean }> = {}) {
  const handlers = {
    onCrossOnlyChange: vi.fn((_value: boolean) => {}),
    onInstanceOnlyChange: vi.fn((_value: boolean) => {}),
    onAllEvents: vi.fn(),
    onNoEvents: vi.fn(),
    onArmToggle: vi.fn((_eventIds: string[], _checked: boolean) => {}),
    onEventToggle: vi.fn((_eventId: string, _checked: boolean) => {}),
  };
  const container = renderComponent(() => (
    <EventsSectionView
      arms={overrides.arms ?? ARMS}
      checkedById={overrides.checkedById ?? { baseline: true, week4: true, baseline2: true }}
      crossOnly={overrides.crossOnly ?? false}
      instanceOnly={overrides.instanceOnly ?? false}
      onCrossOnlyChange={handlers.onCrossOnlyChange}
      onInstanceOnlyChange={handlers.onInstanceOnlyChange}
      onAllEvents={handlers.onAllEvents}
      onNoEvents={handlers.onNoEvents}
      onArmToggle={handlers.onArmToggle}
      onEventToggle={handlers.onEventToggle}
    />
  ));
  const boxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('#events input'));
  return { container, handlers, boxes };
}

describe('EventsSectionView', () => {
  it('shows each arm heading, then its events with the repeating mark and form count', () => {
    const { container } = renderEvents();
    const rows = Array.from(container.querySelectorAll('.armrow'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('b')?.textContent).toBe('Control');
    expect(rows[0].textContent).toContain('Week 4 ↻ (2)');
    expect(rows[0].textContent).not.toContain('Baseline ↻');
  });

  it('omits the arm checkbox for the unnamed pseudo-arm', () => {
    const { container } = renderEvents({ arms: [{ num: '', name: '', events: [event('visit', 'Visit', '')] }], checkedById: { visit: true } });
    expect(container.querySelectorAll('#events input').length).toBe(1);
    expect(container.querySelector('#events .armrow label')?.textContent).toContain('Visit');
  });

  it('ticks an arm box only when every event in that arm is on', () => {
    const { boxes } = renderEvents({ checkedById: { baseline: true, week4: false, baseline2: true } });
    // Order: arm 1 box, its two events, arm 2 box, its one event.
    expect(boxes().map((box) => box.checked)).toEqual([false, true, false, true, true]);
  });

  it('calls onArmToggle with every event id in that arm', () => {
    const { boxes, handlers } = renderEvents();
    const armBox = boxes()[0];
    armBox.checked = false;
    armBox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(handlers.onArmToggle).toHaveBeenCalledWith(['baseline', 'week4'], false);
  });

  it('calls onEventToggle with the event id and new state', () => {
    const { boxes, handlers } = renderEvents();
    const week4 = boxes()[2];
    week4.checked = false;
    week4.dispatchEvent(new Event('change', { bubbles: true }));
    expect(handlers.onEventToggle).toHaveBeenCalledWith('week4', false);
  });

  it('runs all and none without toggling the summary', () => {
    const { container, handlers } = renderEvents();
    const [all, none] = Array.from(container.querySelectorAll<HTMLButtonElement>('summary button.link'));
    const allEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(all.dispatchEvent(allEvent)).toBe(false);
    none.click();
    expect(handlers.onAllEvents).toHaveBeenCalledOnce();
    expect(handlers.onNoEvents).toHaveBeenCalledOnce();
  });

  it('reports the two event filters through their callbacks', () => {
    const { container, handlers } = renderEvents({ crossOnly: true });
    const filterBoxes = Array.from(container.querySelectorAll<HTMLInputElement>('.chk input')).filter((box) => box.closest('#events') === null);
    expect(filterBoxes[0].checked).toBe(true);
    filterBoxes[1].checked = true;
    filterBoxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(handlers.onInstanceOnlyChange).toHaveBeenCalledWith(true);
  });
});
