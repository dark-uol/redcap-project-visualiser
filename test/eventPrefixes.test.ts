import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/lib/graph';
import type { Edge, EventDef, Field, Form, ParsedODM } from '../src/lib/types';

const field = (variable: string, form: string, branching = ''): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching, calc: '', annotation: '',
  required: false, choices: [], form,
});

const event = (id: string): EventDef => ({ id, label: id, arm: '1', armName: 'Arm 1', repeating: false, forms: [] });

const form = (id: string, fields: string[]): Form => ({ id, label: id, repeating: false, fields });

/** Two events, two forms; `z` branches on `[evt_a][x]`, form logic and an alert reference the same event prefix. */
const parsed = (): ParsedODM => ({
  projectName: 'test',
  redcapVersion: '0',
  forms: [form('form1', ['x', 'y']), form('form2', ['z'])],
  fields: [
    field('x', 'form1'),
    field('y', 'form1'),
    field('z', 'form2', '[evt_a][x] = 1'),
  ],
  formLogic: [{
    logic: '[evt_a][x] = 1',
    forms: ['form2'],
    formEvents: [{ event: 'evt_a', form: 'form2' }],
  }],
  logicSources: [{
    id: 'alert-1',
    kind: 'alert',
    label: 'Alert 1',
    logic: '[evt_a][x] = 1',
    refs: ['evt_a', 'x'],
  }],
  events: [event('evt_a'), event('evt_b')],
  arms: [],
  repeatingInstruments: [],
});

const edgeTo = (edges: Edge[], to: string, type: Edge['type']): Edge | undefined =>
  edges.find((e) => e.from === 'x' && e.to === to && e.type === type);

describe('event prefixes on dependency edges', () => {
  const model = buildModel(parsed());

  it('records the event on a field branching edge', () => {
    const edge = edgeTo(model.edges, 'z', 'branching');
    expect(edge).toBeDefined();
    expect(edge?.events).toContain('evt_a');
  });

  it('records the event on a form display logic edge', () => {
    const edge = edgeTo(model.edges, 'form:form2', 'formlogic');
    expect(edge).toBeDefined();
    expect(edge?.events).toContain('evt_a');
    expect(edge?.tgtEvents).toEqual(['evt_a']);
  });

  it('records the event on a logic source edge', () => {
    const edge = edgeTo(model.edges, 'logic:alert-1', 'logicsrc');
    expect(edge).toBeDefined();
    expect(edge?.events).toContain('evt_a');
  });

  it('does not attribute an event to a token it does not directly prefix', () => {
    const plain = buildModel({ ...parsed(), logicSources: [{ id: 'alert-2', kind: 'alert', label: 'A', logic: '[x] = 1', refs: ['x'] }] });
    expect(edgeTo(plain.edges, 'logic:alert-2', 'logicsrc')?.events).toBeUndefined();
  });
});
