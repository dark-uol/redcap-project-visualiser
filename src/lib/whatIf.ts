/* What-if visibility: given values for some fields, decide which fields and forms are shown, hidden or unknown. Pure: no Solid, no DOM. */

import { evaluateCondition, evaluateValue, pipedTextExpression, splitLogicParts } from './logic';
import type { LogicFieldRef, LogicLookup, LogicPart } from './logic';
import type { EventDef, Field, ModelBase } from './types';

export type Visibility = 'shown' | 'hidden' | 'unknown';
/** A plain value, or (for a checkbox field) the list of checked option codes. */
export type WhatIfValue = string | string[];

/** The key of the values bucket that applies in every event. */
export const ANY_EVENT = '';

export interface WhatIfContext {
  /** Values by event id. The key '' (ANY_EVENT) holds values that apply in every event; an event's own value wins over ''. */
  values: Readonly<Record<string, Readonly<Record<string, WhatIfValue>>>>;
  mode: 'survey' | 'form';
  /** Unique event name the record is viewed in, or null when not chosen. */
  event: string | null;
  /** The date `"today"` means in logic, as `YYYY-MM-DD`. Left out, the system clock's local date: set it when results must be reproducible. */
  today?: string;
  /**
   * Work out the value of a calculated field, or of a field with a top-level `@DEFAULT`, when none is set, instead of leaving it unknown.
   * For exploring a project. Off, a value is only what was set: exported data already holds the stored calculations and defaults, and
   * deriving them for cells that are missing would invent data.
   */
  derive?: boolean;
}

/** A value the evaluation needs but does not have: the variable, and the event it lives in (null when no event is chosen). */
export interface MissingInput { variable: string; event: string | null }

export interface VisibilityInfo {
  state: Visibility;
  /** Short human-readable reasons, e.g. 'branching logic false', '@HIDDEN-SURVEY', 'form hidden by form display logic'. */
  reasons: string[];
  /** Values needed to decide, deduplicated by variable and event, in order of first appearance. */
  missing: MissingInput[];
}

const MAX_ROUNDS = 50;

/** The reasons that make a hidden field read as blank in other logic (a hidden form, branching logic that is false). Action-tag hiding is not one: it keeps the value. */
const BLANKING_REASONS: ReadonlySet<string> = new Set(['branching logic false', 'form hidden by form display logic', 'form not used in this event']);

/** True when the field is hidden in a way that makes it read as blank, so a value set for it is not used by any other logic. */
export function valueIsIgnored(info: VisibilityInfo | undefined): boolean {
  return info !== undefined && info.state === 'hidden' && info.reasons.some((reason) => BLANKING_REASONS.has(reason));
}

// ---------- action tags ----------

/** A parsed action-tag item: a plain tag name, or an `@IF(condition, then, else)` with the raw branch texts. */
export type ActionTagItem =
  | { kind: 'tag'; name: string }
  | { kind: 'if'; condition: string; thenText: string; elseText: string };

/** Split `text` at top-level commas, honouring quotes and nested parentheses. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      current += character;
      if (character === '\\' && index + 1 < text.length) current += text[++index];
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '(') depth++;
    else if (character === ')') depth--;
    if (character === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += character;
  }
  parts.push(current);
  return parts;
}

/** Index of the `)` matching the `(` at `open`, skipping quoted strings; -1 when unbalanced. */
function matchingParenthesis(text: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth++;
    else if (character === ')' && --depth === 0) return index;
  }
  return -1;
}

/** Extract the tags (upper-cased names) and `@IF(...)` constructs from an annotation. */
export function parseActionTags(annotation: string): ActionTagItem[] {
  const items: ActionTagItem[] = [];
  const pattern = /@([A-Za-z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(annotation))) {
    const name = match[1].toUpperCase();
    if (name === 'IF') {
      let open = match.index + match[0].length;
      while (open < annotation.length && /\s/.test(annotation[open])) open++;
      if (annotation[open] === '(') {
        const close = matchingParenthesis(annotation, open);
        if (close >= 0) {
          const parts = splitTopLevel(annotation.slice(open + 1, close));
          items.push({ kind: 'if', condition: parts[0] ?? '', thenText: (parts[1] ?? '').trim(), elseText: parts.slice(2).join(',').trim() });
          pattern.lastIndex = close + 1;
          continue;
        }
      }
    }
    items.push({ kind: 'tag', name });
  }
  return items;
}

