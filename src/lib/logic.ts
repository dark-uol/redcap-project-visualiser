/* REDCap logic parser and three-valued evaluator (branching logic, form display logic, @IF conditions). Pure: no Solid, no DOM. */

/** A value during evaluation. `undefined` means unknown (an input that has not been given). */
export type LogicValue = string | number | boolean | undefined;

/** A field reference as written in logic: `[name]`, `[name(code)]`, `[event][name]`, `[event][name(code)]`. */
export interface LogicFieldRef {
  name: string;
  /** Checkbox option code, '' when absent. */
  code: string;
  /** Event prefix (`[event][name]`), '' when absent. */
  event: string;
}

/** Supplies values to the evaluator. Return `undefined` for unknown. */
export interface LogicLookup {
  /** Value of a field reference: '' for blank; for a checkbox option `[x(code)]`, '1' or '0'. */
  field(ref: LogicFieldRef): string | undefined;
  /** Value of a smart variable such as `event-name` (name without brackets). */
  smart(name: string): string | undefined;
  /**
   * The date `"today"` means, as `YYYY-MM-DD` (year 1000 to 9999). Left out, the system clock's local date is used, which makes a
   * result depend on when it is computed: inject a date wherever results must be reproducible.
   */
  today?(): string | undefined;
}

type BinaryOperator = 'or' | 'and' | '=' | '<>' | '<' | '>' | '<=' | '>=' | '+' | '-' | '*' | '/' | '^';

/** Parsed logic. The node shapes are internal to this module; treat it as opaque outside it. */
export type LogicExpression =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'field'; readonly ref: LogicFieldRef }
  | { readonly kind: 'smart'; readonly name: string }
  | { readonly kind: 'unary'; readonly operator: '-' | '+' | 'not'; readonly operand: LogicExpression }
  | { readonly kind: 'binary'; readonly operator: BinaryOperator; readonly left: LogicExpression; readonly right: LogicExpression }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly LogicExpression[] }
  | { readonly kind: 'syntax' };

export interface LogicResult {
  value: LogicValue;
  /** Field names (without event prefix) whose unknown value made the result unknown, deduplicated, in order of appearance. */
  missing: string[];
  /** Constructs that could not be parsed or evaluated (function names, or 'syntax'), deduplicated. */
  unsupported: string[];
}

export interface ConditionResult {
  /** true / false, or undefined when it cannot be decided. */
  result: boolean | undefined;
  missing: string[];
  unsupported: string[];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'field'; ref: LogicFieldRef }
  | { type: 'smart'; name: string }
  | { type: 'word'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'comma' };

class LogicSyntaxError extends Error {}

const FIELD_BRACKET = /^([A-Za-z][A-Za-z0-9_]*)(?:\(([^()]*)\))?(?::[A-Za-z_]+)?$/;
const SMART_BRACKET = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?::[^\]]*)?$/;
const NUMBER_START = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const WORD_START = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPERATORS = ['<>', '!=', '<=', '>=', '==', '&&', '||', '=', '<', '>', '+', '-', '*', '/', '^', '!'];

