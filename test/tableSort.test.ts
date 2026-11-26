import { describe, expect, it } from 'vitest';
import { nextSort, sortRows } from '../src/lib/tableSort';

type Row = { name: string; count: number };
const valueOf = (row: Row, key: 'name' | 'count'): string | number => row[key];
const rows: Row[] = [{ name: 'b10', count: 2 }, { name: 'a', count: 10 }, { name: 'b2', count: 2 }];

describe('sortRows', () => {
  it('keeps the original order without a sort, and never mutates the input', () => {
    expect(sortRows(rows, undefined, valueOf)).toEqual(rows);
    sortRows(rows, { key: 'count', direction: 'asc' }, valueOf);
    expect(rows[0].name).toBe('b10');
  });

  it('sorts numbers numerically, ties keeping their original order', () => {
    expect(sortRows(rows, { key: 'count', direction: 'asc' }, valueOf).map((r) => r.name)).toEqual(['b10', 'b2', 'a']);
    expect(sortRows(rows, { key: 'count', direction: 'desc' }, valueOf).map((r) => r.name)).toEqual(['a', 'b10', 'b2']);
  });

  it('sorts text naturally and case-insensitively', () => {
    expect(sortRows(rows, { key: 'name', direction: 'asc' }, valueOf).map((r) => r.name)).toEqual(['a', 'b2', 'b10']);
    expect(sortRows(rows, { key: 'name', direction: 'desc' }, valueOf).map((r) => r.name)).toEqual(['b10', 'b2', 'a']);
  });
});

describe('nextSort', () => {
  it('starts ascending, flips on the same column, resets on another', () => {
    const first = nextSort(undefined, 'name');
    expect(first).toEqual({ key: 'name', direction: 'asc' });
    const second = nextSort(first, 'name');
    expect(second).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort(second, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSort(second, 'count')).toEqual({ key: 'count', direction: 'asc' });
  });
});
