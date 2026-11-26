import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import { smartKey } from '../src/lib/whatIf';
import type { DepType, Field, FormNode, ModelBase } from '../src/lib/types';
import {
  chooserMatches, computeVisibilityLogic, countByState, derivationOf, displayRows, distinctOf, filterVisibilityRows, nextExploredRow,
  rowKeyOf, setValueText, smartVariableNames,
} from '../src/lib/whatIfRows';
import type { ChooserMatch, TableRow, VisibilityFilterable } from '../src/lib/whatIfRows';

const sample = buildModel(parseODM(sampleXml));

const field = (variable: string, form: string, over: Partial<Field> = {}): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form, ...over,
});

const formNode = (form: string, logic: string[], logicEvents: string[][]): FormNode => ({
  variable: 'form:' + form, type: 'formnode', label: form, form, formNode: true, logic, logicEvents,
});

/** The sample model with its fields, form nodes and smart dependencies replaced, for cases the sample does not cover. */
function modelWith(fields: Field[], nodes: FormNode[] = [], smartDeps: ModelBase['smartDeps'] = new Map()): ModelBase {
  return {
    ...sample,
    parsed: { ...sample.parsed, fields },
    byVar: new Map(fields.map((candidate) => [candidate.variable, candidate])),
    formNodes: new Map(nodes.map((node) => [node.variable, node])),
    smartDeps,
  };
}

describe('computeVisibilityLogic', () => {
  it('gives a field its trimmed branching logic, whatever the event', () => {
    expect(computeVisibilityLogic(sample, 'pregnant', 'baseline_arm_1')).toEqual({ main: ['[sex] = "2" and [age] >= 12 and [age] <= 55'], note: '' });
    expect(computeVisibilityLogic(sample, 'pregnant', null)).toEqual({ main: ['[sex] = "2" and [age] >= 12 and [age] <= 55'], note: '' });
  });

  it('gives an action-tag note only for @HIDDEN or @IF annotations', () => {
    expect(computeVisibilityLogic(sample, 'sc_hidden', null).note).toBe(sample.byVar.get('sc_hidden')!.annotation.trim());
    expect(computeVisibilityLogic(sample, 'sc_sleep', null).note).toBe(sample.byVar.get('sc_sleep')!.annotation.trim());
    expect(computeVisibilityLogic(sample, 'consent', null)).toEqual({ main: ['[age] >= 18'], note: '' });
  });

  it('gives no logic for a whitespace-only branching, and empty results for an unknown id', () => {
    const model = modelWith([field('blank', 'f', { branching: '   ' }), field('plain', 'f', { annotation: '@DEFAULT=\'1\'' })]);
    expect(computeVisibilityLogic(model, 'blank', null)).toEqual({ main: [], note: '' });
    expect(computeVisibilityLogic(model, 'plain', null)).toEqual({ main: [], note: '' });
    expect(computeVisibilityLogic(model, 'nothing-here', null)).toEqual({ main: [], note: '' });
  });

  it('filters a form node rules by the event they are for in the sample', () => {
    expect(computeVisibilityLogic(sample, 'form:baseline', 'baseline_arm_1').main).toEqual(["[demographics_complete] = '2' and [undefined_gate] = '1'"]);
    expect(computeVisibilityLogic(sample, 'form:baseline', 'followup_arm_1').main).toEqual([]);
    expect(computeVisibilityLogic(sample, 'form:baseline', null).main).toEqual(["[demographics_complete] = '2' and [undefined_gate] = '1'"]);
  });

  it('keeps every rule when the event is null, and applies a rule with no events everywhere', () => {
    const model = modelWith([], [formNode('f', ['r0', 'r1', 'r2'], [['e1'], [], ['e2']])]);
    expect(computeVisibilityLogic(model, 'form:f', null).main).toEqual(['r0', 'r1', 'r2']);
    expect(computeVisibilityLogic(model, 'form:f', 'e1').main).toEqual(['r0', 'r1']);
    expect(computeVisibilityLogic(model, 'form:f', 'e2').main).toEqual(['r1', 'r2']);
    expect(computeVisibilityLogic(model, 'form:f', 'e3').main).toEqual(['r1']);
  });

  it('treats rules without a logicEvents entry as applying everywhere', () => {
    const model = modelWith([], [formNode('f', ['r0', 'r1'], [['e1']])]);
    expect(computeVisibilityLogic(model, 'form:f', 'e2').main).toEqual(['r1']);
    expect(computeVisibilityLogic(model, 'form:f', 'e1').main).toEqual(['r0', 'r1']);
  });

  it('gives a form node with no rules nothing to show', () => {
    const model = modelWith([], [formNode('f', [], [])]);
    expect(computeVisibilityLogic(model, 'form:f', 'e1')).toEqual({ main: [], note: '' });
  });
});

