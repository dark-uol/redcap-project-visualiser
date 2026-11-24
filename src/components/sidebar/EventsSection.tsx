import { For, Show } from 'solid-js';
import { withFlags } from '../../lib/flags';
import type { Arm, EventDef } from '../../lib/types';
import { Check, createHint, HintToggle, HintText } from '../controls';
import { need, model, filters } from '../../store';
import { stopClick } from './stopClick';

const { eventsOn, setEventsOn, crossOnly, setCrossOnly, instanceOnly, setInstanceOnly } = filters;

export default function EventsSection() {
  const help = createHint();
  const events = (): EventDef[] => need(model()).parsed.events;
  const arms = (): Arm[] => need(model()).parsed.arms;

  /** Events belonging to one arm; with no arm number (no arms defined) that is every event. */
  const armEvents = (arm: Arm): EventDef[] => events().filter((event) => !arm.num || event.arm === arm.num);
  // Replaces the whole record, so events from a previous model are dropped.
  const setEvents = (value: boolean): void => {
    setEventsOn(withFlags<Record<string, boolean>>({}, events().map((event) => event.id), value));
  };
  const setArm = (arm: Arm, value: boolean): void => {
    setEventsOn(withFlags(eventsOn(), armEvents(arm).map((event) => event.id), value));
  };

  const onAllEvents = stopClick(function onAllEvents(): void { setEvents(true); });
  const onNoEvents = stopClick(function onNoEvents(): void { setEvents(false); });

  /** Shown arms: the defined arms, or one unnamed pseudo-arm when the project has none. */
  const armRows = (): Arm[] => arms().length ? arms() : [{ num: '', name: '' }];

  const armToggleHandler = (arm: Arm) => function onArmToggle(event: Event & { currentTarget: HTMLInputElement }): void {
    setArm(arm, event.currentTarget.checked);
  };
  const eventToggleHandler = (eventDef: EventDef) => function onEventToggle(event: Event & { currentTarget: HTMLInputElement }): void {
    setEventsOn(withFlags(eventsOn(), [eventDef.id], event.currentTarget.checked));
  };

  return (
    <details class="sec">
      <summary><h2>Events &amp; arms <button class="link" onClick={onAllEvents}>all</button> <button class="link" onClick={onNoEvents}>none</button> <HintToggle help={help} title="Events and arms" /></h2></summary>
      <HintText help={help}>Keeps forms collected in the ticked events (↻ = repeating). Combines with the Forms list. The number is how many forms the event collects.</HintText>
      <Check checked={crossOnly()} onChange={setCrossOnly} label="Only cross-event references" hint="Keeps only dependencies whose logic names an event, such as [event][field]." />
      <Check checked={instanceOnly()} onChange={setInstanceOnly} label="Only repeating-instance logic" hint="Keeps only dependencies whose logic uses instance smart variables such as [current-instance]." />
      <div id="events">
        <For each={armRows()}>
          {(arm) => (
            <div class="armrow">
              <Show when={arm.num}>
                <label class="chk"><input type="checkbox" checked={armEvents(arm).every((event) => eventsOn()[event.id] !== false)} onChange={armToggleHandler(arm)} /> <b>{arm.name}</b> <span class="muted small">arm {arm.num}</span></label>
              </Show>
              <For each={armEvents(arm)}>
                {(event) => (
                  <label class="chk" style="margin-left:14px"><input type="checkbox" checked={eventsOn()[event.id] !== false} onChange={eventToggleHandler(event)} /> {event.label}{event.repeating ? ' ↻' : ''} <span class="muted small">({event.forms.length})</span></label>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </details>
  );
}
