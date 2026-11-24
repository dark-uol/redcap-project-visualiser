import { describe, expect, it } from 'vitest';
import { evaluateCondition, evaluateLogic, parseLogic, type LogicFieldRef, type LogicLookup, type LogicValue } from '../src/lib/logic';

/** Lookup over plain values. Keys: `name`, `name(code)`, or `event.name`; smart variables under `smart:name`. */
function lookupOf(values: Record<string, string | undefined>): LogicLookup {
  return {
    field(ref: LogicFieldRef) {
      const base = ref.code ? `${ref.name}(${ref.code})` : ref.name;
      return ref.event ? values[`${ref.event}.${base}`] : values[base];
    },
    smart(name: string) {
      return values[`smart:${name}`];
    },
  };
}

function valueOf(text: string, values: Record<string, string | undefined> = {}): LogicValue {
  return evaluateLogic(parseLogic(text), lookupOf(values)).value;
}

function resultOf(text: string, values: Record<string, string | undefined> = {}): boolean | undefined {
  return evaluateCondition(text, lookupOf(values)).result;
}

describe('sample.xml branching logic', () => {
  it('[sex] = "2" and [age] >= 12 and [age] <= 55', () => {
    const text = '[sex] = "2" and [age] >= 12 and [age] <= 55';
    expect(resultOf(text, { sex: '2', age: '30' })).toBe(true);
    expect(resultOf(text, { sex: '1', age: '30' })).toBe(false);
    expect(resultOf(text, { sex: '2', age: '60' })).toBe(false);
  });

  it('[age] >= 18 and >= 16', () => {
    expect(resultOf('[age] >= 18', { age: '18' })).toBe(true);
    expect(resultOf('[age] >= 16', { age: '15' })).toBe(false);
  });

  it("[smoker] = '1' and [consent] = '1'", () => {
    expect(resultOf("[smoker] = '1' and [consent] = '1'", { smoker: '1', consent: '1' })).toBe(true);
    expect(resultOf("[smoker] = '1' and [consent] = '1'", { smoker: '1', consent: '0' })).toBe(false);
  });

  it("[symptoms(99)] = '1'", () => {
    expect(resultOf("[symptoms(99)] = '1'", { 'symptoms(99)': '1' })).toBe(true);
    expect(resultOf("[symptoms(99)] = '1'", { 'symptoms(99)': '0' })).toBe(false);
  });

  it('single-field gates', () => {
    expect(resultOf("[risk_b] = '1'", { risk_b: '1' })).toBe(true);
    expect(resultOf("[fu_complications] = '1'", { fu_complications: '' })).toBe(false);
    expect(resultOf("[nonexistent_gate] = '1'", { nonexistent_gate: '1' })).toBe(true);
    expect(resultOf("[em_pick] = '99'", { em_pick: '99' })).toBe(true);
    expect(resultOf("[demographics_complete] = '2'", { demographics_complete: '2' })).toBe(true);
  });

  it("[risk_a] = '1' and [smoking_status] = '1'", () => {
    expect(resultOf("[risk_a] = '1' and [smoking_status] = '1'", { risk_a: '1', smoking_status: '1' })).toBe(true);
  });

  it("[weight_change] < -5 or [symptoms(1)] = '1'", () => {
    const text = "[weight_change] < -5 or [symptoms(1)] = '1'";
    expect(resultOf(text, { weight_change: '-6', 'symptoms(1)': '0' })).toBe(true);
    expect(resultOf(text, { weight_change: '-4', 'symptoms(1)': '0' })).toBe(false);
    expect(resultOf(text, { weight_change: '-4', 'symptoms(1)': '1' })).toBe(true);
  });

  it("[event-name] = 'followup_arm_1'", () => {
    expect(resultOf("[event-name] = 'followup_arm_1'", { 'smart:event-name': 'followup_arm_1' })).toBe(true);
    expect(resultOf("[event-name] = 'followup_arm_1'", { 'smart:event-name': 'enrol_arm_1' })).toBe(false);
    expect(resultOf("[event-name] = 'followup_arm_1'", {})).toBeUndefined();
  });

  it("[enrol_arm_2][consent] = '1'", () => {
    expect(resultOf("[enrol_arm_2][consent] = '1'", { 'enrol_arm_2.consent': '1', consent: '0' })).toBe(true);
    expect(resultOf("[enrol_arm_2][consent] = '1'", { consent: '1' })).toBeUndefined();
  });

  it('multiline logic with <> and !=', () => {
    const text = "[sex] &lt;&gt; '1'\nand [sc_int] != ''\nand [age] &gt;= 18"
      .replace('&lt;&gt;', '<>')
      .replace('&gt;=', '>=');
    expect(resultOf(text, { sex: '2', sc_int: '5', age: '20' })).toBe(true);
    expect(resultOf(text, { sex: '1', sc_int: '5', age: '20' })).toBe(false);
    expect(resultOf(text, { sex: '2', sc_int: '', age: '20' })).toBe(false);
  });

  it("[symptoms(99)] = '1' or [sc_flags(2)] = '1'", () => {
    const text = "[symptoms(99)] = '1' or [sc_flags(2)] = '1'";
    expect(resultOf(text, { 'symptoms(99)': '0', 'sc_flags(2)': '1' })).toBe(true);
  });
});

