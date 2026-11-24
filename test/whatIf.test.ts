import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/lib/graph';
import type { Field, Form, FormLogicRule, ParsedODM } from '../src/lib/types';
import { ANY_EVENT, dependentsOf, evaluateVisibility, eventForField, eventsForField, eventsToEvaluate, parseActionTags, splitTopLevel } from '../src/lib/whatIf';
import type { WhatIfContext, WhatIfValue } from '../src/lib/whatIf';

const field = (variable: string, form: string, over: Partial<Field> = {}): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form, ...over,
});

const form = (id: string, fields: string[]): Form => ({ id, label: id, repeating: false, fields });

const parsedWith = (fields: Field[], formLogic: FormLogicRule[] = [], formIds: string[] = ['f1']): ParsedODM => ({
  projectName: 'test',
  redcapVersion: '0',
  forms: formIds.map((id) => form(id, fields.filter((item) => item.form === id).map((item) => item.variable))),
  fields,
  formLogic,
  logicSources: [],
  events: [],
  arms: [],
  repeatingInstruments: [],
});

const context = (values: Record<string, WhatIfValue> = {}, over: Partial<WhatIfContext> = {}): WhatIfContext => ({
  values: { [ANY_EVENT]: values }, mode: 'form', event: null, ...over,
});

const stateOf = (fields: Field[], values: Record<string, WhatIfValue>, over: Partial<WhatIfContext> = {}, formLogic: FormLogicRule[] = [], formIds?: string[]) =>
  evaluateVisibility(buildModel(parsedWith(fields, formLogic, formIds)), context(values, over));

describe('branching logic', () => {
  const fields = [field('a', 'f1'), field('b', 'f1', { branching: '[a] = 1' })];

  it('shows when true, hides when false', () => {
    expect(stateOf(fields, { a: '1' }).get('b')?.state).toBe('shown');
    const hidden = stateOf(fields, { a: '2' }).get('b');
    expect(hidden?.state).toBe('hidden');
    expect(hidden?.reasons).toContain('branching logic false');
  });

  it('is unknown with the missing field when the input is not set', () => {
    const info = stateOf(fields, {}).get('b');
    expect(info?.state).toBe('unknown');
    expect(info?.missing).toEqual([{ variable: 'a', event: null }]);
  });

  it('keys cover every field and a field without logic is shown', () => {
    const result = stateOf(fields, {});
    expect(result.get('a')?.state).toBe('shown');
    expect(result.has('f1_complete')).toBe(true);
  });

  it('reads checkbox option references', () => {
    const boxes = [
      field('c', 'f1', { type: 'checkbox', choices: [{ code: '1', label: 'one' }, { code: '2', label: 'two' }] }),
      field('d', 'f1', { branching: '[c(2)] = 1' }),
    ];
    expect(stateOf(boxes, { c: ['2'] }).get('d')?.state).toBe('shown');
    expect(stateOf(boxes, { c: ['1'] }).get('d')?.state).toBe('hidden');
    expect(stateOf(boxes, { c: [] }).get('d')?.state).toBe('hidden');
    expect(stateOf(boxes, {}).get('d')?.state).toBe('unknown');
  });
});

