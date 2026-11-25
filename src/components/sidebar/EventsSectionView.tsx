import { For, Show } from 'solid-js';
import type { EventDef } from '../../lib/types';
import { Check, createHint, HintToggle, HintText } from '../controls';
import { stopClick } from './stopClick';

/** One arm and the events it collects. With no arms defined, a single unnamed pseudo-arm holds every event. */
export type ArmRow = { num: string; name: string; events: EventDef[] };

export type EventsSectionViewProps = {
  arms: ArmRow[];
  /** Whether each event is ticked, keyed by event id. */
  checkedById: Record<string, boolean>;
  crossOnly: boolean;
  instanceOnly: boolean;
  onCrossOnlyChange: (value: boolean) => void;
  onInstanceOnlyChange: (value: boolean) => void;
  /** Ticks every event. */
  onAllEvents: () => void;
  /** Unticks every event. */
  onNoEvents: () => void;
  /** Ticks or unticks all the given event ids (one arm's events). */
  onArmToggle: (eventIds: string[], checked: boolean) => void;
  onEventToggle: (eventId: string, checked: boolean) => void;
};

/** Presentational: the cross-event and instance filters, plus the events grouped by arm. Owns only the hint's open/closed state. */
export function EventsSectionView(props: EventsSectionViewProps) {
  const help = createHint();
  const onAllEvents = stopClick(function onAllEvents(): void { props.onAllEvents(); });
  const onNoEvents = stopClick(function onNoEvents(): void { props.onNoEvents(); });

  const armToggleHandler = (arm: ArmRow) => function onArmToggle(event: Event & { currentTarget: HTMLInputElement }): void {
    props.onArmToggle(arm.events.map((eventDef) => eventDef.id), event.currentTarget.checked);
  };
  const eventToggleHandler = (eventDef: EventDef) => function onEventToggle(event: Event & { currentTarget: HTMLInputElement }): void {
    props.onEventToggle(eventDef.id, event.currentTarget.checked);
  };

  return (
    <details class="sec">
      <summary><h2>Events &amp; arms <button class="link" onClick={onAllEvents}>all</button> <button class="link" onClick={onNoEvents}>none</button> <HintToggle help={help} title="Events and arms" /></h2></summary>
      <HintText help={help}>Keeps forms collected in the ticked events (↻ = repeating). Combines with the Forms list. The number is how many forms the event collects.</HintText>
      <Check checked={props.crossOnly} onChange={props.onCrossOnlyChange} label="Only cross-event references" hint="Keeps only dependencies whose logic names an event, such as [event][field]." />
      <Check checked={props.instanceOnly} onChange={props.onInstanceOnlyChange} label="Only repeating-instance logic" hint="Keeps only dependencies whose logic uses instance smart variables such as [current-instance]." />
      <div id="events">
        <For each={props.arms}>
          {(arm) => (
            <div class="armrow">
              <Show when={arm.num}>
                <label class="chk"><input type="checkbox" checked={arm.events.every((event) => props.checkedById[event.id])} onChange={armToggleHandler(arm)} /> <b>{arm.name}</b> <span class="muted small">arm {arm.num}</span></label>
              </Show>
              <For each={arm.events}>
                {(event) => (
                  <label class="chk" style="margin-left:14px"><input type="checkbox" checked={props.checkedById[event.id]} onChange={eventToggleHandler(event)} /> {event.label}{event.repeating ? ' ↻' : ''} <span class="muted small">({event.forms.length})</span></label>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </details>
  );
}