describe('syntax', () => {
  it('gives and binds tighter than or', () => {
    expect(valueOf('1 = 1 or 1 = 0 and 1 = 0')).toBe(true);
    expect(valueOf('(1 = 1 or 1 = 0) and 1 = 0')).toBe(false);
  });

  it('applies arithmetic precedence', () => {
    expect(valueOf('2 + 3 * 4')).toBe(14);
    expect(valueOf('(2 + 3) * 4')).toBe(20);
    expect(valueOf('2 * 3 ^ 2')).toBe(18);
    expect(valueOf('10 - 4 - 3')).toBe(3);
    expect(valueOf('2 + 3 > 4')).toBe(true);
  });

  it('supports == and && || ! and not', () => {
    expect(valueOf('1 == 1 && 2 == 2')).toBe(true);
    expect(valueOf('1 == 2 || 2 == 2')).toBe(true);
    expect(valueOf('!(1 = 2)')).toBe(true);
    expect(valueOf('NOT 1 = 1')).toBe(false);
    expect(valueOf('1 = 1 AND 2 = 2 Or 3 = 4')).toBe(true);
  });

  it('handles != and <>', () => {
    expect(valueOf("[a] != 'x'", { a: 'y' })).toBe(true);
    expect(valueOf("[a] <> 'x'", { a: 'x' })).toBe(false);
  });

  it('handles negative numbers and decimals', () => {
    expect(valueOf('[w] < -5', { w: '-5.5' })).toBe(true);
    expect(valueOf('-2 + 0.5')).toBe(-1.5);
    expect(valueOf('3 - -2')).toBe(5);
  });

  it('ignores modifiers on field references', () => {
    expect(valueOf("[a:value] = '3'", { a: '3' })).toBe(true);
    expect(valueOf("[c(2):checked] = '1'", { 'c(2)': '1' })).toBe(true);
  });

  it('handles double-quoted strings and whitespace anywhere', () => {
    expect(valueOf('\n[a]\t=\n"x y"\n', { a: 'x y' })).toBe(true);
  });

  it('treats garbage as unknown syntax and never throws', () => {
    for (const text of ['[a] = ', '(', '))', '[a] @ 3', "[a] = 'unclosed", 'foo bar', '[bad name] = 1', '[a] [b]', 'if(1,2']) {
      const result = evaluateLogic(parseLogic(text), lookupOf({ a: '1', b: '2' }));
      expect(result.value, text).toBeUndefined();
      expect(result.unsupported, text).toEqual(['syntax']);
    }
  });
});

describe('Kleene logic', () => {
  const lookup = { u: undefined, t: '1', f: '0' };
  const table: Array<[string, boolean | undefined]> = [
    ['[u] = 1 and [f] = 1', false],
    ['[f] = 1 and [u] = 1', false],
    ['[t] = 1 and [u] = 1', undefined],
    ['[u] = 1 and [u] = 1', undefined],
    ['[t] = 1 and [t] = 1', true],
    ['[u] = 1 or [t] = 1', true],
    ['[t] = 1 or [u] = 1', true],
    ['[f] = 1 or [u] = 1', undefined],
    ['[u] = 1 or [u] = 1', undefined],
    ['[f] = 1 or [f] = 1', false],
    ['not [u] = 1', undefined],
    ['not [f] = 1', true],
  ];
  for (const [text, expected] of table) {
    it(text, () => {
      expect(resultOf(text, lookup)).toBe(expected);
    });
  }
});

