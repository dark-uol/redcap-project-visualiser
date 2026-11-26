/**
 * Derived values: a calculated field, or a field with a top-level @DEFAULT, takes its value from its inputs when none is set.
 * The chain is the public NHS number modulus-11 check, written here from the algorithm, with its own field names.
 */
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/lib/graph';
import { pipedTextExpression } from '../src/lib/logic';
import type { EventDef, Field, ParsedODM } from '../src/lib/types';
import { ANY_EVENT, controllersOf, derivedValue, derivedValues, evaluateVisibility, topLevelDefault } from '../src/lib/whatIf';
import type { WhatIfContext, WhatIfValue } from '../src/lib/whatIf';

const field = (variable: string, form: string, over: Partial<Field> = {}): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form, ...over,
});
const calculated = (variable: string, form: string, calc: string): Field => field(variable, form, { type: 'calc', calc, annotation: '@HIDDEN' });
const eventOf = (id: string, forms: string[]): EventDef => ({ id, label: id, arm: '1', armName: 'Arm 1', repeating: false, forms });

/** weights 10 down to 2 over digits 1 to 9, mod 11, the check digit being 11 minus the remainder (11 meaning 0) */
const WEIGHTED_SUM = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((position) => `(mid([nhs_copy],${position},1)*${11 - position})`).join(' + ');

const fields: Field[] = [
  field('nhs_entered', 'f_reg'),
  field('nhs_copy', 'f_cons', { annotation: "@CHARLIMIT=10 @DEFAULT='[registration][nhs_entered]'" }),
  calculated('nhs_sum', 'f_cons', WEIGHTED_SUM),
  calculated('nhs_quotient', 'f_cons', 'rounddown(([nhs_sum] / 11),0)'),
  calculated('nhs_remainder', 'f_cons', '[nhs_sum] - ([nhs_quotient] * 11)'),
  calculated('nhs_check', 'f_cons', '11 - [nhs_remainder]'),
  calculated('nhs_last', 'f_cons', 'mid([nhs_copy],10,1)'),
  calculated('nhs_valid', 'f_cons', 'if(([nhs_check] <> 11 and [nhs_check] <> [nhs_last]) or ([nhs_check] = 11 and [nhs_last] <> 0), 0, 1)'),
  field('nhs_warning', 'f_cons', { branching: "[nhs_copy] <> '' and [nhs_valid] = 0" }),
  // a chain that depends on itself
  calculated('loop_a', 'f_reg', '[loop_b] + 1'),
  calculated('loop_b', 'f_reg', '[loop_a] + 1'),
  field('loop_gate', 'f_reg', { branching: '[loop_a] > 0' }),
  // a calculation in another event reads its own event's fields
  field('score', 'f_later'),
  calculated('doubled', 'f_later', '[score] * 2'),
  field('reads_doubled', 'f_reg', { branching: '[later][doubled] = 8' }),
  // defaults
  field('plain_default', 'f_reg', { annotation: "@DEFAULT='7'" }),
  field('reads_plain_default', 'f_reg', { branching: '[plain_default] = 7' }),
  field('conditional_default', 'f_reg', { annotation: "@IF([nhs_entered] = '1', @DEFAULT='7', @DEFAULT='8')" }),
  field('reads_conditional_default', 'f_reg', { branching: '[conditional_default] = 7' }),
];

const parsed: ParsedODM = {
  projectName: 'derive', redcapVersion: '0', fields, formLogic: [], logicSources: [], arms: [], repeatingInstruments: [],
  forms: ['f_reg', 'f_cons', 'f_later'].map((id) => ({ id, label: id, repeating: false, fields: fields.filter((item) => item.form === id).map((item) => item.variable) })),
  events: [eventOf('registration', ['f_reg']), eventOf('consent', ['f_cons']), eventOf('later', ['f_later'])],
};
const model = buildModel(parsed);

const resultFor = (values: Record<string, Record<string, WhatIfValue>>, over: Partial<WhatIfContext> = {}) =>
  evaluateVisibility(model, { values, mode: 'form', event: 'consent', derive: true, ...over });

const VALID = '9434765919';
const INVALID = '9434765918'; // the same number with a wrong check digit