interface Contribution {
  state: Visibility;
  reasons: string[];
  missing: MissingInput[];
}

/** Evaluates a condition and reports the (variable, event) inputs whose lookup was unknown. */
interface TrackedResult { result: boolean | undefined; missing: MissingInput[] }
type Evaluate = (text: string) => TrackedResult;

const uniqueInputs = (inputs: MissingInput[]): MissingInput[] => {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = inputKey(input);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const inputKey = (input: MissingInput): string => input.variable + '@' + (input.event ?? '\u0000');

const combine = (parts: Contribution[]): Contribution => {
  const reasons = parts.flatMap((part) => part.reasons);
  const missing = uniqueInputs(parts.flatMap((part) => part.missing));
  const state: Visibility = parts.some((part) => part.state === 'hidden') ? 'hidden' : parts.some((part) => part.state === 'unknown') ? 'unknown' : 'shown';
  return { state, reasons, missing };
};

function tagContribution(annotation: string, mode: 'survey' | 'form', evaluate: Evaluate): Contribution {
  const parts: Contribution[] = parseActionTags(annotation).map((item): Contribution => {
    if (item.kind === 'tag') {
      const hides = item.name === 'HIDDEN' || (item.name === 'HIDDEN-SURVEY' && mode === 'survey') || (item.name === 'HIDDEN-FORM' && mode === 'form');
      return { state: hides ? 'hidden' : 'shown', reasons: hides ? ['@' + item.name] : [], missing: [] };
    }
    const condition = evaluate(item.condition);
    if (condition.result === true) return tagContribution(item.thenText, mode, evaluate);
    if (condition.result === false) return tagContribution(item.elseText, mode, evaluate);
    const whenTrue = tagContribution(item.thenText, mode, evaluate), whenFalse = tagContribution(item.elseText, mode, evaluate);
    if (whenTrue.state === 'shown' && whenFalse.state === 'shown') return { state: 'shown', reasons: [], missing: [] };
    if (whenTrue.state === 'hidden' && whenFalse.state === 'hidden') return combine([whenTrue, whenFalse]);
    return { state: 'unknown', reasons: ['@IF condition unknown'], missing: condition.missing };
  });
  return combine(parts);
}

// ---------- evaluation ----------

const unique = (values: string[]): string[] => [...new Set(values)];

const SHOWN: VisibilityInfo = { state: 'shown', reasons: [], missing: [] };

const NOT_IN_EVENT: VisibilityInfo = { state: 'hidden', reasons: ['form not used in this event'], missing: [] };

/** False when an event is chosen and the form is not designated in it (unknown event ids are not held against the form). */
function formUsedInEvent(model: ModelBase, formId: string, event: string | null): boolean {
  if (event === null) return true;
  const definition = (model.parsed.events || []).find((candidate) => candidate.id === event);
  return !definition || definition.forms.includes(formId);
}

function formNodeInfo(model: ModelBase, nodeId: string, context: WhatIfContext, evaluate: Evaluate): VisibilityInfo {
  const node = model.formNodes.get(nodeId);
  if (!node) return SHOWN;
  if (!formUsedInEvent(model, node.form, context.event)) return NOT_IN_EVENT;
  const applicable: string[] = [];
  node.logic.forEach((logic, index) => {
    const events = node.logicEvents[index] ?? [];
    if (context.event === null || events.length === 0 || events.includes(context.event)) applicable.push(logic);
  });
  // no rule applies in this event: the form is not restricted
  if (applicable.length === 0) return SHOWN;
  const results = applicable.map((logic) => evaluate(logic));
  if (results.some((result) => result.result === true)) return SHOWN;
  if (results.every((result) => result.result === false)) return { state: 'hidden', reasons: ['form hidden by form display logic'], missing: [] };
  return {
    state: 'unknown',
    reasons: ['form display logic unknown'],
    missing: uniqueInputs(results.filter((result) => result.result === undefined).flatMap((result) => result.missing)),
  };
}

interface FieldOutcome {
  info: VisibilityInfo;
  /** Hidden by branching logic or a hidden form, so it cannot hold an answer. Action-tag hiding keeps the value (@HIDDEN fields often carry @DEFAULT or calculated values). */
  blank: boolean;
}

function fieldOutcome(model: ModelBase, field: Field, context: WhatIfContext, evaluate: Evaluate, formStates: Map<string, VisibilityInfo>): FieldOutcome {
  if (!formUsedInEvent(model, field.form, context.event)) return { info: NOT_IN_EVENT, blank: true };
  const parts: Contribution[] = [];
  const formState = model.formNodes.has('form:' + field.form) ? formStates.get('form:' + field.form) : undefined;
  if (formState && formState.state !== 'shown') parts.push(formState);
  if (field.annotation) parts.push(tagContribution(field.annotation, context.mode, evaluate));
  let branchingFalse = false;
  if (field.branching && field.branching.trim()) {
    const result = evaluate(field.branching);
    branchingFalse = result.result === false;
    if (branchingFalse) parts.push({ state: 'hidden', reasons: ['branching logic false'], missing: [] });
    else if (result.result === undefined) parts.push({ state: 'unknown', reasons: ['branching logic unknown'], missing: result.missing });
  }
  // once something definitely hides the field, the undecided parts no longer matter: report only what hides it
  const combined = combine(parts.some((part) => part.state === 'hidden') ? parts.filter((part) => part.state === 'hidden') : parts);
  return {
    info: { state: combined.state, reasons: unique(combined.reasons), missing: combined.missing },
    blank: branchingFalse || formState?.state === 'hidden',
  };
}

/**
 * Smart variables (`[user-role-label]`, `[record-dag-name]`, …) are set like fields, in the ANY_EVENT bucket (or an event's), under
 * their bracketed name. Brackets and hyphens keep the key apart from every REDCap variable name.
 */
export const smartKey = (name: string): string => '[' + name + ']';
export const isSmartKey = (variable: string): boolean => variable.startsWith('[');

/** Smart variables that follow from the event the record is viewed in; undefined for any other name. */
function eventSmartValue(event: EventDef, name: string): string | undefined {
  switch (name) {
    case 'event-name': return event.id;
    case 'event-label': return event.label;
    case 'arm-number': return event.arm;
    case 'arm-label': return event.armName;
    default: return undefined;
  }
}

/** The event a reference reads from: its own prefix, else `base`, the event it is being read in (null when neither). */
const targetEvent = (ref: LogicFieldRef, base: string | null): string | null => ref.event || base;

const DEFAULT_TAG = /@DEFAULT(?![A-Za-z0-9_-])\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))/gi;