/** Reads one `[...]` token at `position`; returns the token and the index after it. */
function readBracket(text: string, position: number): { token: Token; end: number } {
  const close = text.indexOf(']', position);
  if (close < 0) throw new LogicSyntaxError('unclosed bracket');
  const inner = text.slice(position + 1, close).trim();
  const fieldMatch = FIELD_BRACKET.exec(inner);
  if (fieldMatch) {
    return { token: { type: 'field', ref: { name: fieldMatch[1]!, code: fieldMatch[2] ?? '', event: '' } }, end: close + 1 };
  }
  if (SMART_BRACKET.test(inner)) {
    return { token: { type: 'smart', name: inner.split(':')[0]! }, end: close + 1 };
  }
  throw new LogicSyntaxError('bad bracket');
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < text.length) {
    const character = text[position]!;
    if (/\s/.test(character)) {
      position++;
      continue;
    }
    if (character === '[') {
      // unique event names may start with a digit; variable names cannot, so `[12_months_arm_1][x]` is an event prefix
      const eventOnly = /^\[\s*(\d[A-Za-z0-9_]*)\s*\]\[/.exec(text.slice(position));
      if (eventOnly) {
        const second = readBracket(text, position + eventOnly[0].length - 1);
        if (second.token.type !== 'field' || second.token.ref.event) throw new LogicSyntaxError('bad event prefix');
        tokens.push({ type: 'field', ref: { ...second.token.ref, event: eventOnly[1]! } });
        position = second.end;
        continue;
      }
      const first = readBracket(text, position);
      position = first.end;
      if (first.token.type === 'field') {
        // Two adjacent field brackets: the first is the event prefix.
        if (text[position] === '[') {
          const second = readBracket(text, position);
          if (second.token.type === 'field' && first.token.ref.code === '') {
            tokens.push({ type: 'field', ref: { ...second.token.ref, event: first.token.ref.name } });
            position = second.end;
            continue;
          }
        }
      }
      tokens.push(first.token);
      continue;
    }
    if (character === '"' || character === "'") {
      let value = '';
      let index = position + 1;
      let closed = false;
      while (index < text.length) {
        const next = text[index]!;
        if (next === '\\' && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
        } else if (next === character) {
          closed = true;
          index++;
          break;
        } else {
          value += next;
          index++;
        }
      }
      if (!closed) throw new LogicSyntaxError('unclosed string');
      tokens.push({ type: 'string', value });
      position = index;
      continue;
    }
    const rest = text.slice(position);
    const numberMatch = NUMBER_START.exec(rest);
    if (numberMatch) {
      tokens.push({ type: 'number', value: Number(numberMatch[0]) });
      position += numberMatch[0].length;
      continue;
    }
    const wordMatch = WORD_START.exec(rest);
    if (wordMatch) {
      tokens.push({ type: 'word', value: wordMatch[0] });
      position += wordMatch[0].length;
      continue;
    }
    if (character === '(') {
      tokens.push({ type: 'open' });
      position++;
      continue;
    }
    if (character === ')') {
      tokens.push({ type: 'close' });
      position++;
      continue;
    }
    if (character === ',') {
      tokens.push({ type: 'comma' });
      position++;
      continue;
    }
    const operator = OPERATORS.find(function startsHere(candidate) {
      return rest.startsWith(candidate);
    });
    if (!operator) throw new LogicSyntaxError('unexpected character');
    tokens.push({ type: 'operator', value: operator });
    position += operator.length;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent). or < and < not < comparison < additive < multiplicative < power < unary
// ---------------------------------------------------------------------------

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseAll(): LogicExpression {
    const expression = this.parseOr();
    if (this.index < this.tokens.length) throw new LogicSyntaxError('trailing tokens');
    return expression;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private isOperator(...values: string[]): string | undefined {
    const token = this.peek();
    if (token && token.type === 'operator' && values.includes(token.value)) return token.value;
    return undefined;
  }

  private isWord(...values: string[]): string | undefined {
    const token = this.peek();
    if (token && token.type === 'word' && values.includes(token.value.toLowerCase())) return token.value.toLowerCase();
    return undefined;
  }

  private parseOr(): LogicExpression {
    let left = this.parseAnd();
    while (this.isWord('or') || this.isOperator('||')) {
      this.index++;
      left = { kind: 'binary', operator: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): LogicExpression {
    let left = this.parseNot();
    while (this.isWord('and') || this.isOperator('&&')) {
      this.index++;
      left = { kind: 'binary', operator: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): LogicExpression {
    if (this.isWord('not') || this.isOperator('!')) {
      this.index++;
      return { kind: 'unary', operator: 'not', operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): LogicExpression {
    let left = this.parseAdditive();
    for (;;) {
      const operator = this.isOperator('=', '==', '<>', '!=', '<', '>', '<=', '>=');
      if (!operator) return left;
      this.index++;
      const normalized: BinaryOperator = operator === '==' ? '=' : operator === '!=' ? '<>' : (operator as BinaryOperator);
      left = { kind: 'binary', operator: normalized, left, right: this.parseAdditive() };
    }
  }

  private parseAdditive(): LogicExpression {
    let left = this.parseMultiplicative();
    for (;;) {
      const operator = this.isOperator('+', '-');
      if (!operator) return left;
      this.index++;
      left = { kind: 'binary', operator: operator as BinaryOperator, left, right: this.parseMultiplicative() };
    }
  }

  private parseMultiplicative(): LogicExpression {
    let left = this.parsePower();
    for (;;) {
      const operator = this.isOperator('*', '/');
      if (!operator) return left;
      this.index++;
      left = { kind: 'binary', operator: operator as BinaryOperator, left, right: this.parsePower() };
    }
  }

  private parsePower(): LogicExpression {
    let left = this.parseUnary();
    while (this.isOperator('^')) {
      this.index++;
      left = { kind: 'binary', operator: '^', left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): LogicExpression {
    const operator = this.isOperator('-', '+');
    if (operator) {
      this.index++;
      return { kind: 'unary', operator: operator as '-' | '+', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): LogicExpression {
    const token = this.peek();
    if (!token) throw new LogicSyntaxError('unexpected end');
    this.index++;
    switch (token.type) {
      case 'number':
        return { kind: 'number', value: token.value };
      case 'string':
        return { kind: 'string', value: token.value };
      case 'field':
        return { kind: 'field', ref: token.ref };
      case 'smart':
        return { kind: 'smart', name: token.name };
      case 'open': {
        const inner = this.parseOr();
        if (this.peek()?.type !== 'close') throw new LogicSyntaxError('expected )');
        this.index++;
        return inner;
      }
      case 'word': {
        if (this.peek()?.type !== 'open') {
          const lowered = token.value.toLowerCase();
          if (lowered === 'true' || lowered === 'false') return { kind: 'number', value: lowered === 'true' ? 1 : 0 };
          throw new LogicSyntaxError('bare word');
        }
        this.index++;
        const args: LogicExpression[] = [];
        if (this.peek()?.type === 'close') {
          this.index++;
        } else {
          for (;;) {
            args.push(this.parseOr());
            const next = this.peek();
            this.index++;
            if (next?.type === 'comma') continue;
            if (next?.type === 'close') break;
            throw new LogicSyntaxError('bad argument list');
          }
        }
        return { kind: 'call', name: token.value.toLowerCase(), args };
      }
      default:
        throw new LogicSyntaxError('unexpected token');
    }
  }
}

/** Parse REDCap logic. Never throws: unparseable input yields an expression that evaluates to unknown with unsupported 'syntax'. */
export function parseLogic(text: string): LogicExpression {
  try {
    return new Parser(tokenize(text)).parseAll();
  } catch {
    return { kind: 'syntax' };
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

interface EvaluationContext {
  lookup: LogicLookup;
  /** Every field name whose lookup returned undefined, in order of first appearance. */
  missing: string[];
  unsupported: Set<string>;
}

type KnownValue = Exclude<LogicValue, undefined>;

const UNSUPPORTED = Symbol('unsupported');

const NUMERIC_TEXT = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;
const INTEGER_TEXT = /^\s*[-+]?\d+\s*$/;

function toText(value: KnownValue): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

function isNumericText(text: string): boolean {
  return NUMERIC_TEXT.test(text) && Number.isFinite(Number(text));
}

/** Truthiness: '' and '0' are false, numeric strings by value, other strings true. */
function toTruth(value: LogicValue): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value.trim() === '') return false;
  if (isNumericText(value)) return Number(value) !== 0;
  return true;
}

/** A number for arithmetic, or undefined when the value is blank / not numeric. */
function toNumber(value: KnownValue | undefined): number | undefined {
  if (value === undefined) return undefined;
  const text = toText(value);
  return isNumericText(text) ? Number(text) : undefined;
}

function compareValues(operator: BinaryOperator, left: string, right: string): boolean {
  if (isNumericText(left) && isNumericText(right)) {
    const a = Number(left);
    const b = Number(right);
    switch (operator) {
      case '=': return a === b;
      case '<>': return a !== b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      default: return a >= b;
    }
  }
  if (operator === '=') return left === right;
  if (operator === '<>') return left !== right;
  // Choice: REDCap treats a blank side as not satisfying an ordering comparison, so `[age] >= 18`
  // with a blank age is false (not unknown), and so is `[age] < 18`.
  if (isBlank(left) || isBlank(right)) return false;
  switch (operator) {
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    default: return left >= right;
  }
}

function roundTo(value: number, digits: number, mode: 'half' | 'up' | 'down'): number {
  const factor = 10 ** digits;
  const scaled = Number((value * factor).toPrecision(15));
  if (mode === 'up') return Math.ceil(scaled) / factor;
  if (mode === 'down') return Math.floor(scaled) / factor;
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / factor;
}

/** Milliseconds since the epoch (UTC) of an injected `today`; throws on anything but a real calendar date from year 1000 to 9999. */
function parseInjectedToday(text: string): number {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const milliseconds = Date.UTC(year, month - 1, day);
    const date = new Date(milliseconds);
    if (year >= 1000 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return milliseconds;
  }
  throw new Error('today must be a calendar date written YYYY-MM-DD (year 1000 to 9999), not "' + text + '"');
}

/** What `"today"` means: the injected date, else the system clock's local date. */
type Today = () => number;

function todayOf(lookup: LogicLookup): Today {
  return function today(): number {
    const injected = lookup.today?.();
    if (injected !== undefined) return parseInjectedToday(injected);
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  };
}

/** Parses a date as milliseconds since epoch (UTC), or undefined. */
function parseDate(text: string, format: string, today: Today): number | undefined {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'today') return today();
  const match = /^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (!match) return undefined;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3]);
  let year = first;
  let month = second;
  let day = third;
  if (format.startsWith('dmy')) [day, month, year] = [first, second, third];
  else if (format.startsWith('mdy')) [month, day, year] = [first, second, third];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return Date.UTC(year, month - 1, day, Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0));
}

const UNIT_MILLISECONDS: Record<string, number> = {
  y: 365.2425 * 86400000,
  M: 30.44 * 86400000,
  d: 86400000,
  h: 3600000,
  m: 60000,
  s: 1000,
};

function evaluateDateDifference(args: KnownValue[], today: Today): LogicValue {
  if (args.length < 3) return '';
  let format = 'ymd';
  let signed = false;
  for (const extra of args.slice(3)) {
    const lowered = toText(extra).toLowerCase();
    if (lowered === 'true' || lowered === '1') signed = true;
    else if (lowered === 'false' || lowered === '0') signed = false;
    else format = lowered;
  }
  const unitSize = UNIT_MILLISECONDS[toText(args[2]!)];
  if (unitSize === undefined) return '';
  const start = parseDate(toText(args[0]!), format, today);
  const end = parseDate(toText(args[1]!), format, today);
  if (start === undefined || end === undefined) return '';
  const difference = (end - start) / unitSize;
  return signed ? difference : Math.abs(difference);
}

function sumOf(numbers: number[]): number {
  return numbers.reduce(function add(total, number) {
    return total + number;
  }, 0);
}

function evaluateCall(name: string, args: KnownValue[], today: Today): LogicValue | typeof UNSUPPORTED {
  const textAt = function textAt(index: number): string {
    const value = args[index];
    return value === undefined ? '' : toText(value);
  };
  const numericArguments = function numericArguments(): number[] {
    const found: number[] = [];
    for (const value of args) {
      const number = toNumber(value);
      if (number !== undefined) found.push(number);
    }
    return found;
  };
  const first = toNumber(args[0]);
  const digits = toNumber(args[1]) ?? 0;
  switch (name) {
    case 'sum': return sumOf(numericArguments());
    case 'min': { const found = numericArguments(); return found.length ? Math.min(...found) : ''; }
    case 'max': { const found = numericArguments(); return found.length ? Math.max(...found) : ''; }
    case 'mean': { const found = numericArguments(); return found.length ? sumOf(found) / found.length : ''; }
    case 'round': return first === undefined ? '' : roundTo(first, digits, 'half');
    case 'roundup': return first === undefined ? '' : roundTo(first, digits, 'up');
    case 'rounddown': return first === undefined ? '' : roundTo(first, digits, 'down');
    case 'abs': return first === undefined ? '' : Math.abs(first);
    case 'sqrt': return first === undefined || first < 0 ? '' : Math.sqrt(first);
    case 'datediff': return evaluateDateDifference(args, today);
    case 'isnumber': return isNumericText(textAt(0));
    case 'isinteger': return INTEGER_TEXT.test(textAt(0));
    case 'isblankormissingcode': return isBlank(textAt(0));
    case 'contains': return textAt(0).includes(textAt(1));
    case 'not_contain': return !textAt(0).includes(textAt(1));
    case 'starts_with': return textAt(0).startsWith(textAt(1));
    case 'ends_with': return textAt(0).endsWith(textAt(1));
    case 'length': return textAt(0).length;
    case 'left': return textAt(0).slice(0, Math.max(0, digits));
    case 'right': return digits > 0 ? textAt(0).slice(-digits) : '';
    case 'mid': {
      const start = toNumber(args[1]) ?? 1;
      const count = toNumber(args[2]) ?? 0;
      const from = Math.max(0, start - 1);
      return textAt(0).slice(from, from + Math.max(0, count));
    }
    case 'concat': return args.map(toText).join('');
    case 'lower': return textAt(0).toLowerCase();
    case 'upper': return textAt(0).toUpperCase();
    case 'trim': return textAt(0).trim();
    default: return UNSUPPORTED;
  }
}

function evaluateBinary(operator: BinaryOperator, left: LogicValue, right: LogicValue): LogicValue {
  if (operator === 'and' || operator === 'or') {
    const a = toTruth(left);
    const b = toTruth(right);
    const decisive = operator === 'or';
    if (a === decisive || b === decisive) return decisive;
    if (a === undefined || b === undefined) return undefined;
    return !decisive;
  }
  if (left === undefined || right === undefined) return undefined;
  if (operator === '+' || operator === '-' || operator === '*' || operator === '/' || operator === '^') {
    const a = toNumber(left);
    const b = toNumber(right);
    if (a === undefined || b === undefined) return '';
    let result: number;
    switch (operator) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*': result = a * b; break;
      case '/': result = a / b; break;
      default: result = a ** b;
    }
    return Number.isFinite(result) ? result : '';
  }
  return compareValues(operator, toText(left), toText(right));
}

function evaluateNode(node: LogicExpression, context: EvaluationContext): LogicValue {
  switch (node.kind) {
    case 'number':
    case 'string':
      return node.value;
    case 'syntax':
      context.unsupported.add('syntax');
      return undefined;
    case 'field': {
      const value = context.lookup.field(node.ref);
      if (value === undefined && !context.missing.includes(node.ref.name)) context.missing.push(node.ref.name);
      return value;
    }
    case 'smart':
      return context.lookup.smart(node.name);
    case 'unary': {
      const operand = evaluateNode(node.operand, context);
      if (operand === undefined) return undefined;
      if (node.operator === 'not') {
        const truth = toTruth(operand);
        return truth === undefined ? undefined : !truth;
      }
      const number = toNumber(operand);
      if (number === undefined) return '';
      return node.operator === '-' ? -number : number;
    }
    case 'binary':
      return evaluateBinary(node.operator, evaluateNode(node.left, context), evaluateNode(node.right, context));
    case 'call': {
      const values = node.args.map(function evaluateArgument(argument) {
        return evaluateNode(argument, context);
      });
      if (node.name === 'if') {
        if (values.length !== 3) {
          context.unsupported.add('if');
          return undefined;
        }
        const condition = toTruth(values[0]);
        if (condition === true) return values[1];
        if (condition === false) return values[2];
        // Unknown condition: still decided when both branches agree.
        return values[1] !== undefined && values[1] === values[2] ? values[1] : undefined;
      }
      // Probe with no arguments to learn whether the function name is known at all.
      const today = todayOf(context.lookup);
      if (evaluateCall(node.name, [], today) === UNSUPPORTED) {
        context.unsupported.add(node.name);
        return undefined;
      }
      if (values.some(function isUnknown(value) { return value === undefined; })) return undefined;
      return evaluateCall(node.name, values as KnownValue[], today) as LogicValue;
    }
  }
}

/** Evaluate a parsed expression with Kleene three-valued logic. */
export function evaluateLogic(expression: LogicExpression, lookup: LogicLookup): LogicResult {
  const context: EvaluationContext = { lookup, missing: [], unsupported: new Set() };
  const value = evaluateNode(expression, context);
  return {
    value,
    missing: value === undefined ? context.missing : [],
    unsupported: [...context.unsupported],
  };
}

/** Parse and evaluate `text` as a condition. Empty / whitespace-only text is true (no condition). */
export function evaluateCondition(text: string, lookup: LogicLookup): ConditionResult {
  if (text.trim() === '') return { result: true, missing: [], unsupported: [] };
  const { value, missing, unsupported } = evaluateLogic(parseLogic(text), lookup);
  return { result: toTruth(value), missing, unsupported };
}

export interface ValueResult {
  /** The value as text (a number as JavaScript prints it), or undefined when it cannot be decided yet. */
  value: string | undefined;
  unsupported: string[];
}

/** Parse and evaluate `text` as an expression (a calculation) and give its value, which is blank text when the inputs are blank or not numbers. */
export function evaluateValue(text: string, lookup: LogicLookup): ValueResult {
  const { value, unsupported } = evaluateLogic(parseLogic(text), lookup);
  return { value: value === undefined ? undefined : toText(value), unsupported };
}

const BRACKET_RUN = /(?:\[[^[\]]*\])+/g;

/**
 * Text with `[field]` references in it (piping, as in `@DEFAULT='ID-[event][field]'`) as an expression that builds it:
 * `concat("ID-", [event][field])`. Evaluating that with the ordinary evaluator pipes the values in, and an input that is not known
 * makes the whole text unknown, so event prefixes, smart variables and missing-input tracking all behave as in any other logic.
 */
export function pipedTextExpression(text: string): string {
  const quote = (literal: string): string => '"' + literal.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const pieces: string[] = [];
  let end = 0;
  for (const match of text.matchAll(BRACKET_RUN)) {
    if (match.index > end) pieces.push(quote(text.slice(end, match.index)));
    pieces.push(match[0]);
    end = match.index + match[0].length;
  }
  if (end < text.length) pieces.push(quote(text.slice(end)));
  return 'concat(' + pieces.join(', ') + ')';
}

/** One top-level operand of a condition, with the `and` / `or` (as written) that joins it to the previous one ('' for the first). */
export interface LogicPart { joiner: string; text: string }

const JOINER = /^(?:and|or)\b|^&&|^\|\|/i;
const BEFORE_WORD_JOINER = /[\s)\]'"]/;

/**
 * Split a condition at its top-level `and` / `or` (outside brackets, parentheses and quotes), keeping the text as written, so each
 * operand can be judged on its own. Text with no top-level joiner comes back as a single part.
 */
export function splitLogicParts(text: string): LogicPart[] {
  const parts: LogicPart[] = [];
  let depth = 0, quote = '', start = 0, joiner = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(' || character === '[') { depth++; continue; }
    if (character === ')' || character === ']') { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue;
    const symbolic = character === '&' || character === '|';
    const wordAllowed = index > 0 && BEFORE_WORD_JOINER.test(text[index - 1]!);
    const match = symbolic || wordAllowed ? JOINER.exec(text.slice(index)) : null;
    if (!match) continue;
    const before = text.slice(start, index).trim();
    if (before) parts.push({ joiner, text: before });
    joiner = match[0];
    start = index + match[0].length;
    index = start - 1;
  }
  const rest = text.slice(start).trim();
  if (rest) parts.push({ joiner, text: rest });
  return parts;
}
