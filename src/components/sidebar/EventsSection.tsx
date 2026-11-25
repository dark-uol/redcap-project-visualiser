import { createMemo } from 'solid-js';
import { withFlags } from '../../lib/flags';
import type { Arm, EventDef } from '../../lib/types';
import { need, model, filters } from '../../store';
import { EventsSectionView } from './EventsSectionView';
import type { ArmRow } from './EventsSectionView';

const { eventsOn, setEventsOn, crossOnly, setCrossOnly, instanceOnly, setInstanceOnly } = filters;

/** Connector: the events and arms from the model, with the event ticks and the two event filters read from and written to the store. */
export default function EventsSection() {
  const events = (): EventDef[] => need(model()).parsed.events;
  // Rows depend only on the model, so they keep their identity while the ticks change.
  const armRows = createMemo((): ArmRow[] => {
    const parsed = need(model()).parsed;
    const armList: Arm[] = parsed.arms.length ? parsed.arms : [{ num: '', name: '' }];
    return armList.map((arm) => ({ num: arm.num, name: arm.name, events: parsed.events.filter((event) => !arm.num || event.arm === arm.num) }));
  });
  const checkedById = createMemo((): Record<string, boolean> => {
    const on = eventsOn();
    return Object.fromEntries(events().map((event) => [event.id, on[event.id] !== false]));
  });

  // Replaces the whole record, so events from a previous model are dropped.
  const setEvents = (value: boolean): void => {
    setEventsOn(withFlags<Record<string, boolean>>({}, events().map((event) => event.id), value));
  };
  const onAllEvents = function onAllEvents(): void { setEvents(true); };
  const onNoEvents = function onNoEvents(): void { setEvents(false); };
  const onArmToggle = function onArmToggle(eventIds: string[], checked: boolean): void {
    setEventsOn(withFlags(eventsOn(), eventIds, checked));
  };
  const onEventToggle = function onEventToggle(eventId: string, checked: boolean): void {
    setEventsOn(withFlags(eventsOn(), [eventId], checked));
  };

  return (
    <EventsSectionView
      arms={armRows()}
      checkedById={checkedById()}
      crossOnly={crossOnly()}
      instanceOnly={instanceOnly()}
      onCrossOnlyChange={setCrossOnly}
      onInstanceOnlyChange={setInstanceOnly}
      onAllEvents={onAllEvents}
      onNoEvents={onNoEvents}
      onArmToggle={onArmToggle}
      onEventToggle={onEventToggle}
    />
  );
}