/**
 * The text of a top-level `@DEFAULT=…` in an action-tag annotation, or undefined. A default inside an `@IF(…)` is not found: it
 * depends on a condition, and is not derived yet.
 */
export function topLevelDefault(annotation: string): string | undefined {
  const conditional: [number, number][] = [];
  const ifPattern = /@IF\s*\(/gi;
  let found: RegExpExecArray | null;
  while ((found = ifPattern.exec(annotation))) {
    const close = matchingParenthesis(annotation, found.index + found[0].length - 1);
    if (close >= 0) {
      conditional.push([found.index, close]);
      ifPattern.lastIndex = close + 1;
    }
  }
  for (const match of annotation.matchAll(DEFAULT_TAG)) {
    if (conditional.some(([from, to]) => match.index >= from && match.index <= to)) continue;
    return match[1] ?? match[2] ?? match[3];
  }
  return undefined;
}

/** What reading a field gave: its value (undefined: not known yet) and, for a derived field whose value is not known, the inputs that decide it. */
interface FieldRead { value: string | undefined; deciding?: MissingInput[] }

function makeReader(model: ModelBase, context: WhatIfContext, blankFields: ReadonlySet<string>): { evaluate: Evaluate; derivedValues: () => Map<string, string> } {
  const derive = context.derive === true;
  const derivations = new Map<string, FieldRead>();
  const inProgress = new Set<string>();

  /** The value of a calculated field, or of a field with a `@DEFAULT`, from the inputs it reads (in the event it is read in). */
  const derivedRead = function derivedRead(field: Field, target: string | null): FieldRead {
    const key = field.variable + '@' + (target ?? '\u0000');
    const known = derivations.get(key);
    if (known) return known;
    if (inProgress.has(key)) return { value: undefined, deciding: [] }; // a calculation that depends on itself cannot be decided
    const fallback = topLevelDefault(field.annotation || '');
    const expression = field.calc && field.calc.trim() ? field.calc : fallback === undefined ? undefined : pipedTextExpression(fallback);
    if (expression === undefined) return { value: undefined };
    inProgress.add(key);
    const { lookup, recorded } = tracking(target);
    const { value } = evaluateValue(expression, lookup);
    inProgress.delete(key);
    const read: FieldRead = value === undefined ? { value, deciding: uniqueInputs(recorded) } : { value };
    derivations.set(key, read);
    return read;
  };

  /** `base` is the event unprefixed references mean: the viewed event, or, inside a derived field, the event that field is read in. */
  const readField = function readField(ref: LogicFieldRef, base: string | null): FieldRead {
    const target = targetEvent(ref, base);
    const field = model.byVar.get(ref.name);
    const isCheckbox = field?.type === 'checkbox';
    const blank = isCheckbox && ref.code ? '0' : '';
    // REDCap reads a field from an event it is not collected in as blank
    if (target !== null && field) {
      const definition = (model.parsed.events || []).find((candidate) => candidate.id === target);
      if (definition && !definition.forms.includes(field.form)) return { value: blank };
    }
    // a field hidden by branching or form display logic counts as blank, as a participant would experience it (an unchecked option reads '0')
    if (target === context.event && blankFields.has(ref.name)) return { value: blank };
    const value = (target !== null ? context.values[target]?.[ref.name] : undefined) ?? context.values[ANY_EVENT]?.[ref.name];
    // nothing set: a calculation or a default can still give it a value
    if (value === undefined) return derive && field && !(ref.code && isCheckbox) ? derivedRead(field, target) : { value: undefined };
    if (ref.code && isCheckbox) {
      const checked = Array.isArray(value) ? value : value.split(',').map((code) => code.trim());
      return { value: checked.includes(ref.code) ? '1' : '0' };
    }
    return { value: Array.isArray(value) ? value.join(',') : value };
  };
  const viewedEvent = (model.parsed.events || []).find((candidate) => candidate.id === context.event);
  const lookupSmart = function lookupSmart(name: string): string | undefined {
    // the event the record is viewed in answers its own smart variables; anything else is a value the user sets
    if (name === 'event-name' && context.event !== null) return context.event;
    if (viewedEvent) {
      const derived = eventSmartValue(viewedEvent, name);
      if (derived !== undefined) return derived;
    }
    const key = smartKey(name);
    const value = (context.event !== null ? context.values[context.event]?.[key] : undefined) ?? context.values[ANY_EVENT]?.[key];
    return Array.isArray(value) ? value.join(',') : value;
  };
  /** A lookup that reads in `base`, and the inputs it found not to be known. */
  const tracking = function tracking(base: string | null): { lookup: LogicLookup; recorded: MissingInput[] } {
    const recorded: MissingInput[] = [];
    const lookup: LogicLookup = {
      field: function trackedField(ref: LogicFieldRef): string | undefined {
        const read = readField(ref, base);
        if (read.value === undefined) {
          // nobody sets a calculation: report the inputs that decide it, and the field itself only when they are not known
          if (read.deciding && read.deciding.length) recorded.push(...read.deciding);
          else recorded.push({ variable: ref.name, event: targetEvent(ref, base) });
        }
        return read.value;
      },
      smart: function trackedSmart(name: string): string | undefined {
        const value = lookupSmart(name);
        if (value === undefined) recorded.push({ variable: smartKey(name), event: null });
        return value;
      },
      today: function today(): string | undefined { return context.today; },
    };
    return { lookup, recorded };
  };
  const evaluate = function evaluate(text: string): TrackedResult {
    const { lookup, recorded } = tracking(context.event);
    const result = evaluateCondition(text, lookup).result;
    return { result, missing: result === undefined ? uniqueInputs(recorded) : [] };
  };
  /**
   * The value each calculated field, or field with a top-level `@DEFAULT`, has in the viewed event, when it comes from its inputs: not
   * set by hand, collected in the event, not hidden so that it reads blank, and decided. The intermediate steps of a chain of calculations.
   */
  const derivedValues = function derivedValues(): Map<string, string> {
    const values = new Map<string, string>();
    if (!derive) return values;
    model.byVar.forEach((field, variable) => {
      if (!(field.calc && field.calc.trim()) && topLevelDefault(field.annotation || '') === undefined) return;
      const definition = context.event === null ? undefined : (model.parsed.events || []).find((candidate) => candidate.id === context.event);
      if (definition && !definition.forms.includes(field.form)) return;
      if (blankFields.has(variable)) return;
      const setByHand = (context.event !== null ? context.values[context.event]?.[variable] : undefined) ?? context.values[ANY_EVENT]?.[variable];
      if (setByHand !== undefined) return;
      const read = derivedRead(field, context.event);
      if (read.value !== undefined) values.set(variable, read.value);
    });
    return values;
  };
  return { evaluate, derivedValues };
}

function makeEvaluate(model: ModelBase, context: WhatIfContext, blankFields: ReadonlySet<string>): Evaluate {
  return makeReader(model, context, blankFields).evaluate;
}

const sameInfo = (left: VisibilityInfo | undefined, right: VisibilityInfo): boolean =>
  left !== undefined && left.state === right.state && left.reasons.join('\u0000') === right.reasons.join('\u0000') && left.missing.map(inputKey).join('\u0000') === right.missing.map(inputKey).join('\u0000');

/** Keys: every field variable in model.byVar, plus every form node id ('form:<form id>') in model.formNodes. */
export function evaluateVisibility(model: ModelBase, context: WhatIfContext): Map<string, VisibilityInfo> {
  let current = new Map<string, VisibilityInfo>();
  model.byVar.forEach((_field, variable) => current.set(variable, { state: 'unknown', reasons: [], missing: [] }));
  model.formNodes.forEach((_node, nodeId) => current.set(nodeId, { state: 'unknown', reasons: [], missing: [] }));

  let blankFields = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const previous = current;
    const evaluate = makeEvaluate(model, context, blankFields);
    const next = new Map<string, VisibilityInfo>();
    const nextBlank = new Set<string>();
    model.formNodes.forEach((_node, nodeId) => next.set(nodeId, formNodeInfo(model, nodeId, context, evaluate)));
    model.byVar.forEach((field, variable) => {
      const outcome = fieldOutcome(model, field, context, evaluate, next);
      next.set(variable, outcome.info);
      if (outcome.blank) nextBlank.add(variable);
    });
    let changed = false;
    next.forEach((info, key) => { if (!sameInfo(previous.get(key), info)) changed = true; });
    current = next;
    blankFields = nextBlank;
    if (!changed) break;
  }
  blankFieldsOf.set(current, blankFields);
  derivedValuesOf.set(current, makeReader(model, context, blankFields).derivedValues());
  return current;
}

