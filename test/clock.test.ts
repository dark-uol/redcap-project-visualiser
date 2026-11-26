/** The injected clock: what "today" means in logic is a parameter, not the machine's date. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildModel } from '../src/lib/graph';
import { evaluateCondition } from '../src/lib/logic';
import type { LogicLookup } from '../src/lib/logic';
import type { Field, ParsedODM } from '../src/lib/types';
import { ANY_EVENT, evaluateVisibility } from '../src/lib/whatIf';

const lookup = (today?: string): LogicLookup => ({ field: () => undefined, smart: () => undefined, ...(today === undefined ? {} : { today: () => today }) });
const sameDay = (start: string, today?: string) => evaluateCondition('datediff("' + start + '", "today", "d") = 0', lookup(today)).result;

afterEach(() => { vi.useRealTimers(); });

describe('injected clock', () => {
  it('makes "today" the injected date', () => {
    expect(sameDay('2021-06-15', '2021-06-15')).toBe(true);
    expect(sameDay('2021-06-15', '2021-06-16')).toBe(false);
    expect(sameDay('2024-02-29', '2024-02-29')).toBe(true);
    expect(evaluateCondition('datediff("2024-02-28", "today", "d") = 1', lookup('2024-02-29')).result).toBe(true);
  });

  it('falls back to the system clock\'s local date when none is injected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 5, 14, 23, 59)); // local time, late in the evening
    expect(sameDay('2023-06-14')).toBe(true);
    expect(sameDay('2023-06-15')).toBe(false);
  });

  it('is an error, not a silent fallback, when the injected date is not a real date', () => {
    ['2021-02-30', '2021-13-01', '21-06-15', '2021/06/15', '0999-01-01', '2021-6-5', 'today', ''].forEach((bad) => {
      expect(() => evaluateCondition('datediff("2020-01-01", "today", "d")', lookup(bad)), bad).toThrow(/YYYY-MM-DD/);
    });
  });

  it('reaches field logic through the What if context', () => {
    const field = (variable: string, over: Partial<Field> = {}): Field => ({
      variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '', required: false, choices: [], form: 'f', ...over,
    });
    const fields = [field('dob'), field('adult', { branching: 'datediff([dob], "today", "y") >= 18' })];
    const parsed: ParsedODM = { projectName: 't', redcapVersion: '0', forms: [{ id: 'f', label: 'f', repeating: false, fields: ['dob', 'adult'] }], fields, formLogic: [], logicSources: [], events: [], arms: [], repeatingInstruments: [] };
    const model = buildModel(parsed);
    const stateOn = (today: string) => evaluateVisibility(model, { values: { [ANY_EVENT]: { dob: '2005-06-15' } }, mode: 'form', event: null, today }).get('adult')?.state;
    expect(stateOn('2023-06-14')).toBe('hidden');
    expect(stateOn('2023-06-17')).toBe('shown');
  });
});