describe('comparison', () => {
  it('compares numerically when both sides are numeric', () => {
    expect(valueOf("[a] > '9'", { a: '10' })).toBe(true);
    expect(valueOf("[a] = '1.0'", { a: '1' })).toBe(true);
  });

  it('compares as strings otherwise', () => {
    expect(valueOf("[a] > 'abc'", { a: 'abd' })).toBe(true);
    expect(valueOf("[a] = '01x'", { a: '1x' })).toBe(false);
  });

  it('equals blank only when blank', () => {
    expect(valueOf("[x] = ''", { x: '' })).toBe(true);
    expect(valueOf("[x] = ''", { x: '0' })).toBe(false);
    expect(valueOf("[x] <> ''", { x: '' })).toBe(false);
    expect(valueOf("[x] = ''", {})).toBeUndefined();
  });

  it('makes numeric inequality with a blank side false, not unknown', () => {
    expect(valueOf('[age] >= 18', { age: '' })).toBe(false);
    expect(valueOf('[age] < 18', { age: '' })).toBe(false);
    expect(valueOf('[age] >= 18', {})).toBeUndefined();
  });
});

describe('arithmetic', () => {
  it('yields blank with a blank operand and unknown with an unknown one', () => {
    expect(valueOf('[a] + 1', { a: '' })).toBe('');
    expect(valueOf('[a] + 1', {})).toBeUndefined();
    expect(valueOf('1 / 0')).toBe('');
  });
});

describe('conditions', () => {
  it('treats empty text as true', () => {
    expect(evaluateCondition('  \n ', lookupOf({}))).toEqual({ result: true, missing: [], unsupported: [] });
  });

  it('applies truthiness', () => {
    expect(resultOf('[a]', { a: '' })).toBe(false);
    expect(resultOf('[a]', { a: '0' })).toBe(false);
    expect(resultOf('[a]', { a: '2' })).toBe(true);
    expect(resultOf('[a]', { a: 'x' })).toBe(true);
    expect(resultOf('0')).toBe(false);
    expect(resultOf('1 - 1')).toBe(false);
  });
});