describe('action tags', () => {
  it('@HIDDEN always hides', () => {
    const fields = [field('a', 'f1', { annotation: '@HIDDEN' })];
    expect(stateOf(fields, {}, { mode: 'form' }).get('a')?.state).toBe('hidden');
    expect(stateOf(fields, {}, { mode: 'survey' }).get('a')?.reasons).toEqual(['@HIDDEN']);
  });

  it('@HIDDEN-SURVEY and @HIDDEN-FORM depend on the mode; app and pdf variants are ignored', () => {
    const fields = [
      field('s', 'f1', { annotation: '@HIDDEN-SURVEY' }),
      field('m', 'f1', { annotation: '@HIDDEN-FORM' }),
      field('p', 'f1', { annotation: '@HIDDEN-APP @HIDDEN-PDF' }),
    ];
    const survey = stateOf(fields, {}, { mode: 'survey' });
    expect(survey.get('s')?.state).toBe('hidden');
    expect(survey.get('s')?.reasons).toContain('@HIDDEN-SURVEY');
    expect(survey.get('m')?.state).toBe('shown');
    expect(survey.get('p')?.state).toBe('shown');
    const formMode = stateOf(fields, {}, { mode: 'form' });
    expect(formMode.get('s')?.state).toBe('shown');
    expect(formMode.get('m')?.state).toBe('hidden');
  });

  it('@IF picks a branch, with quoted commas and nested calls in the condition', () => {
    const fields = [
      field('a', 'f1'),
      field('b', 'f1', { annotation: "@IF([a] = 'x, y', @HIDDEN, @DEFAULT='1')" }),
      field('c', 'f1', { annotation: "@IF(contains([a], 'p,q') , @DEFAULT='1', @HIDDEN)" }),
    ];
    const first = stateOf(fields, { a: 'x, y' });
    expect(first.get('b')?.state).toBe('hidden');
    expect(first.get('c')?.state).toBe('hidden');
    const second = stateOf(fields, { a: 'p,q' });
    expect(second.get('b')?.state).toBe('shown');
    expect(second.get('c')?.state).toBe('shown');
  });

  it('@IF with an unknown condition is unknown only when a branch would hide', () => {
    const fields = [
      field('a', 'f1'),
      field('b', 'f1', { annotation: '@IF([a] = 1, @HIDDEN, @DEFAULT="1")' }),
      field('c', 'f1', { annotation: '@IF([a] = 1, @DEFAULT="1", @DEFAULT="2")' }),
    ];
    const result = stateOf(fields, {});
    expect(result.get('b')?.state).toBe('unknown');
    expect(result.get('b')?.missing).toEqual([{ variable: 'a', event: null }]);
    expect(result.get('c')?.state).toBe('shown');
  });

  it('parses balanced parentheses and quotes', () => {
    expect(splitTopLevel("a, 'b,c', f(d, e), g")).toEqual(['a', " 'b,c'", ' f(d, e)', ' g']);
    expect(parseActionTags("@HIDDEN-APP @IF([a] = 'x)', @HIDDEN, @READONLY)")).toEqual([
      { kind: 'tag', name: 'HIDDEN-APP' },
      { kind: 'if', condition: "[a] = 'x)'", thenText: '@HIDDEN', elseText: '@READONLY' },
    ]);
  });
});

describe('form display logic', () => {
  const fields = [field('a', 'f1'), field('x', 'f2'), field('y', 'f2')];
  const rules: FormLogicRule[] = [
    { logic: '[a] = 1', forms: ['f2'], formEvents: [{ event: 'e1', form: 'f2' }] },
    { logic: '[a] = 2', forms: ['f2'], formEvents: [{ event: 'e2', form: 'f2' }] },
  ];
  const run = (values: Record<string, WhatIfValue>, event: string | null) => stateOf(fields, values, { event }, rules, ['f1', 'f2']);

  it('enables the form if any rule is true', () => {
    expect(run({ a: '2' }, null).get('form:f2')?.state).toBe('shown');
    expect(run({ a: '1' }, null).get('form:f2')?.state).toBe('shown');
  });

  it('hides when all rules are false, unknown otherwise', () => {
    const hidden = run({ a: '3' }, null).get('form:f2');
    expect(hidden?.state).toBe('hidden');
    expect(hidden?.reasons).toContain('form hidden by form display logic');
    expect(run({}, null).get('form:f2')?.state).toBe('unknown');
  });

  it('filters rules by the chosen event', () => {
    expect(run({ a: '2' }, 'e1').get('form:f2')?.state).toBe('hidden');
    expect(run({ a: '2' }, 'e2').get('form:f2')?.state).toBe('shown');
  });

  it('hides fields on a hidden form, unknown form gives unknown fields, forms without a node are shown', () => {
    const hidden = run({ a: '3' }, null);
    expect(hidden.get('x')?.state).toBe('hidden');
    expect(hidden.get('x')?.reasons).toContain('form hidden by form display logic');
    expect(run({}, null).get('x')?.state).toBe('unknown');
    expect(hidden.get('a')?.state).toBe('shown');
    expect(hidden.has('form:f1')).toBe(false);
  });
});

