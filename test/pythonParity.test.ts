/// <reference types="node" />
/**
 * Parity vectors for the Python evaluation core (python/redcap_display).
 *
 * The TypeScript engine is the reference. This spec runs it over a fixed set of conditions and what-if contexts and
 * compares the result with python/tests/vectors.json, which the Python tests replay against the Python port.
 * Run `EXPORT_PYTHON_VECTORS=1 npm test -- pythonParity` to regenerate the file after changing the TypeScript engine.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel } from '../src/lib/graph';
import { evaluateLogic, parseLogic } from '../src/lib/logic';
import type { LogicFieldRef } from '../src/lib/logic';
import { parseODM } from '../src/lib/parser';
import { pythonMetadata } from '../src/lib/pythonEngine';
import type { Field, ParsedODM } from '../src/lib/types';
import { ANY_EVENT, derivedValues, evaluateVisibility } from '../src/lib/whatIf';
import type { WhatIfValue } from '../src/lib/whatIf';

// vitest runs from the repository root
const VECTOR_FILE = join(process.cwd(), 'python', 'tests', 'vectors.json');

// ---------- deterministic randomness ----------

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- condition vectors ----------

type Table = Record<string, string>;

/** `[event:]name[(code)]`: how a reference is looked up in a table. */
const referenceKey = (ref: LogicFieldRef): string => (ref.event ? ref.event + ':' : '') + ref.name + (ref.code ? '(' + ref.code + ')' : '');

