/* Pure helpers that decide which events and forms the view keeps. Framework-free. */
import type { EventDef } from './types';

/** Ids of the enabled events when at least one event is explicitly disabled (=== false); otherwise null (no event filter). */
export function activeEventIds(events: EventDef[], eventsEnabled: Record<string, boolean>): Set<string> | null {
  const anyDisabled = events.some((event) => eventsEnabled[event.id] === false);
  if (!anyDisabled) return null;
  return new Set(events.filter((event) => eventsEnabled[event.id] !== false).map((event) => event.id));
}

/** Form ids not explicitly disabled and, when an event filter is active (activeEvents non-null), collected in at least one enabled event. */
export function enabledFormIds(
  allFormIds: string[],
  formsEnabled: Record<string, boolean>,
  events: EventDef[],
  activeEvents: Set<string> | null,
): string[] {
  const formsInEnabledEvents = activeEvents
    ? new Set(events.filter((event) => activeEvents.has(event.id)).flatMap((event) => event.forms))
    : null;
  return allFormIds.filter((formId) => formsEnabled[formId] !== false && (!formsInEnabledEvents || formsInEnabledEvents.has(formId)));
}
