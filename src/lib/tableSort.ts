/* Column sorting for the table tabs. Pure. */

export type SortDirection = 'asc' | 'desc';
export type Sort<Key extends string> = { key: Key; direction: SortDirection };

/** Next sort when a column header is clicked: a new column sorts ascending, the same column flips direction. */
export function nextSort<Key extends string>(current: Sort<Key> | undefined, key: Key): Sort<Key> {
  return current?.key === key && current.direction === 'asc' ? { key, direction: 'desc' } : { key, direction: 'asc' };
}

/** A sorted copy of `rows`; numbers compare numerically, text case-insensitively and naturally. Ties keep their original order. */
export function sortRows<Row, Key extends string>(rows: readonly Row[], sort: Sort<Key> | undefined, valueOf: (row: Row, key: Key) => string | number): Row[] {
  if (!sort) return [...rows];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, sort.key) }))
    .sort((a, b) => {
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: 'base' });
      return order * sign || a.index - b.index;
    })
    .map((entry) => entry.row);
}