const EXPRESSIONS: string[] = [
  // comparison and truthiness
  '[a] = 5', '[a] = "5"', '[a] <> 5', '[a] != 5', '[a] == 5', '[a] > 3', '[a] >= 5', '[a] < 10', '[a] <= 4', '[b] > [a]', '[s] = "Hello World"',
  '[s] > "Apple"', '[s] < "Zebra"', '[blank] > 3', '[blank] < 3', '[blank] = ""', '[blank] <> ""', '[x] = 2.5', '[x] = 2.50', '[a] = 5.0',
  '[a]', '[blank]', '[s]', '[a] and [b]', '[a] or [blank]', 'not [a]', '![blank]', '[a] && [b]', '[a] || [blank]', '[blank] or [missing]', '[blank] and [missing]',
  '[a] = 5 and [missing] = 1', '[a] = 5 or [missing] = 1', '[a] = 1 and [missing] = 1', '[a] = 1 or [missing] = 1', 'true', 'false', 'TRUE and [a]', 'not false',
  // arithmetic and number formatting
  '[a] + [b] = 8', '[a] - [b] = 2', '[a] * [b] = 15', '[a] / [b] > 1.6', '[a] ^ 2 = 25', '2 ^ 3 ^ 2 = 64', '-[a] = -5', '+[a] = 5', '- - [a] = 5', '[a] + [s] = ""',
  '[a] / 0 = ""', '0 / 0 = ""', '2 ^ 1024 = ""', '(-8) ^ 0.5 = ""', '0 ^ -1 = ""', '[a] * 1e308 * 10 = ""', '[a] + 0.1 + 0.2 = 5.3', '0.1 + 0.2 = 0.3',
  'concat(0.1 + 0.2)', 'concat(1/3)', 'concat(2 ^ 0.5)', 'concat(-0)', 'concat(100000000000000000000 + 1)', 'concat(1e21 * 10)', 'concat(1/1000000)', 'concat(1/10000000)',
  'concat(123456789.123456789)', 'concat(0.000001234)', 'concat(1e300 * 10)', 'concat([a] / [b])', 'concat([a] * 1.1)', 'concat(5 / 2)', 'concat(1e21)', 'concat(1e-7 * 3)',
  'concat(-1e21 * 5)', 'concat(255 / 100)', 'concat(true, false)', 'concat([a], "-", [b])', 'concat()',
  // rounding
  'round(2.5)', 'round(-2.5)', 'round(0.5)', 'round(-0.5)', 'round(1.005, 2)', 'round(2.675, 2)', 'round([x], 0)', 'round([x])', 'round(1234.5678, -2)', 'round(1.45, 1)', 'round([blank])', 'round(abc)',
  'roundup(2.1)', 'roundup(-2.1)', 'roundup(2.123, 2)', 'roundup(1.0000000000000002)', 'rounddown(2.9)', 'rounddown(-2.9)', 'rounddown(2.987, 2)', 'round(0.49999999999999994)',
  'round(1.5)', 'round(1.4999999999999999)', 'round(123.456, 1.9)', 'round(5e-324)', 'round(1e308, -400)', 'round(1e15 + 0.5)',
  'abs(-3.5)', 'abs([a])', 'abs(-0)', 'sqrt(16)', 'sqrt(2)', 'sqrt(-1)', 'sqrt([blank])',
  'sum([a], [b], [x])', 'sum([a], [s], [blank])', 'sum(0.1, 0.2, 0.3)', 'sum(0.1, 0.7, 0.2, 0.9, 0.3)', 'sum()', 'min([a], [b], [x])', 'max([a], [b], [x])', 'min([s])', 'max([blank], [blank])',
  'mean([a], [b])', 'mean([a], [b], [x])', 'mean([s])', 'mean(0.1, 0.2)',
  // text functions
  'contains([s], "World")', 'contains([s], "world")', 'contains([s], "")', 'not_contain([s], "xyz")', 'starts_with([s], "Hello")', 'ends_with([s], "World")', 'starts_with([s], "")',
  'length([s])', 'length([blank])', 'length("héllo")', 'length("😀")', 'left([s], 5)', 'left([s], 2.9)', 'left([s], -1)', 'left([s], 100)', 'right([s], 5)', 'right([s], 2.9)', 'right([s], 0)', 'right([s], 100)', 'right([s], 0.5)',
  'mid([s], 2, 3)', 'mid([s], 1, 5)', 'mid([s], 0, 3)', 'mid([s], 3)', 'mid([s], 2.9, 2.9)', 'mid([s], -2, 5)', 'lower([s])', 'upper([s])', 'trim([sp])', 'trim([sp]) = "padded"', 'upper(trim([sp]))',
  'isnumber([a])', 'isnumber([s])', 'isnumber([x])', 'isnumber([sp])', 'isnumber("1e5")', 'isnumber("1,5")', 'isnumber(".5")', 'isnumber("5.")', 'isnumber("")', 'isnumber("NaN")', 'isnumber("Infinity")', 'isnumber("1_000")', 'isnumber("0x10")',
  'isinteger([a])', 'isinteger([x])', 'isinteger("-12")', 'isinteger("+3")', 'isinteger(" 7 ")', 'isinteger("")', 'isblankormissingcode([blank])', 'isblankormissingcode([a])', 'isblankormissingcode([sp])',
  // dates
  'datediff([d1], [d2], "d")', 'datediff([d1], [d2], "y")', 'datediff([d1], [d2], "M")', 'datediff([d1], [d2], "h")', 'datediff([d1], [d2], "m")', 'datediff([d1], [d2], "s")', 'datediff([d2], [d1], "d")',
  'datediff([d2], [d1], "d", true)', 'datediff([d2], [d1], "d", "false")', 'datediff([d2], [d1], "d", 1)', 'datediff("15/01/2020", "20/03/2021", "d", "dmy")', 'datediff("01/15/2020", "03/20/2021", "d", "mdy")',
  'datediff("2020-02-31", "2020-03-01", "d")', 'datediff("2020-02-30", "2020-03-01", "d")', 'datediff("2021-02-29", "2021-03-01", "d")', 'datediff("99-01-01", "2000-01-01", "y")', 'datediff("50-06-15", "2020-06-15", "y")',
  'datediff("2020-13-01", "2020-03-01", "d")', 'datediff("2020-01-32", "2020-03-01", "d")', 'datediff("2020-01-01 25:61:61", "2020-01-02", "h")', 'datediff("2020-01-01 10:30", "2020-01-01 12:45:30", "m")',
  'datediff("2020-01-01", "2020-01-02", "x")', 'datediff("2020-01-01", "2020-01-02")', 'datediff("nope", "2020-01-02", "d")', 'datediff([blank], [d1], "d")', 'datediff("2020-01-01", "2024-01-01", "y") = 4',
  'datediff([d1], "today", "d")', 'datediff("today", [d1], "y")', 'datediff("2020-01-01", "today", "M")', 'datediff("TODAY", " 2000-01-01 ", "d")', 'datediff("today", "today", "d") = 0',
  'datediff([d1], "today", "y", true)', 'datediff("today", "2021-06-15", "d")', 'datediff("today", "today", "d", "dmy")', 'datediff("today", "2024-03-01", "d", true)', 'datediff([d2], "today", "h")',
  'datediff("0001-01-01", "0001-01-02", "d")', 'datediff("1900-01-01", "2100-12-31", "d")', 'datediff("2020-01-01", "2020-12-31", "M", "ymd")', 'datediff("2020/01/01", "2020/12/31", "d")',
  // if
  'if([a] > 3, 1, 0) = 1', 'if([a] > 30, 1, 0) = 1', 'if([missing] > 3, 1, 1) = 1', 'if([missing] > 3, 1, 2) = 1', 'if([missing] > 3, true, true)', 'if([missing] > 3, "1", 1)', 'if([missing], [a], [a])', 'if(1, 2)', 'if()',
  'if([a] > 3, [missing], 1)', 'if([a] > 30, [missing], 1)', 'if([a] > 3, "yes", "no") = "yes"', 'if([missing] > 3, [x], [x])',
  // smart variables and events
  '[event-name] = "baseline_arm_1"', '[event-name] <> "baseline_arm_1"', '[user-role-label] = "Nurse"', '[baseline_arm_1][a] = 5', '[12_months_arm_1][a] = 5', '[baseline_arm_1][cb(2)] = 1', '[baseline_arm_1][a] > [followup_arm_1][a]',
  '[cb(1)] = 1', '[cb(2)] = 1', '[cb(1)] = 1 and [cb(3)] = 0', '[cb(unknown)] = 1', '[cb] = 1', '[a:value] = 5', '[cb(1):checked] = 1', '[ spaced ] = 1', '[ a ] = 5',
  // syntax and unsupported
  '', '   ', '[a] =', '= 5', '[a] = = 5', '[a', 'a]', '[a](', '([a] = 5', '[a] = 5)', '[a] = "unclosed', "[a] = 'x", '[a] = "a\\"b"', '[a] = \'it\\\'s\'', 'foo([a])', 'foo()', 'FOO([a]) = 1', 'datediff', 'sum(', 'sum(1,', 'sum(1 2)', 'round(1;2)',
  '[a] = 5 #', '@HIDDEN', '[a] ~ 5', '1 2', '[a] [b]', '"a" "b"', 'not', 'and', '[a] and', 'if([a],1,0', 'unknownfn([missing])', 'unknownfn([a]) = 1 and [missing] = 1', 'unknownfn([a]) = 1 or [missing] = 1',
  '1.', '.5 + .5 = 1', '1e3 = 1000', '1E3 = 1000', '1e+3 = 1000', '1.5e = 1', '00012 = 12', '1.2.3', '0x10 = 16', '[a] = 05', '5 = "5.0"', '"abc" = "ABC"', '[a] = " 5 "', '" 5 " = 5',
  '[a]=5and[b]=3', '[a]=5 AND [b]=3', '[a]=5 Or [b]=9', '[a]=5 NOT [b]', 'NOT([a]=5)', '(((([a]))))', '()', '(1,2)',
  '[a]=5\n and\n [b]=3', '\t[a]\t=\t5\t', '[a]=5 and [b]=3', '[a]=﻿5',
  // events whose names start with a digit and prefix handling
  '[12_months_arm_1][a] = 5', '[ 12_months_arm_1 ][a] = 5', '[12_months_arm_1][cb(1)] = 1', '[baseline_arm_1][12_months_arm_1][a]', '[12_months_arm_1][12_months_arm_1][a]',
];