describe('a chain of calculations fed by a piped default', () => {
  it('shows the warning for a number that fails the check and hides it for one that passes', () => {
    expect(resultFor({ registration: { nhs_entered: INVALID } }).get('nhs_warning')?.state).toBe('shown');
    expect(resultFor({ registration: { nhs_entered: VALID } }).get('nhs_warning')?.state).toBe('hidden');
  });

  it('gives the same answer when no event is chosen, since the default names its event', () => {
    expect(resultFor({ registration: { nhs_entered: INVALID } }, { event: null }).get('nhs_warning')?.state).toBe('shown');
    expect(resultFor({ registration: { nhs_entered: VALID } }, { event: null }).get('nhs_warning')?.state).toBe('hidden');
  });

  it('is unknown with nothing set, and asks only for the number entered, never for a calculation', () => {
    const info = resultFor({}).get('nhs_warning');
    expect(info?.state).toBe('unknown');
    expect(info?.missing).toEqual([{ variable: 'nhs_entered', event: 'registration' }]);
  });

  it('stays hidden while the number is blank, since there is nothing to check', () => {
    expect(resultFor({ registration: { nhs_entered: '' } }).get('nhs_warning')?.state).toBe('hidden');
  });

  it('lets a value that was set win over the calculation, and over the default', () => {
    // the calculation says valid; the value set says it is not
    expect(resultFor({ registration: { nhs_entered: VALID }, consent: { nhs_valid: '0' } }).get('nhs_warning')?.state).toBe('shown');
    // the default would copy the number; a blank set by hand wins, so there is nothing to warn about
    expect(resultFor({ registration: { nhs_entered: INVALID }, consent: { nhs_copy: '' } }).get('nhs_warning')?.state).toBe('hidden');
  });

  it('leaves everything as it was when derivation is off', () => {
    const info = resultFor({ registration: { nhs_entered: INVALID } }, { derive: false }).get('nhs_warning');
    expect(info?.state).toBe('unknown');
    expect(info?.missing.map((input) => input.variable)).toEqual(['nhs_copy', 'nhs_valid']);
  });
});

describe('derivation edge cases', () => {
  it('cannot decide a calculation that depends on itself, and does not hang', () => {
    const info = resultFor({}, { event: 'registration' }).get('loop_gate');
    expect(info?.state).toBe('unknown');
    // with a value set by hand the loop is broken, and the gate decides
    expect(resultFor({ [ANY_EVENT]: { loop_b: '3' } }, { event: 'registration' }).get('loop_gate')?.state).toBe('shown');
  });

  it('reads the unprefixed inputs of a calculation in its own event, not the one being viewed', () => {
    // doubled is in the "later" event and reads [score]; viewed from "registration" it must still read score in "later"
    const shown = resultFor({ later: { score: '4' } }, { event: 'registration' }).get('reads_doubled');
    expect(shown?.state).toBe('shown');
    expect(resultFor({ later: { score: '5' } }, { event: 'registration' }).get('reads_doubled')?.state).toBe('hidden');
  });

  it('uses a plain default when nothing is set, and a set value over it', () => {
    expect(resultFor({}, { event: 'registration' }).get('reads_plain_default')?.state).toBe('shown');
    expect(resultFor({ [ANY_EVENT]: { plain_default: '9' } }, { event: 'registration' }).get('reads_plain_default')?.state).toBe('hidden');
  });

  it('does not derive a default that sits inside an @IF, which stays unknown', () => {
    expect(resultFor({ registration: { nhs_entered: '1' } }, { event: 'registration' }).get('reads_conditional_default')?.state).toBe('unknown');
  });
});

