import { describe, expect, it } from 'vitest';
import { activeEventIds, enabledFormIds } from '../src/lib/filterSelection';
import type { EventDef } from '../src/lib/types';

const event = (id: string, forms: string[] = []): EventDef =>
  ({ id, label: id, arm: '1', armName: 'Arm 1', repeating: false, forms });

describe('activeEventIds', () => {
  it('returns null when there are no events', () => {
    expect(activeEventIds([], {})).toBeNull();
  });

  it('returns null when all events are enabled or absent from the map', () => {
    const events = [event('e1'), event('e2')];
    expect(activeEventIds(events, { e1: true })).toBeNull();
    expect(activeEventIds(events, {})).toBeNull();
  });

  it('returns the other events when one is explicitly disabled', () => {
    const events = [event('e1'), event('e2'), event('e3')];
    expect(activeEventIds(events, { e2: false })).toEqual(new Set(['e1', 'e3']));
  });

  it('returns an empty set when every event is disabled', () => {
    expect(activeEventIds([event('e1')], { e1: false })).toEqual(new Set());
  });
});

describe('enabledFormIds', () => {
  const allFormIds = ['demo', 'labs', 'notes'];

  it('keeps every form when nothing is disabled and no event filter is active', () => {
    expect(enabledFormIds(allFormIds, {}, [], null)).toEqual(allFormIds);
  });

  it('drops a form explicitly disabled', () => {
    expect(enabledFormIds(allFormIds, { labs: false }, [], null)).toEqual(['demo', 'notes']);
  });

  it('treats a form absent from the map as on', () => {
    expect(enabledFormIds(allFormIds, { labs: true }, [], null)).toEqual(allFormIds);
  });

  it('drops a form that is in no enabled event when events are filtering', () => {
    const events = [event('e1', ['demo']), event('e2', ['labs'])];
    const activeEvents = activeEventIds(events, { e2: false });
    expect(enabledFormIds(allFormIds, {}, events, activeEvents)).toEqual(['demo']);
  });

  it('keeps a form that is in an enabled event even if it is also in a disabled one', () => {
    const events = [event('e1', ['demo', 'notes']), event('e2', ['labs', 'notes'])];
    const activeEvents = activeEventIds(events, { e2: false });
    expect(enabledFormIds(allFormIds, {}, events, activeEvents)).toEqual(['demo', 'notes']);
  });

  it('keeps a form in no event when no event filter is active', () => {
    const events = [event('e1', ['demo'])];
    expect(enabledFormIds(allFormIds, {}, events, null)).toEqual(allFormIds);
  });

  it('returns an empty list when every form is disabled', () => {
    expect(enabledFormIds(allFormIds, { demo: false, labs: false, notes: false }, [], null)).toEqual([]);
  });

  it('returns an empty list when every event is disabled', () => {
    const events = [event('e1', ['demo'])];
    expect(enabledFormIds(allFormIds, {}, events, activeEventIds(events, { e1: false }))).toEqual([]);
  });
});