const TABLES: Table[] = [
  {},
  {
    a: '5', b: '3', x: '2.5', s: 'Hello World', blank: '', sp: '  padded  ', d1: '2020-01-15', d2: '2021-03-20 12:30', 'cb(1)': '1', 'cb(2)': '0', 'cb(3)': '0',
    'baseline_arm_1:a': '5', 'baseline_arm_1:cb(2)': '1', 'followup_arm_1:a': '2', '12_months_arm_1:a': '5', '12_months_arm_1:cb(1)': '1', 'baseline_arm_1:12_months_arm_1': '1',
  },
  {
    a: ' 7 ', b: 'abc', x: '', s: 'foo', blank: ' ', sp: '', d1: '15/01/2020', d2: 'today-ish', 'cb(1)': '0', 'cb(2)': '1', 'baseline_arm_1:a': '9', 'followup_arm_1:a': '1',
  },
  { a: '0', b: '0.0', x: '1e3', s: '5', blank: '0', d1: '2020-01-31', d2: '2020-03-01', 'cb(1)': '1', 'cb(2)': '1', 'cb(3)': '1' },
];

const SMART_TABLES: Table[] = [{}, { 'event-name': 'baseline_arm_1', 'user-role-label': 'Nurse' }];

/** The dates `"today"` is pinned to; a leap day and a century-end are in there on purpose. */
const TODAYS = ['2021-06-15', '2024-02-29', '1999-12-31'];

