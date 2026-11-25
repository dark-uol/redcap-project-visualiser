/* The search and filter rules behind the Fields and Dependencies tables. Pure: no Solid, no DOM, no store. */

import { nodeInfo } from './graph';
import { edgePasses, type EdgeFilter } from './detail';
import type { Edge, Field, ModelBase } from './types';

/** The lowercase text a field's query is matched against: variable, form id, type and label. */
export const fieldSearchText = (field: Field): string => [field.variable, field.form, field.type, field.label].join(' ').toLowerCase();

/** Whether a search text matches a query. The query is trimmed and lowercased here; an empty query matches everything. */
export function matchesQuery(searchText: string, query: string): boolean {
  const normalised = query.toLowerCase().trim();
  return !normalised || searchText.includes(normalised);
}

/** The lowercase text an edge's query is matched against: both ends, their forms, the type and the expression. */
export function edgeSearchText(model: ModelBase, edge: Edge): string {
  return [edge.from, edge.to, edge.type, nodeInfo(model, edge.from).form, nodeInfo(model, edge.to).form, edge.expr].join(' ').toLowerCase();
}

/** The edges the filter lets through and the query matches, in model order. */
export function filterEdges(model: ModelBase, filter: EdgeFilter, query: string): Edge[] {
  const normalised = query.toLowerCase().trim();
  return model.edges.filter((edge) => edgePasses(filter, edge) && (!normalised || matchesQuery(edgeSearchText(model, edge), normalised)));
}