describe('derivationOf', () => {
  it('names a calculation, as written and trimmed', () => {
    expect(derivationOf({ calc: '  [a] * 2 ', annotation: '' })).toEqual({ kind: 'calculated', text: '= [a] * 2' });
  });

  it('names a top-level @DEFAULT, and prefers the calculation when there are both', () => {
    expect(derivationOf({ calc: '', annotation: "@HIDDEN @DEFAULT='[ev][x]'" })).toEqual({ kind: 'default', text: 'default [ev][x]' });
    expect(derivationOf({ calc: '[a]', annotation: "@DEFAULT='1'" }).kind).toBe('calculated');
  });

  it('says nothing for a field that has neither, a default inside @IF, or no field at all', () => {
    expect(derivationOf({ calc: '', annotation: '@HIDDEN' })).toEqual({ kind: '', text: '' });
    expect(derivationOf({ calc: ' ', annotation: "@IF([a]=1, @DEFAULT='x', @DEFAULT='y')" })).toEqual({ kind: '', text: '' });
    expect(derivationOf(undefined)).toEqual({ kind: '', text: '' });
  });
});

describe('setValueText', () => {
  it('gives a value as text, joins a checkbox\'s codes, and is undefined when nothing is set', () => {
    expect(setValueText('17')).toBe('17');
    expect(setValueText('')).toBe('');
    expect(setValueText(['1', '3'])).toBe('1, 3');
    expect(setValueText(undefined)).toBeUndefined();
  });
});

describe('rowKeyOf', () => {
  it('joins the variable and event, with a null event as an empty part', () => {
    expect(rowKeyOf({ variable: 'age', event: null })).toBe('age|');
    expect(rowKeyOf({ variable: 'age', event: 'baseline_arm_1' })).toBe('age|baseline_arm_1');
    expect(rowKeyOf({ variable: 'age', event: null })).not.toBe(rowKeyOf({ variable: 'age', event: 'e1' }));
  });
});

describe('displayRows', () => {
  const baseline = 'baseline_arm_1';

  it('lists the added rows in order, then the unlisted values, with the any-event bucket first', () => {
    const listed: TableRow[] = [{ variable: 'b', event: baseline }];
    const values = { '': { a: '1' }, [baseline]: { b: '2', a: '3' } };
    expect(displayRows(listed, values, [baseline])).toEqual([
      { variable: 'b', event: baseline },
      { variable: 'a', event: null },
      { variable: 'a', event: baseline },
    ]);
  });

  it('keeps the listed row objects themselves, and does not drop listed rows that repeat', () => {
    const first: TableRow = { variable: 'a', event: null };
    const listed: TableRow[] = [first, { variable: 'a', event: null }];
    const rows = displayRows(listed, {}, []);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(first);
  });

  it('maps the any-event bucket to a null event and drops values under events the project does not have', () => {
    expect(displayRows([], { '': { q: '1' }, unknown_event: { r: '2' } }, [baseline])).toEqual([{ variable: 'q', event: null }]);
  });

  it('does not list a value twice when a listed row already covers it', () => {
    expect(displayRows([{ variable: 'a', event: null }], { '': { a: '1' } }, [])).toEqual([{ variable: 'a', event: null }]);
  });

  it('gives nothing for empty values', () => {
    expect(displayRows([], {}, [baseline])).toEqual([]);
    expect(displayRows([], { '': {} }, [baseline])).toEqual([]);
  });
});

