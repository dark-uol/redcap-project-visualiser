import { describe, expect, it } from 'vitest';
import { resolveExploreTarget } from '../src/lib/exploreTarget';
import type { ExploreContext } from '../src/lib/exploreTarget';

const FORM_IDS = ['f1', 'f2'];
const FIELD_FORMS: Record<string, string> = { age: 'f1', weight: 'f2', orphan: undefined as unknown as string };

function context(over: Partial<ExploreContext> = {}): ExploreContext {
  return {
    level: 'field',
    instanceMode: false,
    isFormId: (id) => FORM_IDS.includes(id),
    formOf: (id) => FIELD_FORMS[id],
    instanceNodes: [],
    ...over,
  };
}

describe('resolveExploreTarget at field level', () => {
  it('targets a field itself and offers its whole form', () => {
    expect(resolveExploreTarget(context(), 'age')).toEqual({
      kind: 'field', target: 'age', isGroup: false, wholeFormId: 'f1', appliesTo: null,
    });
  });

  it('targets a form box with no node buttons and the form of its id', () => {
    expect(resolveExploreTarget(context(), '@form:f2')).toEqual({
      kind: 'field', target: '@form:f2', isGroup: true, wholeFormId: 'f2', appliesTo: null,
    });
  });

  it('drops the whole-form buttons when the field has no form', () => {
    expect(resolveExploreTarget(context(), 'orphan')).toMatchObject({ kind: 'field', wholeFormId: null });
  });

  it('targets an unknown id as given, with no form to offer', () => {
    expect(resolveExploreTarget(context(), 'age@@1')).toMatchObject({ kind: 'field', target: 'age@@1', wholeFormId: null });
  });

  it('is empty for a plain id that has no form and no node', () => {
    expect(resolveExploreTarget(context(), 'unknown')).toEqual({ kind: 'field', target: 'unknown', isGroup: false, wholeFormId: null, appliesTo: null });
  });
});

describe('resolveExploreTarget at form level', () => {
  const formLevel = (over: Partial<ExploreContext> = {}) => context({ level: 'form', ...over });

  it('targets a form id itself and offers no whole-form buttons', () => {
    expect(resolveExploreTarget(formLevel(), 'f1')).toEqual({
      kind: 'field', target: 'f1', isGroup: false, wholeFormId: null, appliesTo: null,
    });
  });

  it('retargets a field to its form and says so', () => {
    expect(resolveExploreTarget(formLevel(), 'age')).toEqual({
      kind: 'field', target: 'f1', isGroup: false, wholeFormId: null, appliesTo: 'f1',
    });
  });

  it('targets the undefined-fields pseudo node itself', () => {
    expect(resolveExploreTarget(formLevel(), '(unknown)')).toMatchObject({ kind: 'field', target: '(unknown)', appliesTo: null });
  });

  it('gives nothing when a field at form level has no form', () => {
    expect(resolveExploreTarget(formLevel(), 'orphan')).toEqual({ kind: 'none' });
  });
});

describe('resolveExploreTarget in instance mode', () => {
  const nodes = [
    { id: 'f1@e1', form: 'f1' },
    { id: 'f1@e2', form: 'f1' },
    { id: 'f2@e1', form: 'f2' },
  ];
  const instance = (over: Partial<ExploreContext> = {}) => context({ instanceMode: true, level: 'form', instanceNodes: nodes, ...over });

  it('targets an instance node itself', () => {
    expect(resolveExploreTarget(instance(), 'f1@e1')).toEqual({ kind: 'instance', target: 'f1@e1', appliesTo: null });
  });

  it('resolves a field whose form has a single instance node to that node and says so', () => {
    expect(resolveExploreTarget(instance(), 'weight')).toEqual({ kind: 'instance', target: 'f2@e1', appliesTo: 'f2@e1' });
  });

  it('finds no instance for a bare form id, which has no owning form', () => {
    expect(resolveExploreTarget(instance(), 'f2')).toEqual({ kind: 'hint', message: '' });
  });

  it('resolves a form box to its single instance node', () => {
    expect(resolveExploreTarget(instance(), '@form:f2')).toEqual({ kind: 'instance', target: 'f2@e1', appliesTo: 'f2@e1' });
  });

  it('resolves a field to the instance node of its form', () => {
    expect(resolveExploreTarget(instance(), 'age')).toEqual({ kind: 'hint', message: "Select one of this form's instance nodes to expand its references." });
  });

  it('asks for a choice when the form has several instance nodes', () => {
    expect(resolveExploreTarget(instance({ formOf: () => 'f1' }), 'f1')).toEqual({
      kind: 'hint', message: "Select one of this form's instance nodes to expand its references.",
    });
  });

  it('gives an empty hint when the form has no instance node', () => {
    expect(resolveExploreTarget(instance(), 'nothing')).toEqual({ kind: 'hint', message: '' });
  });

  it('ignores the form level and the whole-form buttons in instance mode', () => {
    expect(resolveExploreTarget(instance({ level: 'field' }), 'f1@e2')).toEqual({ kind: 'instance', target: 'f1@e2', appliesTo: null });
  });
});
