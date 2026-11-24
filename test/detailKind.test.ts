import { describe, expect, it } from 'vitest';
import { classifyDetail } from '../src/lib/detailKind';
import type { DetailFacts } from '../src/lib/detailKind';
import { parseSelection } from '../src/lib/selection';
import type { NodeInfo, EventDef, Form, ViewNode } from '../src/lib/types';

const none: DetailFacts = { node: undefined, instanceNode: undefined, event: undefined, form: undefined };
const field = { variable: 'age', form: 'f1' } as NodeInfo;
const formNode = { variable: 'f1', form: 'f1', formNode: true, logic: [], logicEvents: [] } as unknown as NodeInfo;
const logicNode = { variable: 'calc1', form: 'f1', logicNode: true, kind: 'calc', logic: '' } as unknown as NodeInfo;
const ghost = { variable: 'missing1', form: '(unknown)', ghost: true } as unknown as NodeInfo;
const event = { id: 'visit_1', label: 'Visit 1' } as EventDef;
const form = { id: 'f1', label: 'Form 1' } as Form;
const instanceNode = { id: 'f1@visit_1', form: 'f1' } as ViewNode;

/** Classify a raw selected id against a fixed table of facts keyed by id. */
function classifyWith(selectedId: string, table: Record<string, DetailFacts>) {
  return classifyDetail(parseSelection(selectedId), (id) => table[id] ?? none);
}

describe('classifyDetail', () => {
  it('classifies a form box without looking anything up', () => {
    expect(classifyWith('@form:f1', {})).toEqual({ kind: 'group', formId: 'f1' });
  });

  it('classifies a field', () => {
    expect(classifyWith('age', { age: { ...none, node: field } })).toMatchObject({ kind: 'field', id: 'age', instanceId: undefined });
  });

  it('classifies form display logic, logic sources and ghosts from their node markers', () => {
    expect(classifyWith('f1', { f1: { ...none, node: formNode } })).toMatchObject({ kind: 'formDisplayLogic' });
    expect(classifyWith('calc1', { calc1: { ...none, node: logicNode } })).toMatchObject({ kind: 'logicSource' });
    expect(classifyWith('missing1', { missing1: { ...none, node: ghost } })).toMatchObject({ kind: 'ghost' });
  });

  it('classifies the undefined-fields pseudo node by its id', () => {
    expect(classifyWith('(unknown)', {})).toMatchObject({ kind: 'undefinedFields' });
  });

  it('classifies events and forms when there is no model node', () => {
    expect(classifyWith('visit_1', { visit_1: { ...none, event } })).toMatchObject({ kind: 'event' });
    expect(classifyWith('f1', { f1: { ...none, form } })).toMatchObject({ kind: 'form' });
  });

  it('classifies an id that matches nothing as none', () => {
    expect(classifyWith('nothing', {})).toMatchObject({ kind: 'none' });
  });

  it('classifies an Instances-view node when there is no model node', () => {
    expect(classifyWith('f1@visit_1', { 'f1@visit_1': { ...none, instanceNode } })).toMatchObject({ kind: 'instance' });
  });

  it('prefers the Instances node over an event or form of the same id', () => {
    const facts = { ...none, instanceNode, event, form };
    expect(classifyWith('f1@visit_1', { 'f1@visit_1': facts })).toMatchObject({ kind: 'instance' });
  });

  it('prefers a model node over an event, form or undefined-fields match', () => {
    expect(classifyWith('(unknown)', { '(unknown)': { ...none, node: field } })).toMatchObject({ kind: 'field' });
    expect(classifyWith('f1', { f1: { ...none, node: field, form } })).toMatchObject({ kind: 'field' });
  });

  it('prefers an event over a form of the same id', () => {
    expect(classifyWith('x', { x: { ...none, event, form } })).toMatchObject({ kind: 'event' });
  });

  it('classifies an instance-expanded field by its variable and carries the instance id', () => {
    const result = classifyWith('age@@visit_1', { age: { ...none, node: field } });
    expect(result).toMatchObject({ kind: 'field', id: 'age', instanceId: 'visit_1' });
  });

  it('classifies an instance-expanded id as a form when its variable is a form', () => {
    const result = classifyWith('f1@@visit_1', { f1: { ...none, form } });
    expect(result).toMatchObject({ kind: 'form', id: 'f1', instanceId: 'visit_1' });
  });

  it('passes the facts it looked up through unchanged', () => {
    const facts = { ...none, node: field };
    const result = classifyWith('age', { age: facts });
    expect(result.kind === 'group' ? null : result.facts).toBe(facts);
  });
});