describe('smartVariableNames', () => {
  it('lists the smart variables the sample logic uses, without the event-derived ones', () => {
    expect(smartVariableNames(sample)).toEqual(['previous-instance', 'current-instance', 'first-instance', 'last-instance']);
  });

  it('drops the derived names, and keeps each name once in first-seen order', () => {
    const smartDeps: ModelBase['smartDeps'] = new Map([
      ['x', [{ type: 'branching' as DepType, smart: ['event-name', 'a', 'arm-label'] }]],
      ['y', [{ type: 'calc' as DepType, smart: ['b', 'a', 'event-label'] }, { type: 'calc' as DepType, smart: ['arm-number', 'b'] }]],
    ]);
    expect(smartVariableNames(modelWith([], [], smartDeps))).toEqual(['a', 'b']);
  });

  it('gives nothing when only derived names are used', () => {
    const smartDeps: ModelBase['smartDeps'] = new Map([['x', [{ type: 'branching' as DepType, smart: ['event-label', 'arm-number', 'arm-label'] }]]]);
    expect(smartVariableNames(modelWith([], [], smartDeps))).toEqual([]);
  });
});

describe('chooserMatches', () => {
  const fields = [
    field('age', 'demographics', { label: 'Age in years' }),
    field('sex', 'demographics', { label: 'Sex' }),
    field('AGEGROUP', 'baseline', { label: 'Group' }),
    field('bmi', 'baseline', { label: 'Body mass age-adjusted' }),
  ];
  const model = modelWith(fields);
  const formLabelOf = (formId: string): string => formId + ' form';
  const smartNames = ['user-role', 'record-dag-name', 'arm-label-copy'];

  it('matches fields by variable or label, case-insensitively, with form labels in the text', () => {
    const matches = chooserMatches(model, 'AGE', [], formLabelOf, 20);
    expect(matches).toEqual([
      { variable: 'age', smart: false, text: 'age — Age in years (demographics form)' },
      { variable: 'AGEGROUP', smart: false, text: 'AGEGROUP — Group (baseline form)' },
      { variable: 'bmi', smart: false, text: 'bmi — Body mass age-adjusted (baseline form)' },
    ]);
  });

  it('trims the query before matching', () => {
    expect(chooserMatches(model, '   sex  ', [], formLabelOf, 20).map((match) => match.variable)).toEqual(['sex']);
  });

  it('gives nothing for an empty or blank query, even with smart variables', () => {
    expect(chooserMatches(model, '', smartNames, formLabelOf, 20)).toEqual([]);
    expect(chooserMatches(model, '   ', smartNames, formLabelOf, 20)).toEqual([]);
  });

  it('limits the fields, but lists every matching smart variable after them', () => {
    const matches = chooserMatches(model, 'age', ['user-age', 'page-age', 'age-x'], formLabelOf, 2);
    expect(matches.map((match) => match.variable)).toEqual(['age', 'AGEGROUP', '[user-age]', '[page-age]', '[age-x]']);
    expect(matches.filter((match) => !match.smart)).toHaveLength(2);
  });

  it('matches smart variables by name, case-insensitively, formatted as smart entries', () => {
    const matches = chooserMatches(model, 'ROLE', smartNames, formLabelOf, 20);
    const expected: ChooserMatch = { variable: smartKey('user-role'), smart: true, text: smartKey('user-role') + ' — smart variable' };
    expect(matches).toEqual([expected]);
  });

  it('gives the form label of each field from the function passed in', () => {
    const calls: string[] = [];
    chooserMatches(model, 'sex', [], (formId) => { calls.push(formId); return 'L'; }, 20);
    expect(calls).toEqual(['demographics']);
  });
});