interface ConditionVector {
  expression: string;
  fields: Table;
  smart: Table;
  today: string;
  value: string | number | boolean | null;
  missing: string[];
  unsupported: string[];
}

function conditionVectors(): ConditionVector[] {
  const vectors: ConditionVector[] = [];
  EXPRESSIONS.forEach((expression, expressionIndex) => {
    TABLES.forEach((fields, tableIndex) => {
      const smart = SMART_TABLES[(expressionIndex + tableIndex) % SMART_TABLES.length]!;
      const today = TODAYS[(expressionIndex + tableIndex) % TODAYS.length]!;
      const result = evaluateLogic(parseLogic(expression), {
        field: (ref) => fields[referenceKey(ref)],
        smart: (name) => smart[name],
        today: () => today,
      });
      // NaN and infinities cannot be written in JSON; the evaluator never returns them from arithmetic, but a function might
      const value = result.value === undefined ? null : typeof result.value === 'number' && !Number.isFinite(result.value) ? String(result.value) : result.value;
      vectors.push({ expression, fields, smart, today, value, missing: result.missing, unsupported: result.unsupported });
    });
  });
  return vectors;
}

// ---------- visibility vectors ----------

const field = (variable: string, form: string, over: Partial<Field> = {}): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form, ...over,
});

const choices = (...codes: string[]): Field['choices'] => codes.map((code) => ({ code, label: 'choice ' + code }));
const calculated = (variable: string, form: string, calc: string): Field => field(variable, form, { type: 'calc', calc, annotation: '@HIDDEN' });