describe('functions', () => {
  it('evaluates if', () => {
    expect(valueOf("if([a] = '1', 10, 20)", { a: '1' })).toBe(10);
    expect(valueOf("IF([a] = '1', 10, 20)", { a: '2' })).toBe(20);
    expect(valueOf("if([a] = '1', 10, 20)", {})).toBeUndefined();
    expect(valueOf("if([a] = '1', 5, 5)", {})).toBe(5);
  });

  it('sums ignoring blanks', () => {
    expect(valueOf('sum([a], [b], [c])', { a: '1', b: '', c: '2.5' })).toBe(3.5);
    expect(valueOf('sum([a], [b])', { a: '', b: '' })).toBe(0);
    expect(valueOf('sum([a], [b])', { a: '1' })).toBeUndefined();
  });

  it('rounds', () => {
    expect(valueOf('round(2.5)')).toBe(3);
    expect(valueOf('round(-2.5)')).toBe(-3);
    expect(valueOf('round(1.005, 2)')).toBe(1.01);
    expect(valueOf('roundup(1.21, 1)')).toBe(1.3);
    expect(valueOf('rounddown(1.29, 1)')).toBe(1.2);
    expect(valueOf('round([a])', { a: '' })).toBe('');
  });

  it('does basic maths', () => {
    expect(valueOf('abs(-4)')).toBe(4);
    expect(valueOf('sqrt(16)')).toBe(4);
    expect(valueOf('min(3, 1, 2)')).toBe(1);
    expect(valueOf('max(3, 1, 2)')).toBe(3);
    expect(valueOf('mean(1, 2, 3, "")')).toBe(2);
  });

  it('computes datediff for fixed dates', () => {
    expect(valueOf("datediff('2020-01-01', '2020-01-31', 'd')")).toBe(30);
    expect(valueOf("datediff('2020-01-31', '2020-01-01', 'd')")).toBe(30);
    expect(valueOf("datediff('2020-01-31', '2020-01-01', 'd', 'ymd', true)")).toBe(-30);
    expect(valueOf("datediff('2020-01-01 00:00', '2020-01-01 06:30', 'h')")).toBe(6.5);
    expect(valueOf("datediff('2020-01-01', '2021-01-01', 'y')")).toBeCloseTo(366 / 365.2425, 10);
    expect(valueOf("datediff([d1], [d2], 'd')", { d1: '', d2: '2020-01-01' })).toBe('');
    expect(valueOf("datediff('2020-01-01', 'today', 'd') > 0")).toBe(true);
  });

  it('checks types', () => {
    expect(valueOf('isnumber([a])', { a: '3.5' })).toBe(true);
    expect(valueOf('isnumber([a])', { a: 'x' })).toBe(false);
    expect(valueOf('isinteger([a])', { a: '3.5' })).toBe(false);
    expect(valueOf('isinteger([a])', { a: '-3' })).toBe(true);
    expect(valueOf('isblankormissingcode([a])', { a: '' })).toBe(true);
    expect(valueOf('isblankormissingcode([a])', { a: 'x' })).toBe(false);
  });

  it('does string functions', () => {
    expect(valueOf("contains('hello', 'ell')")).toBe(true);
    expect(valueOf("not_contain('hello', 'ell')")).toBe(false);
    expect(valueOf("starts_with('hello', 'he')")).toBe(true);
    expect(valueOf("ends_with('hello', 'lo')")).toBe(true);
    expect(valueOf("length('hello')")).toBe(5);
    expect(valueOf("left('hello', 2)")).toBe('he');
    expect(valueOf("right('hello', 2)")).toBe('lo');
    expect(valueOf("mid('Vanderbilt', 4, 3)")).toBe('der');
    expect(valueOf("concat('a', [b], 1)", { b: 'x' })).toBe('ax1');
    expect(valueOf("lower('AbC')")).toBe('abc');
    expect(valueOf("upper('AbC')")).toBe('ABC');
    expect(valueOf("trim('  x ')")).toBe('x');
  });

  it('reports unsupported functions as unknown', () => {
    const result = evaluateLogic(parseLogic("frobnicate([a]) = 1"), lookupOf({ a: '1' }));
    expect(result.value).toBeUndefined();
    expect(result.unsupported).toEqual(['frobnicate']);
    expect(result.missing).toEqual([]);
  });

  it('lets a known side decide despite an unsupported function', () => {
    const result = evaluateLogic(parseLogic("[a] = '1' or frobnicate() = 1"), lookupOf({ a: '1' }));
    expect(result.value).toBe(true);
    expect(result.unsupported).toEqual(['frobnicate']);
  });
});

describe('missing', () => {
  it('lists unknown fields in order, deduplicated, when the result is unknown', () => {
    const result = evaluateLogic(parseLogic("[b] = '1' and [a] = '1' and [b] = '2' and [c] = '1'"), lookupOf({ c: '1' }));
    expect(result.value).toBeUndefined();
    expect(result.missing).toEqual(['b', 'a']);
  });

  it('is empty when the result is known', () => {
    const result = evaluateLogic(parseLogic("[a] = '1' and [b] = '1'"), lookupOf({ a: '0' }));
    expect(result.value).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it('parses event prefixes that start with a digit', () => {
    const seen: string[] = [];
    const lookup = { field: (ref: { name: string; event: string }) => { seen.push(ref.event + '/' + ref.name); return '1'; }, smart: () => undefined };
    expect(evaluateCondition("([24_months_arm_1][x]= '1') and [y]='1'", lookup)).toEqual({ result: true, missing: [], unsupported: [] });
    expect(seen).toEqual(['24_months_arm_1/x', '/y']);
    expect(evaluateCondition("[12_months] = '1'", lookup).unsupported).toEqual(['syntax']);
  });

  it('uses the plain field name for event-prefixed references', () => {
    const result = evaluateCondition("[enrol_arm_1][age] > 3", lookupOf({}));
    expect(result.result).toBeUndefined();
    expect(result.missing).toEqual(['age']);
  });
});
