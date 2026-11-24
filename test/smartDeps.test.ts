import { describe, expect, it } from 'vitest';
import { buildModel, buildView } from '../src/lib/graph';
import type { DepType, Field, Form, ParsedODM, ViewOptions } from '../src/lib/types';

const field = (variable: string, form: string, over: Partial<Field> = {}): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form, ...over,
});

const form = (id: string, fields: string[]): Form => ({ id, label: id, repeating: false, fields });

/** form1: `a` (no logic), `b` (branching on [event-name] only), `c` (branching on [x] plus [event-name]), `x`, `d` (no logic). */
const parsed = (): ParsedODM => ({
  projectName: 'test',
  redcapVersion: '0',
  forms: [form('form1', ['a', 'b', 'c', 'x', 'd'])],
  fields: [
    field('a', 'form1'),
    field('b', 'form1', { branching: "[event-name] = 'baseline_arm_1'" }),
    field('c', 'form1', { branching: "[x] = 1 and [event-name] = 'baseline_arm_1'" }),
    field('x', 'form1'),
    field('d', 'form1'),
  ],
  formLogic: [],
  logicSources: [],
  events: [],
  arms: [],
  repeatingInstruments: [],
});

const ALL_TYPES: DepType[] = ['branching', 'calc', 'piping', 'actiontag', 'formlogic', 'logicsrc'];

const options = (types: DepType[], over: Partial<ViewOptions> = {}): ViewOptions => ({
  level: 'field', eventSet: null, types: new Set(types), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, explore: null, pair: null, focus: '', focusDir: 'both', focusDepth: 1,
  showMissing: false, hideIsolated: true, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'label', group: false, groupBy: 'none', edgeLabels: false, ...over,
});

describe('event and context smart variables keep fields visible', () => {
  const model = buildModel(parsed());

  it('records the context smart variables per field, with their type', () => {
    expect(model.smartDeps.get('b')).toEqual([{ type: 'branching', smart: ['event-name'] }]);
    expect(model.smartDeps.get('c')).toEqual([{ type: 'branching', smart: ['event-name'] }]);
    expect(model.smartDeps.has('a')).toBe(false);
  });

  it('keeps a smart-only branching field with hideIsolated and shows the smart suffix', () => {
    const view = buildView(model, options(ALL_TYPES));
    const b = view.nodes.find((n) => n.id === 'b');
    expect(b).toBeDefined();
    expect(b?.sub).toBe('b · [event-name]');
    expect(b?.smart).toEqual(['event-name']);
    expect(view.nodes.some((n) => n.id === 'a')).toBe(false);
    expect(view.nodes.some((n) => n.id === 'd')).toBe(false);
  });

  it('hides the smart-only field when its dependency type is disabled', () => {
    const view = buildView(model, options(['calc', 'piping', 'actiontag', 'formlogic', 'logicsrc']));
    expect(view.nodes.some((n) => n.id === 'b')).toBe(false);
  });

  it('adds the smart suffix to a field that also has normal references', () => {
    const view = buildView(model, options(ALL_TYPES));
    const c = view.nodes.find((n) => n.id === 'c');
    expect(c?.sub).toBe('c · [event-name]');
    expect(view.edges.some((e) => e.from === 'x' && e.to === 'c')).toBe(true);
  });

  it('hides a field whose only logic is a disabled type, even when it has normal references', () => {
    const view = buildView(model, options(['calc', 'piping', 'actiontag', 'formlogic', 'logicsrc']));
    expect(view.nodes.find((n) => n.id === 'c')).toBeUndefined();
  });

  it('still hides a field with no logic', () => {
    const view = buildView(model, options(ALL_TYPES));
    expect(view.nodes.some((n) => n.id === 'd')).toBe(false);
  });
});
