import { describe, expect, it } from 'vitest';
import { buildModel, buildView } from '../src/lib/graph';
import type { DepType, Field, ParsedODM, ViewOptions } from '../src/lib/types';

const ALL_TYPES: DepType[] = ['branching', 'calc', 'piping', 'actiontag', 'formlogic', 'logicsrc'];

const field = (variable: string, form: string, branching = ''): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching, calc: '', annotation: '',
  required: false, choices: [], form,
});

// source -> middle -> last, plus an unrelated pair other -> reader (form_a feeds form_b)
const parsed: ParsedODM = {
  projectName: 't', redcapVersion: '0',
  forms: [{ id: 'form_a', label: 'Form A', repeating: false, fields: ['source', 'other'] }, { id: 'form_b', label: 'Form B', repeating: false, fields: ['middle', 'last', 'reader'] }],
  fields: [
    field('source', 'form_a'), field('other', 'form_a'), field('middle', 'form_b', "[source] = '1'"),
    field('last', 'form_b', "[middle] = '1'"), field('reader', 'form_b', "[other] = '1'"),
  ],
  formLogic: [], logicSources: [], events: [], arms: [], repeatingInstruments: [],
};
const model = buildModel(parsed);

const options = (over: Partial<ViewOptions> = {}): ViewOptions => ({
  level: 'form', eventSet: null, types: new Set(ALL_TYPES), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both', focusDepth: 10,
  showMissing: false, hideIsolated: true, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'label', group: false, groupBy: 'none', edgeLabels: false, ...over,
});

describe('focus on a field at form level', () => {
  it('keeps the form graph but counts only the links of the chain', () => {
    const plain = buildView(model, options());
    const focused = buildView(model, options({ focus: 'source', focusDir: 'down' }));
    expect(focused.level).toBe('form');
    expect(plain.edges[0].count).toBe(2); // middle and reader
    expect(focused.edges).toHaveLength(1);
    expect(focused.edges[0].count).toBe(1); // middle only
  });

  it('keeps expanded forms open, listing only the fields of the chain and marking the focused one', () => {
    const view = buildView(model, options({ focus: 'source', focusDir: 'down', expanded: new Set(['form_a', 'form_b']) }));
    expect(view.mixed).toBe(true);
    expect(view.nodes.map((n) => n.id).sort()).toEqual(['last', 'middle', 'source']);
    expect(view.nodes.find((n) => n.id === 'source')?.focus).toBe(true);
    expect(view.edges.map((e) => [e.from, e.to]).sort()).toEqual([['middle', 'last'], ['source', 'middle']]);
  });

  it('reports how many fields a small depth hides', () => {
    expect(buildView(model, options({ focus: 'source', focusDir: 'down', focusDepth: 1 })).focusHidden).toBe(1);
    expect(buildView(model, options({ focus: 'source', focusDir: 'down' })).focusHidden).toBeUndefined();
  });

  it('ignores a focus that names no field', () => {
    expect(buildView(model, options({ focus: 'nope' })).edges[0].count).toBe(2);
  });
});

describe('focus on a form', () => {
  it('shows the chains through the form\'s linked fields at field level', () => {
    const view = buildView(model, options({ level: 'field', focus: 'form_a', focusDir: 'down', focusDepth: 1 }));
    // source and other are the linked fields of form_a; one step down reaches middle and reader
    expect(view.nodes.map((n) => n.id).sort()).toEqual(['middle', 'other', 'reader', 'source']);
    expect(view.focusHidden).toBe(1); // last lies beyond depth 1
  });

  it('keeps the form graph at form level, counting only the chain\'s links', () => {
    const view = buildView(model, options({ focus: 'form_b', focusDir: 'up', focusDepth: 1 }));
    expect(view.level).toBe('form');
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0].count).toBe(2); // source -> middle, other -> reader
  });

  it('shows nothing for a form with no links', () => {
    const lonely: ParsedODM = { ...parsed, forms: [...parsed.forms, { id: 'form_c', label: 'Form C', repeating: false, fields: [] }] };
    const view = buildView(buildModel(lonely), options({ level: 'field', focus: 'form_c' }));
    expect(view.nodes).toHaveLength(0);
  });
});