describe('nextExploredRow', () => {
  const rows: TableRow[] = [
    { variable: 'sex', event: null },
    { variable: '[x]', event: null },
    { variable: 'age', event: 'e1' },
    { variable: 'pregnant', event: null },
  ];
  const isField = (variable: string): boolean => ['sex', 'age', 'pregnant'].includes(variable);

  it('gives the first other row whose variable is a field', () => {
    expect(nextExploredRow(rows, { variable: 'sex', event: null }, isField)).toEqual({ variable: 'age', event: 'e1' });
    expect(nextExploredRow(rows, { variable: 'age', event: 'e1' }, isField)).toEqual({ variable: 'sex', event: null });
  });

  it('judges rows by variable and event, so the same variable in another event is another row', () => {
    const sameVariable: TableRow[] = [{ variable: 'age', event: null }, { variable: 'age', event: 'e1' }];
    expect(nextExploredRow(sameVariable, { variable: 'age', event: null }, isField)).toEqual({ variable: 'age', event: 'e1' });
    expect(nextExploredRow(rows, { variable: 'pregnant', event: null }, isField)).toEqual({ variable: 'sex', event: null });
  });

  it('gives undefined when no other field row remains', () => {
    expect(nextExploredRow([{ variable: 'sex', event: null }, { variable: '[x]', event: null }], { variable: 'sex', event: null }, isField)).toBeUndefined();
  });
});

describe('visibility rows', () => {
  interface Row extends VisibilityFilterable { id: string }
  const rows: Row[] = [
    { id: 'r1', state: 'shown', event: 'e1', formId: 'f1' },
    { id: 'r2', state: 'hidden', event: 'e1', formId: 'f2' },
    { id: 'r3', state: 'unknown', event: 'e2', formId: 'f1' },
    { id: 'r4', state: 'shown', event: null, formId: undefined },
    { id: 'r5', state: 'hidden', event: 'e2', formId: undefined },
    { id: 'r6', state: 'unknown', event: null, formId: 'f2' },
  ];
  const ids = (matched: Row[]): string[] => matched.map((row) => row.id);

  describe('filterVisibilityRows', () => {
    const states = ['all', 'shown', 'hidden', 'unknown'] as const;
    const events = ['', 'e1', 'e2'];
    const forms = ['', 'f1', 'f2'];
    for (const state of states) {
      for (const event of events) {
        for (const form of forms) {
          it(`filters by state ${state}, event '${event}' and form '${form}'`, () => {
            const expected = rows.filter((row) =>
              (state === 'all' || row.state === state) && (event === '' || row.event === event) && (form === '' || row.formId === form));
            expect(ids(filterVisibilityRows(rows, { state, event, form }))).toEqual(ids(expected));
          });
        }
      }
    }

    it('keeps every row in order when no filter is set', () => {
      expect(ids(filterVisibilityRows(rows, { state: 'all', event: '', form: '' }))).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    });

    it('never matches a row with no event to an event filter, or a row with no form to a form filter', () => {
      expect(ids(filterVisibilityRows(rows, { state: 'all', event: 'e1', form: '' }))).not.toContain('r4');
      expect(ids(filterVisibilityRows(rows, { state: 'all', event: 'e1', form: '' }))).not.toContain('r6');
      expect(ids(filterVisibilityRows(rows, { state: 'all', event: '', form: 'f1' }))).not.toContain('r4');
      expect(ids(filterVisibilityRows(rows, { state: 'all', event: '', form: 'f1' }))).not.toContain('r5');
    });

    it('returns a new array and leaves the rows as they were', () => {
      const copy = [...rows];
      const result = filterVisibilityRows(rows, { state: 'all', event: '', form: '' });
      expect(result).not.toBe(rows);
      expect(rows).toEqual(copy);
    });
  });

  describe('countByState', () => {
    it('counts the rows in each state', () => {
      expect(countByState(rows, 'shown')).toBe(2);
      expect(countByState(rows, 'hidden')).toBe(2);
      expect(countByState(rows, 'unknown')).toBe(2);
    });

    it('gives zero for no rows', () => {
      expect(countByState([], 'shown')).toBe(0);
    });
  });
});

describe('distinctOf', () => {
  it('keeps first-seen order and drops duplicates', () => {
    expect(distinctOf<string>(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('drops undefined and null values', () => {
    expect(distinctOf<string>(['b', undefined, null, 'a', undefined, 'b'])).toEqual(['b', 'a']);
  });

  it('gives nothing for no values, or only missing ones', () => {
    expect(distinctOf<string>([])).toEqual([]);
    expect(distinctOf<string>([null, undefined])).toEqual([]);
  });
});