/** The fields each evaluateVisibility result treated as blank, so a piece of logic can be judged again exactly as it was. */
const blankFieldsOf = new WeakMap<Map<string, VisibilityInfo>, ReadonlySet<string>>();

/** The values each evaluateVisibility result worked out for calculated and defaulted fields (empty unless `derive` was on). */
const derivedValuesOf = new WeakMap<Map<string, VisibilityInfo>, ReadonlyMap<string, string>>();

/** The value a result worked out for a calculated or defaulted field in the event it was evaluated for, or undefined when it did not (set by hand, hidden, undecided, not derived). */
export function derivedValue(results: Map<string, VisibilityInfo> | null | undefined, variable: string): string | undefined {
  return results ? derivedValuesOf.get(results)?.get(variable) : undefined;
}

/** All of them, for results that need to be compared or listed. */
export function derivedValues(results: Map<string, VisibilityInfo>): ReadonlyMap<string, string> {
  return derivedValuesOf.get(results) ?? new Map();
}

/** For results that did not come from evaluateVisibility (the Python engine's): record the values they worked out. */
export function rememberDerivedValues(results: Map<string, VisibilityInfo>, values: Iterable<[string, string]>): void {
  derivedValuesOf.set(results, new Map(values));
}

/** For results that did not come from evaluateVisibility (the Python engine's): record the fields they treated as blank, so explainLogic agrees. */
export function rememberBlankFields(results: Map<string, VisibilityInfo>, blankFields: Iterable<string>): void {
  blankFieldsOf.set(results, new Set(blankFields));
}