describe('the intermediate values of a chain', () => {
  const valuesFor = (entered: string, over: Partial<WhatIfContext> = {}, set: Record<string, Record<string, WhatIfValue>> = {}) => {
    const results = resultFor({ registration: { nhs_entered: entered }, ...set }, over);
    return Object.fromEntries(derivedValues(results));
  };

  it('lists every step, from the piped default to the final check', () => {
    expect(valuesFor(VALID)).toEqual({
      nhs_copy: VALID, nhs_sum: '299', nhs_quotient: '27', nhs_remainder: '2', nhs_check: '9', nhs_last: '9', nhs_valid: '1',
    });
    expect(valuesFor(INVALID)).toMatchObject({ nhs_last: '8', nhs_valid: '0' });
  });

  it('is found by variable for the result it came from, and absent for anything else', () => {
    const results = resultFor({ registration: { nhs_entered: VALID } });
    expect(derivedValue(results, 'nhs_sum')).toBe('299');
    expect(derivedValue(results, 'nhs_entered')).toBeUndefined();
    expect(derivedValue(null, 'nhs_sum')).toBeUndefined();
  });

  it('leaves out a value that was set by hand, since it is not worked out', () => {
    const values = valuesFor(VALID, {}, { consent: { nhs_valid: '0' } });
    expect(values).not.toHaveProperty('nhs_valid');
    expect(values).toHaveProperty('nhs_check', '9');
  });

  it('has nothing for steps that cannot be decided yet, and nothing when derivation is off', () => {
    expect(Object.fromEntries(derivedValues(resultFor({})))).toEqual({});
    expect(Object.fromEntries(derivedValues(resultFor({ registration: { nhs_entered: VALID } }, { derive: false })))).toEqual({});
  });

  it('has nothing for fields not collected in the viewed event', () => {
    // the loop and plain-default fields are in the registration form, not collected at consent
    const values = valuesFor(VALID);
    expect(values).not.toHaveProperty('plain_default');
    expect(Object.fromEntries(derivedValues(resultFor({}, { event: 'registration' })))).toEqual({ plain_default: '7' });
  });
});

describe('controllersOf following calculations', () => {
  const depthsOf = (calculations: boolean) => Object.fromEntries(controllersOf(model, 'nhs_warning', calculations).map((item) => [item.variable, item.depth]));

  it('stops at a calculated controller by default, as it always did', () => {
    expect(depthsOf(false)).toEqual({ nhs_copy: 1, nhs_valid: 1, nhs_entered: 2 });
  });

  it('follows a calculated controller into its inputs, nearest first, when asked', () => {
    expect(depthsOf(true)).toEqual({
      nhs_copy: 1, nhs_valid: 1, nhs_entered: 2, nhs_check: 2, nhs_last: 2, nhs_remainder: 3, nhs_sum: 4, nhs_quotient: 4,
    });
  });

  it('does not follow the explored field\'s own calculation, which says nothing about whether it is shown', () => {
    expect(controllersOf(model, 'nhs_valid', true).map((item) => item.variable)).not.toContain('nhs_check');
  });
});

describe('topLevelDefault', () => {
  it('finds quoted and bare defaults', () => {
    expect(topLevelDefault("@DEFAULT='abc'")).toBe('abc');
    expect(topLevelDefault('@DEFAULT="a b"')).toBe('a b');
    expect(topLevelDefault('@DEFAULT=5 @HIDDEN')).toBe('5');
    expect(topLevelDefault("@HIDDEN @default=''")).toBe('');
  });

  it('ignores a default inside @IF and one that is part of a longer tag name', () => {
    expect(topLevelDefault("@IF([a]=1, @DEFAULT='x', @DEFAULT='y')")).toBeUndefined();
    expect(topLevelDefault("@DEFAULT_OTHER='x'")).toBeUndefined();
    expect(topLevelDefault("@IF([a]=1, @HIDDEN) @DEFAULT='z'")).toBe('z');
    expect(topLevelDefault('')).toBeUndefined();
  });
});

describe('pipedTextExpression', () => {
  it('turns piped text into an expression that builds it', () => {
    expect(pipedTextExpression('ID-[event][field]!')).toBe('concat("ID-", [event][field], "!")');
    expect(pipedTextExpression('[a][b]')).toBe('concat([a][b])');
    expect(pipedTextExpression('plain')).toBe('concat("plain")');
    expect(pipedTextExpression('')).toBe('concat()');
  });

  it('quotes backslashes and double quotes in the literal parts', () => {
    expect(pipedTextExpression('say "hi" \\ [x]')).toBe('concat("say \\"hi\\" \\\\ ", [x])');
  });
});
