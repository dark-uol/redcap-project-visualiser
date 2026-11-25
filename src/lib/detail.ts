/* What the detail panel lists for a form, an event or a form-to-form link: the edges and fields behind it. Pure: no Solid, no DOM. */

import { formIsRepeating, nodeInfo } from './graph';
import type { Edge, Form, Model, ModelBase, ParsedODM } from './types';

/** The part of the view options that decides which edges are listed. */
export interface EdgeFilter {
  types: ReadonlySet<string>;
  showMissing: boolean;
}

/** Whether the options let this edge appear. */
export const edgePasses = (filter: EdgeFilter, edge: Edge): boolean => filter.types.has(edge.type) && (filter.showMissing || !edge.missing);

/** The fields of a form that have a visible dependency in either direction (none when the form is unknown). */
export function linkedFieldsOf(model: ModelBase, filter: EdgeFilter, formId: string): string[] {
  const form = model.formsById.get(formId);
  if (!form) return [];
  const linked = new Set<string>();
  model.edges.forEach((edge) => { if (edgePasses(filter, edge)) { linked.add(edge.from); linked.add(edge.to); } });
  return form.fields.filter((variable) => linked.has(variable));
}

/** Edges with exactly one end in the form (the other end is in another form or is undefined), logic-source edges excluded. */
export function crossFormEdges(model: ModelBase, formId: string): Edge[] {
  return model.edges.filter((edge) =>
    !edge.missing && edge.type !== 'logicsrc' && (nodeInfo(model, edge.from).form === formId) !== (nodeInfo(model, edge.to).form === formId));
}

/** The labels of the events a form repeats in, joined with commas ('' when none). */
export function repeatingEventLabels(parsed: ParsedODM, formId: string): string {
  const events = (parsed.repeatingInstruments || []).filter((instrument) => instrument.form === formId).map((instrument) => instrument.event);
  return [...new Set(events)].map((id) => ((parsed.events || []).find((event) => event.id === id) || { label: id }).label).join(', ');
}

/** ' · repeating', plus ' in <events>' when it repeats only in some, or '' for a form that does not repeat. */
export function repeatingNote(parsed: ParsedODM, form: Form): string {
  if (!formIsRepeating(parsed, form)) return '';
  const where = repeatingEventLabels(parsed, form.id);
  return ' · repeating' + (where ? ' in ' + where : '');
}

/** The edges whose logic runs in the event (`readFromEvent`), and the edges into the event's forms that read from other events (`readsOtherEvents`). */
export function eventEdges(model: Model, eventId: string): { readFromEvent: Edge[]; readsOtherEvents: Edge[] } {
  const readFromEvent = model.edges.filter((edge) => (edge.events || []).includes(eventId));
  const readsOtherEvents = model.edges.filter((edge) =>
    model.parsed.events.some((event) => event.forms.includes(nodeInfo(model, edge.to).form) && event.id === eventId) &&
    (edge.events || []).some((event) => event !== eventId));
  return { readFromEvent, readsOtherEvents };
}

/** A form-level link: the fields that make it up. */
export interface FormLink {
  /** How many distinct source fields (in the `from` form) feed it. */
  sourceCount: number;
  /** The dependent fields in the `to` form, each with the edges that make it depend on the source form, in first-seen order. */
  dependents: { dependent: string; edges: Edge[] }[];
  /** How many edges make up the link. */
  dependencyCount: number;
}

/** The edges from fields of form `from` to fields of form `to` that the options show, grouped by dependent field. */
export function formLink(model: ModelBase, filter: EdgeFilter, from: string, to: string): FormLink {
  const edges = model.edges.filter((edge) => edgePasses(filter, edge) && nodeInfo(model, edge.from).form === from && nodeInfo(model, edge.to).form === to);
  const byDependent = new Map<string, Edge[]>();
  edges.forEach((edge) => {
    const group = byDependent.get(edge.to);
    if (group) group.push(edge); else byDependent.set(edge.to, [edge]);
  });
  return {
    sourceCount: new Set(edges.map((edge) => edge.from)).size,
    dependents: [...byDependent.entries()].map(([dependent, group]) => ({ dependent, edges: group })),
    dependencyCount: edges.length,
  };
}