/** One top-level operand of a condition and how it came out: true, false, or undefined when it cannot be decided yet. */
export interface ExplainedPart extends LogicPart { result: boolean | undefined }

/**
 * A condition split at its top-level `and` / `or`, each operand judged with the same values, event and blank fields that
 * produced `results` (from evaluateVisibility with this context), to show which part decides it.
 */
export function explainLogic(model: ModelBase, context: WhatIfContext, results: Map<string, VisibilityInfo>, text: string): ExplainedPart[] {
  const evaluate = makeEvaluate(model, context, blankFieldsOf.get(results) ?? new Set());
  return splitLogicParts(text).map((part) => ({ ...part, result: evaluate(part.text).result }));
}

/**
 * The events in which to judge a field or form node (`form:<id>`): the selected event when its form is used there (or no event
 * is selected), otherwise every event its form is used in, in project order. A dependent that lives only in other events
 * (`[baseline][x]` read at a later visit) says nothing useful in the selected event, where its form does not exist.
 */
export function eventsToEvaluate(model: ModelBase, nodeId: string, selectedEvent: string | null): (string | null)[] {
  const formId = model.byVar.get(nodeId)?.form ?? model.formNodes.get(nodeId)?.form;
  if (selectedEvent === null || formId === undefined || formUsedInEvent(model, formId, selectedEvent)) return [selectedEvent];
  const events = (model.parsed.events || []).filter((event) => event.forms.includes(formId)).map((event) => event.id);
  return events.length ? events : [selectedEvent];
}

