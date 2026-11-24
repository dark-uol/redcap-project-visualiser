import { describe, expect, it } from 'vitest';
import { withFlags } from '../src/lib/flags';

describe('withFlags', () => {
  it('sets every given id and keeps the other keys', () => {
    expect(withFlags({ a: true, b: true, c: false }, ['a', 'c'], false)).toEqual({ a: false, b: true, c: false });
  });

  it('overrides an existing value', () => {
    expect(withFlags({ a: false }, ['a'], true)).toEqual({ a: true });
  });

  it('adds keys that were absent', () => {
    expect(withFlags({ a: true }, ['b'], false)).toEqual({ a: true, b: false });
  });

  it('does not mutate the input record', () => {
    const current = { a: true, b: true };
    const next = withFlags(current, ['a'], false);
    expect(current).toEqual({ a: true, b: true });
    expect(next).not.toBe(current);
  });

  it('returns an equal copy when ids is empty', () => {
    const current = { a: true };
    const next = withFlags(current, [], false);
    expect(next).toEqual({ a: true });
    expect(next).not.toBe(current);
  });

  it('works from an empty record, as used for the "all / none" event toggles', () => {
    expect(withFlags({}, ['e1', 'e2'], true)).toEqual({ e1: true, e2: true });
  });

  it('adds only the listed ids as new keys', () => {
    expect(Object.keys(withFlags({ a: true }, ['b'], true))).toEqual(['a', 'b']);
  });
});