/** A hand-written project that exercises what the sample does not: events, @IF, display rules per event, cycles, smart variables. */
function stressProject(): ParsedODM {
  const fields: Field[] = [
    field('record_id', 'f1'),
    field('age', 'f1'),
    field('sex', 'f1', { type: 'radio', choices: choices('1', '2') }),
    field('symptoms', 'f1', { type: 'checkbox', choices: choices('1', '2', '99') }),
    field('pregnant', 'f1', { branching: '[sex] = "2" and [age] >= 12 and [age] <= 55' }),
    field('adult_only', 'f1', { branching: '[age] >= 18' }),
    field('adult_followup', 'f1', { branching: '[adult_only] = "1"' }),
    field('symptom_other', 'f1', { branching: '[symptoms(99)] = "1"' }),
    field('any_symptom', 'f1', { branching: '[symptoms(1)] = "1" or [symptoms(2)] = "1"' }),
    field('weight', 'f2', { branching: '[baseline_arm_1][age] >= 18' }),
    field('height', 'f2', { annotation: '@HIDDEN' }),
    field('bmi', 'f2', { type: 'calc', branching: 'if([height] > 0, 1, 0) = 1' }),
    field('survey_only_hidden', 'f2', { annotation: '@HIDDEN-SURVEY' }),
    field('form_only_hidden', 'f2', { annotation: '@HIDDEN-FORM @DEFAULT="1"' }),
    field('conditional_hidden', 'f2', { annotation: '@IF([sex] = "1", @HIDDEN, @DEFAULT="x")' }),
    field('one_armed_if', 'f2', { annotation: '@IF([age] > 40, @HIDDEN)' }),
    field('nested_if', 'f2', { annotation: '@IF([sex] = "1", @IF([age] > 50, @HIDDEN-SURVEY, @HIDDEN-FORM), @HIDDEN)' }),
    field('spaced_if', 'f2', { annotation: '@IF ( [age] > 40 , @HIDDEN-SURVEY , @HIDDEN-FORM ) @CHARLIMIT=10' }),
    field('if_with_quotes', 'f2', { annotation: '@IF([note] = "a,b)(", @HIDDEN, @DEFAULT=\'x,y\')' }),
    field('note', 'f2'),
    field('cycle_a', 'f2', { branching: '[cycle_b] = "1"' }),
    field('cycle_b', 'f2', { branching: '[cycle_a] = "1"' }),
    field('self_ref', 'f2', { branching: '[self_ref] = "1"' }),
    field('smart_event', 'f3', { branching: '[event-name] = "followup_arm_1"' }),
    field('smart_user', 'f3', { branching: '[user-role-label] = "Nurse"' }),
    field('smart_arm', 'f3', { branching: '[arm-number] = "1" and [event-label] <> "Baseline"' }),
    field('followup_score', 'f3', { branching: '[followup_arm_1][weight] > 70' }),
    field('twelve_month_note', 'f3', { branching: '[12_months_arm_1][age] > 30' }),
    field('math_gate', 'f3', { branching: 'sum([age], [weight]) > 100 and round([weight] / 3, 1) < 40' }),
    field('text_gate', 'f3', { branching: 'contains([note], "foo") or starts_with([note], "bar")' }),
    field('date_gate', 'f3', { branching: 'datediff([visit1], [visit2], "d") > 30' }),
    field('visit1', 'f3'),
    field('visit2', 'f3'),
    field('dob', 'f3'),
    field('adult_by_dob', 'f3', { branching: 'datediff([dob], "today", "y") >= 18' }),
    field('recent_visit', 'f3', { annotation: '@IF(datediff([visit1], "today", "d") < 30, @HIDDEN-SURVEY, @DEFAULT="x")' }),
    field('blank_gate', 'f3', { branching: '[weight] = ""' }),
    field('after_hidden', 'f3', { branching: '[pregnant] = ""' }),
    field('after_hidden_cb', 'f3', { branching: '[symptoms(99)] = "0"' }),
    // derivation: a default piped across events feeding a chain of calculations (the public modulus-11 check digit)
    field('id_entered', 'f1'),
    field('id_copy', 'f3', { annotation: "@CHARLIMIT=10 @DEFAULT='[baseline_arm_1][id_entered]'" }),
    calculated('id_sum', 'f3', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((position) => `(mid([id_copy],${position},1)*${11 - position})`).join(' + ')),
    calculated('id_quotient', 'f3', 'rounddown(([id_sum] / 11),0)'),
    calculated('id_remainder', 'f3', '[id_sum] - ([id_quotient] * 11)'),
    calculated('id_check', 'f3', '11 - [id_remainder]'),
    calculated('id_last', 'f3', 'mid([id_copy],10,1)'),
    calculated('id_valid', 'f3', 'if(([id_check] <> 11 and [id_check] <> [id_last]) or ([id_check] = 11 and [id_last] <> 0), 0, 1)'),
    field('id_warning', 'f3', { branching: "[id_copy] <> '' and [id_valid] = 0" }),
    calculated('loop_a', 'f2', '[loop_b] + 1'),
    calculated('loop_b', 'f2', '[loop_a] + 1'),
    field('loop_gate', 'f2', { branching: '[loop_a] > 0' }),
    field('score2', 'f3'),
    calculated('doubled', 'f3', '[score2] * 2'),
    field('reads_doubled', 'f1', { branching: '[followup_arm_1][doubled] = 8' }),
    field('plain_default', 'f1', { annotation: "@DEFAULT='7'" }),
    field('reads_plain_default', 'f1', { branching: '[plain_default] = 7' }),
    field('conditional_default', 'f1', { annotation: "@IF([age] > 40, @DEFAULT='7', @DEFAULT='8')" }),
    field('reads_conditional_default', 'f1', { branching: '[conditional_default] = 7' }),
    calculated('age_calc', 'f3', 'datediff([dob], "today", "y")'),
    field('adult_by_calc', 'f3', { branching: '[age_calc] >= 18' }),
    field('orphan', 'f4'),
    field('in_hidden_form', 'f4', { branching: '[age] > 0' }),
    field('unparseable', 'f3', { branching: '[age] >' }),
    field('unsupported_fn', 'f3', { branching: 'frobnicate([age]) = 1' }),
  ];
  const forms = ['f1', 'f2', 'f3', 'f4'].map((id) => ({ id, label: id, repeating: false, fields: fields.filter((item) => item.form === id).map((item) => item.variable) }));
  const events = [
    { id: 'baseline_arm_1', label: 'Baseline', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1', 'f2'] },
    { id: 'followup_arm_1', label: 'Follow-up', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f2', 'f3'] },
    { id: '12_months_arm_1', label: '12 months', arm: '1', armName: 'Arm 1', repeating: false, forms: ['f1', 'f3', 'f4'] },
  ];
  return {
    projectName: 'stress', redcapVersion: '0', forms, fields, events, arms: [], repeatingInstruments: [], logicSources: [],
    formLogic: [
      { logic: '[age] >= 18', forms: ['f2'] },
      { logic: '[sex] = "2"', forms: ['f3'], formEvents: [{ event: 'followup_arm_1', form: 'f3' }] },
      { logic: '[age] > 60', forms: ['f3'], formEvents: [{ event: '12_months_arm_1', form: 'f3' }] },
      { logic: '[sex] = "1"', forms: ['f4'] },
      { logic: '[age] > 99', forms: ['f4', 'f2'], formEvents: [{ event: '12_months_arm_1', form: 'f4' }] },
    ],
  };
}

const VALUE_POOL = ['', '0', '1', '2', '3', '5', '12', '17', '18', '19', '25', '40', '51', '65', '70', '2.5', 'abc', 'foo bar', 'bar', 'a,b)(', '2020-01-15', '2021-03-20', '2020-01-01'];
/** Values that make a chain interesting: numbers that pass and fail a check, a short one, a blank. */
const SPECIAL_VALUES: Record<string, string[]> = {
  id_entered: ['9434765919', '9434765918', '943476591', '', '12345678901'],
  score2: ['4', '5', '', 'abc'],
  dob: ['2000-01-15', '2010-06-30', '15/01/2000', ''],
};
const SMART_POOL: [string, string[]][] = [['[user-role-label]', ['Nurse', 'Admin']], ['[arm-number]', ['1', '2']]];

function randomValues(model: ReturnType<typeof buildModel>, random: () => number): Record<string, WhatIfValue> {
  const values: Record<string, WhatIfValue> = {};
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  model.byVar.forEach((item, variable) => {
    if (item.synthetic || random() < 0.3) return;
    if (item.type === 'checkbox') {
      const checked = item.choices.map((choice) => choice.code).filter(() => random() < 0.4);
      values[variable] = random() < 0.2 ? checked.join(',') : checked;
    } else if (item.choices.length && random() < 0.85) {
      values[variable] = pick(item.choices).code;
    } else if (SPECIAL_VALUES[variable] && random() < 0.8) {
      values[variable] = pick(SPECIAL_VALUES[variable]);
    } else {
      values[variable] = pick(VALUE_POOL);
    }
  });
  SMART_POOL.forEach(([key, options]) => { if (random() < 0.5) values[key] = pick(options); });
  return values;
}

interface VisibilityVector {
  project: string;
  context: { values: Record<string, Record<string, WhatIfValue>>; mode: 'survey' | 'form'; event: string | null; today: string; derive: boolean };
  expected: Record<string, unknown>;
  /** The values worked out for calculated and defaulted fields. */
  derived: Record<string, string>;
}

function visibilityVectors(name: string, parsed: ParsedODM, count: number, seed: number): VisibilityVector[] {
  const model = buildModel(parsed);
  const random = randomGenerator(seed);
  const eventIds: (string | null)[] = [null, ...parsed.events.map((event) => event.id)];
  const vectors: VisibilityVector[] = [];
  for (let index = 0; index < count; index++) {
    const values: Record<string, Record<string, WhatIfValue>> = { [ANY_EVENT]: index === 0 ? {} : randomValues(model, random) };
    parsed.events.forEach((event) => { if (index > 0 && random() < 0.5) values[event.id] = randomValues(model, random); });
    const event = eventIds[Math.floor(random() * eventIds.length)]!;
    const mode = random() < 0.5 ? 'survey' : 'form';
    const today = TODAYS[Math.floor(random() * TODAYS.length)]!;
    const derive = random() < 0.6;
    const result = evaluateVisibility(model, { values, mode, event, today, derive });
    const expected: Record<string, unknown> = {};
    result.forEach((info, key) => { expected[key] = info; });
    vectors.push({ project: name, context: { values, mode, event, today, derive }, expected, derived: Object.fromEntries(derivedValues(result)) });
  }
  return vectors;
}

function generate(): string {
  const sample = parseODM(sampleXml);
  const stress = stressProject();
  const payload = {
    note: 'Generated by test/pythonParity.test.ts from the TypeScript engine. Do not edit by hand.',
    projects: { sample: pythonMetadata(sample), stress: pythonMetadata(stress) },
    conditions: conditionVectors(),
    visibility: [...visibilityVectors('sample', sample, 60, 11), ...visibilityVectors('stress', stress, 140, 29)],
  };
  return JSON.stringify(payload) + '\n'; // compact: the file is for machines, and indented it is several times larger
}

describe('Python parity vectors', () => {
  it('match the committed vectors the Python tests replay', () => {
    const generated = generate();
    if (process.env.EXPORT_PYTHON_VECTORS) {
      writeFileSync(VECTOR_FILE, generated);
      return;
    }
    // fails when the TypeScript engine changed without regenerating the vectors
    expect(generated === readFileSync(VECTOR_FILE, 'utf8')).toBe(true);
  });

  it('cover hidden, shown and unknown outcomes', () => {
    const payload = JSON.parse(generate()) as { visibility: VisibilityVector[]; conditions: ConditionVector[] };
    const states = new Set<string>();
    payload.visibility.forEach((vector) => Object.values(vector.expected).forEach((info) => states.add((info as { state: string }).state)));
    expect([...states].sort()).toEqual(['hidden', 'shown', 'unknown']);
    expect(payload.conditions.some((vector) => vector.unsupported.length > 0)).toBe(true);
  });
});
