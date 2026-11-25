import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel, nodeInfo } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import { edgeSearchText, fieldSearchText, filterEdges, matchesQuery } from '../src/lib/tableFilters';
import type { Edge, Field, Model } from '../src/lib/types';

const model: Model = buildModel(parseODM(sampleXml));

const fieldNamed = (variable: string): Field => model.parsed.fields.find((f) => f.variable === variable)!;
const edgeFrom = (from: string, to: string): Edge => model.edges.find((e) => e.from === from && e.to === to)!;
const allTypes = new Set(model.edges.map((e) => e.type));

describe('fieldSearchText', () => {
  it('joins the variable, form, type and label in lowercase', () => {
    expect(fieldSearchText(fieldNamed('record_id'))).toBe('record_id demographics text record id');
  });
});

describe('matchesQuery on fields', () => {
  it('matches by variable', () => {
    expect(matchesQuery(fieldSearchText(fieldNamed('first_name')), 'first_name')).toBe(true);
  });

  it('matches by label, ignoring case and surrounding spaces', () => {
    const text = fieldSearchText(fieldNamed('dob'));
    expect(matchesQuery(text, 'Date of Birth')).toBe(true);
    expect(matchesQuery(text, '   date of birth  ')).toBe(true);
  });

  it('matches by form id', () => {
    expect(matchesQuery(fieldSearchText(fieldNamed('sc_date')), 'SCREENING')).toBe(true);
    expect(matchesQuery(fieldSearchText(fieldNamed('sc_date')), 'followup')).toBe(false);
  });

  it('matches by type', () => {
    expect(matchesQuery(fieldSearchText(fieldNamed('pregnant')), 'yesno')).toBe(true);
    expect(matchesQuery(fieldSearchText(fieldNamed('sex')), 'yesno')).toBe(false);
  });

  it('matches every field when the query is empty or only spaces', () => {
    for (const field of model.parsed.fields) {
      expect(matchesQuery(fieldSearchText(field), '')).toBe(true);
      expect(matchesQuery(fieldSearchText(field), '   ')).toBe(true);
    }
  });

  it('matches no field for a query nothing contains', () => {
    expect(model.parsed.fields.some((f) => matchesQuery(fieldSearchText(f), 'no-such-thing-xyz'))).toBe(false);
  });
});

describe('edgeSearchText', () => {
  it('includes both ends, their forms, the type and the expression', () => {
    const text = edgeSearchText(model, edgeFrom('dob', 'age'));
    expect(text).toBe(`dob age calc demographics baseline rounddown(datediff([dob], [visit_date], "y", true))`);
  });

  it('names the unknown form for an undefined end', () => {
    expect(edgeSearchText(model, edgeFrom('smoking_status', 'risk_b'))).toContain('(unknown)');
  });
});

describe('filterEdges', () => {
  const everything = { types: allTypes, showMissing: true };

  it('matches an edge by its from, to, type, form and expression text', () => {
    const cases: [string, Edge][] = [
      ['smoking_status', edgeFrom('smoking_status', 'risk_b')],
      ['risk_a', edgeFrom('risk_a', 'risk_b')],
      ['actiontag', edgeFrom('bmi', 'bmi_cat')],
      ['followup', edgeFrom('consent', 'partner_note')],
      ['rounddown', edgeFrom('dob', 'age')],
    ];
    for (const [query, edge] of cases) {
      expect(filterEdges(model, everything, query)).toContain(edge);
    }
  });

  it('matches case-insensitively and ignores surrounding spaces', () => {
    expect(filterEdges(model, everything, '  ROUNDDOWN ')).toEqual(filterEdges(model, everything, 'rounddown'));
  });

  it('returns every edge the filter admits for an empty query, in model order', () => {
    expect(filterEdges(model, everything, '')).toEqual(model.edges);
  });

  it('keeps only the selected types', () => {
    const calcOnly = filterEdges(model, { types: new Set(['calc']), showMissing: true }, '');
    expect(calcOnly.length).toBeGreaterThan(0);
    expect(calcOnly.every((e) => e.type === 'calc')).toBe(true);
    expect(calcOnly).toEqual(model.edges.filter((e) => e.type === 'calc'));
  });

  it('drops missing edges unless showMissing is set', () => {
    const missing = model.edges.filter((e) => e.missing);
    expect(missing.length).toBeGreaterThan(0);
    const hidden = filterEdges(model, { types: allTypes, showMissing: false }, '');
    expect(hidden.some((e) => e.missing)).toBe(false);
    expect(hidden).toEqual(model.edges.filter((e) => !e.missing));
    expect(filterEdges(model, everything, '').filter((e) => e.missing)).toEqual(missing);
  });

  it('keeps the model order', () => {
    const result = filterEdges(model, everything, 'calc');
    const positions = result.map((e) => model.edges.indexOf(e));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('returns only the edges whose text matches the query', () => {
    const result = filterEdges(model, everything, 'rounddown');
    expect(result.map((e) => e.from)).toEqual(['dob', 'visit_date']);
    expect(result.every((e) => nodeInfo(model, e.to).form === 'baseline')).toBe(true);
  });

  it('returns an empty list for a query nothing matches', () => {
    expect(filterEdges(model, everything, 'zzz-no-such-thing')).toEqual([]);
  });
});
