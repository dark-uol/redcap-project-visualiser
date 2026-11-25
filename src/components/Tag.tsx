import { TYPES } from '../lib/graph';
import type { DepType } from '../lib/types';

/** Presentational: a coloured badge naming a dependency type. */
export function Tag(props: { type: DepType }) {
  return <span class="tag" style={`background:${TYPES[props.type].color}`}>{props.type}</span>;
}