describe('cascade and cycles', () => {
  it('a hidden field counts as blank for the fields that read it', () => {
    const fields = [
      field('a', 'f1'),
      field('b', 'f1', { branching: '[a] = 1' }),
      field('c', 'f1', { branching: "[b] = ''" }),
    ];
    const result = stateOf(fields, { a: '2', b: 'stale' });
    expect(result.get('b')?.state).toBe('hidden');
    expect(result.get('c')?.state).toBe('shown');
    expect(stateOf(fields, { a: '1', b: 'kept' }).get('c')?.state).toBe('hidden');
  });

  it('a field hidden only by an action tag keeps its value', () => {
    const fields = [
      field('a', 'f1', { annotation: '@HIDDEN @DEFAULT="1"' }),
      field('b', 'f1', { branching: '[a] = 1' }),
    ];
    const result = stateOf(fields, { a: '1' });
    expect(result.get('a')?.state).toBe('hidden');
    expect(result.get('b')?.state).toBe('shown');
  });

  it('a field on a hidden form counts as blank', () => {
    const fields = [field('gate', 'f1'), field('x', 'f2'), field('y', 'f1', { branching: "[x] = ''" })];
    const result = stateOf(fields, { gate: '0', x: 'stale' }, {}, [{ logic: '[gate] = 1', forms: ['f2'] }], ['f1', 'f2']);
    expect(result.get('x')?.state).toBe('hidden');
    expect(result.get('y')?.state).toBe('shown');
  });

  it('a hidden field reports only what hides it, not undecided parts', () => {
    const fields = [field('a', 'f1'), field('b', 'f1'), field('c', 'f1', { branching: '[a] = 1', annotation: '@IF([b] = 1, @HIDDEN, )' })];
    const info = stateOf(fields, { a: '2' }).get('c');
    expect(info?.state).toBe('hidden');
    expect(info?.reasons).toEqual(['branching logic false']);
    expect(info?.missing).toEqual([]);
  });

  it('@IF with an unknown condition is hidden when both branches hide', () => {
    const fields = [field('a', 'f1'), field('b', 'f1', { annotation: '@IF([a] = 1, @HIDDEN, @HIDDEN-FORM)' })];
    expect(stateOf(fields, {}).get('b')?.state).toBe('hidden');
  });

  it('terminates on a branching cycle and leaves it unknown', () => {
    const fields = [
      field('a', 'f1', { branching: '[b] = 1' }),
      field('b', 'f1', { branching: '[a] = 1' }),
    ];
    const result = stateOf(fields, {});
    expect(result.get('a')?.state).toBe('unknown');
    expect(result.get('b')?.state).toBe('unknown');
  });
});