/** The fields and form nodes whose visibility depends (directly, via branching / actiontag / formlogic edges) on `variable`. */
export function dependentsOf(model: ModelBase, variable: string): string[] {
  const targets = model.edges
    .filter((edge) => edge.from === variable && (edge.type === 'branching' || edge.type === 'actiontag' || edge.type === 'formlogic'))
    .map((edge) => edge.to);
  return unique(targets);
}

const VISIBILITY_EDGES = new Set(['branching', 'actiontag', 'formlogic']);
const VISIBILITY_AND_CALCULATION_EDGES = new Set([...VISIBILITY_EDGES, 'calc']);

/**
 * The variables that directly decide whether a field or form node (`form:<id>`) is shown: its branching logic and action tags, and for a
 * field the display logic of its form. With `calculations`, the inputs of a calculated field too: its value is worked out from them.
 */
function directControllersOf(model: ModelBase, nodeId: string, calculations: boolean): string[] {
  const formId = model.byVar.get(nodeId)?.form;
  const targets = new Set([nodeId, ...(formId === undefined ? [] : ['form:' + formId])]);
  const kinds = calculations ? VISIBILITY_AND_CALCULATION_EDGES : VISIBILITY_EDGES;
  return unique(model.edges.filter((edge) => targets.has(edge.to) && kinds.has(edge.type)).map((edge) => edge.from));
}

/** One variable upstream of a field: how many steps away it is (1 = named in the field's own logic or its form's display logic). */
export interface Controller { variable: string; depth: number }

/**
 * Working backwards: every variable that can decide whether `nodeId` is shown, nearest first. A controller counts as blank when it
 * is itself hidden, so the variables deciding its visibility are followed too (breadth first, each listed once at its smallest depth).
 * Calculations are not followed unless `calculations` is set: otherwise a calculated controller is set directly. The node itself is never listed, even in a cycle.
 */
export function controllersOf(model: ModelBase, nodeId: string, calculations = false): Controller[] {
  const found = new Map<string, number>([[nodeId, 0]]);
  let frontier = [nodeId];
  for (let depth = 1; frontier.length; depth++) {
    const next: string[] = [];
    // with `calculations` (a value is worked out from its inputs), a calculated controller is followed into its inputs, though the node itself is not: its own calculation says nothing about whether it is shown
    frontier.forEach((current) => directControllersOf(model, current, calculations && current !== nodeId).forEach((variable) => {
      if (found.has(variable)) return;
      found.set(variable, depth);
      next.push(variable);
    }));
    frontier = next;
  }
  found.delete(nodeId);
  return [...found].map(([variable, depth]) => ({ variable, depth }));
}

/** The events whose forms include the field's form, in project order (empty for a non-longitudinal project). */
export function eventsForField(model: ModelBase, variable: string): string[] {
  const formId = model.byVar.get(variable)?.form;
  return (model.parsed.events || []).filter((event) => formId !== undefined && event.forms.includes(formId)).map((event) => event.id);
}

/** The event a field is edited in: `current` when its form is used there, else the first event its form is used in (null when none, e.g. not longitudinal). */
export function eventForField(model: ModelBase, variable: string, current: string | null): string | null {
  const events = eventsForField(model, variable);
  return current !== null && events.includes(current) ? current : events[0] ?? null;
}
