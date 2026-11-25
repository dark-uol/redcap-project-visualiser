/* Row and table derivations for the What if tab: the values table's rows, the field chooser's matches, the visibility tables' filters and counts. Pure: no Solid, no DOM, no store. */

import { ANY_EVENT, smartKey } from './whatIf';
import type { Visibility, WhatIfValue } from './whatIf';
import type { ModelBase } from './types';

/** One row of the values table: a field or smart variable key, and the event its value is for (null: every event, or no events). */
export interface TableRow { variable: string; event: string | null }

export const rowKeyOf = (row: TableRow): string => row.variable + '|' + (row.event ?? '');

/** The rows as listed: the ones the user added, in order, then any value set in `values` (the Needs inputs) that no listed row covers. */
export function displayRows(
  listed: readonly TableRow[],
  values: Readonly<Record<string, Readonly<Record<string, WhatIfValue>>>>,
  eventIds: readonly string[],
): TableRow[] {
  const seen = new Set(listed.map(rowKeyOf));
  const unlisted = [ANY_EVENT, ...eventIds]
    .filter((key) => values[key] !== undefined)
    .flatMap((key): TableRow[] => Object.keys(values[key]).map((variable) => ({ variable, event: key === ANY_EVENT ? null : key })))
    .filter((row) => !seen.has(rowKeyOf(row)));
  return [...listed, ...unlisted];
}

/** The row to explore once `removed` is gone: the first other row whose variable is a field, or undefined. Worked out before the removal. */
export function nextExploredRow(rows: readonly TableRow[], removed: TableRow, isField: (variable: string) => boolean): TableRow | undefined {
  return rows.find((other) => rowKeyOf(other) !== rowKeyOf(removed) && isField(other.variable));
}

/** Smart variables the project's logic uses, first seen first, without the ones that follow from the event (they are not offered). */
const DERIVED_SMART = new Set(['event-name', 'event-label', 'arm-number', 'arm-label']);
export function smartVariableNames(model: ModelBase): string[] {
  const found = new Set<string>();
  model.smartDeps.forEach((deps) => deps.forEach((dep) => dep.smart.forEach((name) => { if (!DERIVED_SMART.has(name)) found.add(name); })));
  return [...found];
}

/** One entry of the chooser's dropdown: a field, or a smart variable. */
export type ChooserMatch = { variable: string; smart: boolean; text: string };

/**
 * The chooser's entries for a query: fields whose variable or label contains it (case-insensitive, trimmed; at most `limit`),
 * then the smart variables that contain it. An empty query matches nothing.
 */
export function chooserMatches(
  model: ModelBase,
  query: string,
  smartNames: readonly string[],
  formLabelOf: (formId: string) => string,
  limit: number,
): ChooserMatch[] {
  const needle = query.toLowerCase().trim();
  if (!needle) return [];
  const fields = model.parsed.fields
    .filter((field) => field.variable.toLowerCase().includes(needle) || field.label.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((field): ChooserMatch => ({ variable: field.variable, smart: false, text: field.variable + ' — ' + field.label + ' (' + formLabelOf(field.form) + ')' }));
  const smarts = smartNames
    .filter((name) => name.toLowerCase().includes(needle))
    .map((name): ChooserMatch => ({ variable: smartKey(name), smart: true, text: smartKey(name) + ' — smart variable' }));
  return [...fields, ...smarts];
}

/** The logic that decides whether a field or form is shown, in the event it is judged in: branching logic and the action tags that can hide a field, the display rules of a form. */
export function computeVisibilityLogic(model: ModelBase, id: string, event: string | null): { main: string[]; note: string } {
  const node = model.formNodes.get(id);
  if (node) {
    const rules = node.logic.filter((_rule, index) => {
      const events = node.logicEvents[index] ?? [];
      return event === null || events.length === 0 || events.includes(event);
    });
    return { main: rules, note: '' };
  }
  const field = model.byVar.get(id);
  const annotation = field?.annotation || '';
  return { main: field?.branching.trim() ? [field.branching.trim()] : [], note: /@(HIDDEN|IF)\b/i.test(annotation) ? annotation.trim() : '' };
}

/** The distinct values of a key, in first-seen order, without undefined and null. */
export const distinctOf = <Key extends string>(values: readonly (Key | undefined | null)[]): Key[] => [...new Set(values.filter((value): value is Key => value !== undefined && value !== null))];

/** The fields a visibility table filters on. */
export interface VisibilityFilterable { state: Visibility; event: string | null; formId: string | undefined }
/** The filters: state 'all' / event '' / form '' each leave that column unfiltered. */
export interface VisibilityFilters { state: 'all' | Visibility; event: string; form: string }

export function filterVisibilityRows<Row extends VisibilityFilterable>(rows: readonly Row[], filters: VisibilityFilters): Row[] {
  return rows.filter((row) =>
    (filters.state === 'all' || row.state === filters.state) &&
    (filters.event === '' || row.event === filters.event) &&
    (filters.form === '' || row.formId === filters.form));
}

/** How many rows are in a state. */
export function countByState(rows: readonly { state: Visibility }[], state: Visibility): number {
  return rows.filter((row) => row.state === state).length;
}
