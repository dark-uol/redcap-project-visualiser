/*
 * The one place that builds and reads selected-node ids. Pure.
 *   `@form:<formId>`            a form box (cluster) in the field-level graph
 *   `<variable>@@<instanceId>`  a field expanded inside an instance node (Instances view); instanceId is `form@event`
 *   `<formId>@<eventId>`        an instance node (Instances view): a form collected in 2+ shown events, one node per event
 *   anything else               a plain field, form or event id (a form in a single event keeps its plain form id)
 */

export type Selection =
  | { kind: 'group'; formId: string }
  | { kind: 'instanceField'; variable: string; instanceId: string }
  | { kind: 'plain'; id: string };

const GROUP_PREFIX = '@form:';
const INSTANCE_SEPARATOR = '@@';

/** The id of a form box (cluster) in the graph. */
export function groupIdFor(formId: string): string {
  return GROUP_PREFIX + formId;
}

const INSTANCE_EVENT_SEPARATOR = '@';

/** The id of an instance node: one form as collected in one event. */
export function instanceIdFor(formId: string, eventId: string): string {
  return formId + INSTANCE_EVENT_SEPARATOR + eventId;
}

/** The id of a field node drawn inside an expanded instance node in the Instances view. */
export function instanceFieldIdFor(variable: string, instanceId: string): string {
  return variable + INSTANCE_SEPARATOR + instanceId;
}

/** The form id when `id` is a form box id, else null. */
export function groupFormIdOf(id: string): string | null {
  return id.startsWith(GROUP_PREFIX) ? id.slice(GROUP_PREFIX.length) : null;
}

/**
 * True for ids that exist only in Instances mode: an instance node (`form@event`) or a field expanded inside one
 * (`variable@@form@event`). A form box is never one. A selection like this may not survive a mode switch.
 */
export function isInstanceScopedId(id: string): boolean {
  const selection = parseSelection(id);
  if (selection.kind === 'group') return false;
  if (selection.kind === 'instanceField') return true;
  return selection.id.includes(INSTANCE_EVENT_SEPARATOR);
}

export function parseSelection(id: string): Selection {
  if (id.startsWith(GROUP_PREFIX)) return { kind: 'group', formId: id.slice(GROUP_PREFIX.length) };
  const separatorAt = id.indexOf(INSTANCE_SEPARATOR);
  if (separatorAt > 0) {
    return {
      kind: 'instanceField',
      variable: id.slice(0, separatorAt),
      instanceId: id.slice(separatorAt + INSTANCE_SEPARATOR.length),
    };
  }
  return { kind: 'plain', id };
}
