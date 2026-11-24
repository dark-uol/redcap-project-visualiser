import { describe, expect, it } from 'vitest';
import { extractEmbeds } from '../src/lib/parser';

describe('extractEmbeds', () => {
  it('returns a plain token with empty mod', () => {
    expect(extractEmbeds('Pain: {pain_score}')).toEqual([{ name: 'pain_score', mod: '' }]);
  });

  it('returns the modifier when present', () => {
    expect(extractEmbeds('Rating {pain_score:icons}')).toEqual([{ name: 'pain_score', mod: 'icons' }]);
  });

  it('returns several tokens in order and keeps duplicates', () => {
    expect(extractEmbeds('{b} then {a:icons} then {b}')).toEqual([
      { name: 'b', mod: '' },
      { name: 'a', mod: 'icons' },
      { name: 'b', mod: '' },
    ]);
  });

  it('finds tokens in mixed label text', () => {
    expect(extractEmbeds('Please rate {q1:icons} how you feel (see note {q2}).')).toEqual([
      { name: 'q1', mod: 'icons' },
      { name: 'q2', mod: '' },
    ]);
  });

  it('ignores square-bracket piping tokens', () => {
    expect(extractEmbeds('Value is [a] and {b}')).toEqual([{ name: 'b', mod: '' }]);
    expect(extractEmbeds('[a:icons]')).toEqual([]);
  });

  it('ignores invalid shapes', () => {
    expect(extractEmbeds('{}')).toEqual([]);
    expect(extractEmbeds('{1abc}')).toEqual([]);
    expect(extractEmbeds('{a b}')).toEqual([]);
    expect(extractEmbeds('{a-b}')).toEqual([]);
    expect(extractEmbeds('{a')).toEqual([]);
    expect(extractEmbeds('{ a}')).toEqual([]);
    expect(extractEmbeds('{a:}')).toEqual([]);
    expect(extractEmbeds('{a:b-c}')).toEqual([]);
  });

  it('yields only the inner token for nested braces', () => {
    expect(extractEmbeds('{{a}}')).toEqual([{ name: 'a', mod: '' }]);
  });

  it('returns an empty array for null, undefined and empty input', () => {
    expect(extractEmbeds(null)).toEqual([]);
    expect(extractEmbeds(undefined)).toEqual([]);
    expect(extractEmbeds('')).toEqual([]);
  });
});
