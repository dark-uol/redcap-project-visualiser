/**
 * Returns a copy of `current` with every id in `ids` set to `value`.
 * Keys not in `ids` are kept as they are, and the input is never mutated.
 * Absent keys are not written, so callers that treat absence as "on" keep that meaning.
 */
export function withFlags<T extends Partial<Record<string, boolean>>>(
  current: T,
  ids: readonly string[],
  value: boolean,
): T {
  const next: Partial<Record<string, boolean>> = { ...current };
  for (const id of ids) next[id] = value;
  return next as T;
}