describe('event-name and event-prefixed references', () => {
  const fields = [field('a', 'f1', { branching: "[event-name] = 'baseline'" }), field('b', 'f1')];

  it('is unknown without an event and decided with one', () => {
    expect(stateOf(fields, {}).get('a')?.state).toBe('unknown');
    expect(stateOf(fields, {}, { event: 'baseline' }).get('a')?.state).toBe('shown');
    expect(stateOf(fields, {}, { event: 'followup' }).get('a')?.state).toBe('hidden');
  });

  it('hides, and blanks, fields and form nodes of a form not used in the chosen event', () => {
    const fields = [field('a', 'f1'), field('x', 'f2'), field('y', 'f1', { branching: "[x] = ''" })];
    const parsed = {
      ...parsedWith(fields, [{ logic: '[a] = 1', forms: ['f2'] }], ['f1', 'f2']),
      events: [
        { id: 'base', label: 'Base', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1', 'f2'] },
        { id: 'later', label: 'Later', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1'] },
      ],
    };
    const model = buildModel(parsed);
    const later = evaluateVisibility(model, context({ a: '1', x: 'stale' }, { event: 'later' }));
    expect(later.get('x')).toEqual({ state: 'hidden', reasons: ['form not used in this event'], missing: [] });
    expect(later.get('form:f2')?.state).toBe('hidden');
    expect(later.get('y')?.state).toBe('shown');
    const base = evaluateVisibility(model, context({ a: '1', x: 'stale' }, { event: 'base' }));
    expect(base.get('x')?.state).toBe('shown');
    expect(base.get('y')?.state).toBe('hidden');
  });

});

describe('values by event', () => {
  const fields = [field('x', 'f1'), field('b', 'f1', { branching: '[A][x] = 1' }), field('z', 'f2')];
  const parsed = {
    ...parsedWith(fields, [], ['f1', 'f2']),
    events: [
      { id: 'A', label: 'Event A', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1'] },
      { id: 'B', label: 'Event B', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1', 'f2'] },
    ],
  };
  const model = buildModel(parsed);
  const run = (values: Record<string, Record<string, WhatIfValue>>, event: string | null = 'B', target = model) =>
    evaluateVisibility(target, { values, mode: 'form', event });

  it("reads the prefix event's bucket while the context event differs", () => {
    expect(run({ A: { x: '1' } }).get('b')?.state).toBe('shown');
    expect(run({ A: { x: '2' } }).get('b')?.state).toBe('hidden');
    expect(run({ B: { x: '1' } }).get('b')?.state).toBe('unknown');
  });

  it('falls back to the any-event bucket', () => {
    expect(run({ [ANY_EVENT]: { x: '1' } }).get('b')?.state).toBe('shown');
  });

  it('an event bucket wins over the any-event bucket', () => {
    expect(run({ [ANY_EVENT]: { x: '1' }, A: { x: '2' } }).get('b')?.state).toBe('hidden');
  });

  it('reads blank from an event whose forms do not include the field', () => {
    const other = buildModel({ ...parsed, fields: [field('x', 'f2'), field('c', 'f1', { branching: "[A][x] = ''" }), field('d', 'f1', { branching: '[A][y(1)] = 0' }), field('y', 'f2', { type: 'checkbox', choices: [{ code: '1', label: 'one' }] })],
      forms: [form('f1', ['c', 'd']), form('f2', ['x', 'y'])] });
    const result = run({ A: { x: 'stale', y: ['1'] } }, 'B', other);
    expect(result.get('c')?.state).toBe('shown');
    expect(result.get('d')?.state).toBe('shown');
  });

  it('reports missing inputs with the prefix event, else the context event', () => {
    expect(run({}).get('b')?.missing).toEqual([{ variable: 'x', event: 'A' }]);
    const plain = buildModel({ ...parsed, fields: [field('x', 'f1'), field('b', 'f1', { branching: '[x] = 1 and [A][x] = 1 and [x] = 2' })] });
    expect(run({}, 'B', plain).get('b')?.missing).toEqual([{ variable: 'x', event: 'B' }, { variable: 'x', event: 'A' }]);
    expect(run({}, null, plain).get('b')?.missing).toEqual([{ variable: 'x', event: null }, { variable: 'x', event: 'A' }]);
  });

  it('form display logic reading another event becomes decidable', () => {
    const gated = buildModel({ ...parsed, formLogic: [{ logic: '[A][x] = 1', forms: ['f2'] }] });
    expect(run({}, 'B', gated).get('form:f2')?.state).toBe('unknown');
    expect(run({ A: { x: '1' } }, 'B', gated).get('form:f2')?.state).toBe('shown');
    expect(run({ A: { x: '2' } }, 'B', gated).get('form:f2')?.state).toBe('hidden');
  });
});

describe('eventsToEvaluate', () => {
  // baseline collects f1 (the gate); the delivery visit collects f2, whose field reads the baseline value
  const fields = [field('gate', 'f1'), field('dep', 'f2', { branching: "[baseline][gate] = '2'" })];
  const parsed = {
    ...parsedWith(fields, [{ logic: "[baseline][gate] = '2'", forms: ['f2'] }], ['f1', 'f2']),
    events: [
      { id: 'baseline', label: 'Baseline', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1'] },
      { id: 'delivery', label: 'Delivery', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f2'] },
      { id: 'postnatal', label: 'Postnatal', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f2'] },
    ],
  };
  const model = buildModel(parsed);

  it('judges a dependent in the events its form is used in when that is not the selected event', () => {
    expect(eventsToEvaluate(model, 'dep', 'baseline')).toEqual(['delivery', 'postnatal']);
    expect(eventsToEvaluate(model, 'form:f2', 'baseline')).toEqual(['delivery', 'postnatal']);
    expect(eventsToEvaluate(model, 'dep', 'delivery')).toEqual(['delivery']);
    expect(eventsToEvaluate(model, 'dep', null)).toEqual([null]);
  });

  it('gives the real answer there for a value set in the selected event', () => {
    const values = { baseline: { gate: '2' } };
    const [first] = eventsToEvaluate(model, 'dep', 'baseline');
    expect(evaluateVisibility(model, { values, mode: 'form', event: 'baseline' }).get('dep')?.reasons).toEqual(['form not used in this event']);
    expect(evaluateVisibility(model, { values, mode: 'form', event: first }).get('dep')?.state).toBe('shown');
    expect(evaluateVisibility(model, { values: { baseline: { gate: '1' } }, mode: 'form', event: first }).get('dep')?.state).toBe('hidden');
  });
});

describe('dependentsOf', () => {
  it('lists fields and form nodes depending on a variable through visibility edges only', () => {
    const fields = [
      field('a', 'f1'),
      field('b', 'f1', { branching: '[a] = 1' }),
      field('c', 'f1', { annotation: '@IF([a] = 1, @HIDDEN, @READONLY)' }),
      field('d', 'f1', { calc: '[a] + 1' }),
      field('x', 'f2'),
    ];
    const rules: FormLogicRule[] = [{ logic: '[a] = 1', forms: ['f2'] }];
    const model = buildModel(parsedWith(fields, rules, ['f1', 'f2']));
    expect(dependentsOf(model, 'a')).toEqual(['b', 'c', 'form:f2']);
    expect(dependentsOf(model, 'zzz')).toEqual([]);
  });
});

describe('eventForField', () => {
  const fields = [field('gate', 'f1'), field('dep', 'f2'), field('solo', 'f3')];
  const plain = buildModel(parsedWith(fields, [], ['f1', 'f2', 'f3']));
  const model = buildModel({
    ...parsedWith(fields, [], ['f1', 'f2', 'f3']),
    events: [
      { id: 'baseline', label: 'Baseline', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1'] },
      { id: 'delivery', label: 'Delivery', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f2'] },
      { id: 'postnatal', label: 'Postnatal', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f2', 'f3'] },
    ],
  });

  it('lists the events a field is used in, in project order', () => {
    expect(eventsForField(model, 'dep')).toEqual(['delivery', 'postnatal']);
    expect(eventsForField(model, 'zzz')).toEqual([]);
    expect(eventsForField(plain, 'dep')).toEqual([]);
  });

  it('keeps the current event when valid, else the first event, else null', () => {
    expect(eventForField(model, 'dep', 'postnatal')).toBe('postnatal');
    expect(eventForField(model, 'dep', 'baseline')).toBe('delivery');
    expect(eventForField(model, 'dep', null)).toBe('delivery');
    expect(eventForField(plain, 'dep', 'baseline')).toBeNull();
  });
});
