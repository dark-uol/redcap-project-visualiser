import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { parseODM } from '../src/lib/parser';
import { buildModel, buildView } from '../src/lib/graph';
import { resolveExploreTarget } from '../src/lib/exploreTarget';
import type { DepType, Field, ParsedODM, ViewOptions } from '../src/lib/types';

const model = buildModel(parseODM(sampleXml));
const ALL_TYPES: DepType[] = ['branching', 'calc', 'piping', 'actiontag', 'formlogic', 'logicsrc'];

const options = (over: Partial<ViewOptions> = {}): ViewOptions => ({
  level: 'event', eventSet: null, types: new Set(ALL_TYPES), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus: '', focusDir: 'both', focusDepth: 1,
  showMissing: true, hideIsolated: true, hideIsolatedNodes: true,
  dir: 'LR', labelMode: 'label', group: false, groupBy: 'none', edgeLabels: false, ...over,
});

// sample: `baseline` is collected in two events, so its nodes are `baseline@<event>`; `screening` is in one, so it keeps its plain id.
// sample: weight_kg (baseline form) is read from baseline_arm_1 by weight_change (followup form) in followup_arm_1 and followup_arm_2
const collapsed = () => buildView(model, options());

describe('event level expansion', () => {
  it('is a plain event graph when nothing is expanded', () => {
    const view = collapsed();
    expect(view.mixed).toBeUndefined();
    expect(view.groups).toEqual([]);
    expect(view.edges.every((e) => view.nodes.some((n) => n.id === e.from) && view.nodes.some((n) => n.id === e.to))).toBe(true);
  });

  it('ignores an expanded set that names no drawn event', () => {
    const view = buildView(model, options({ expandedEvents: new Set(['nope']) }));
    expect(view.mixed).toBeUndefined();
  });

  it('opens an event into a box of its linked forms', () => {
    const view = buildView(model, options({ expandedEvents: new Set(['baseline_arm_1']) }));
    expect(view.mixed).toBe(true);
    const box = view.groups.find((g) => g.id === 'baseline_arm_1');
    // plain references inside the event count too, so every form of the event is linked
    expect(box?.nodes).toEqual(['demographics@baseline_arm_1', 'baseline@baseline_arm_1', 'screening']);
    expect(view.nodes.some((n) => n.id === 'baseline_arm_1')).toBe(false);
    expect(view.nodes.find((n) => n.id === 'baseline@baseline_arm_1')).toMatchObject({ form: 'baseline', event: 'baseline_arm_1', kind: 'form' });
  });

  it('draws the edge from the form node and keeps the collapsed event as the other end', () => {
    const view = buildView(model, options({ expandedEvents: new Set(['baseline_arm_1']) }));
    expect(view.edges.some((e) => e.from === 'baseline@baseline_arm_1' && e.to === 'followup_arm_1')).toBe(true);
  });

  it('lists every form of an expanded event when isolated nodes are shown', () => {
    const view = buildView(model, options({ expandedEvents: new Set(['baseline_arm_1']), hideIsolatedNodes: false }));
    expect(view.groups.find((g) => g.id === 'baseline_arm_1')?.nodes).toEqual(['demographics@baseline_arm_1', 'baseline@baseline_arm_1', 'screening']);
  });

  it('opens a form of an expanded event into its linked fields, nested in the event box', () => {
    const view = buildView(model, options({ expandedEvents: new Set(['baseline_arm_1']), expanded: new Set(['baseline@baseline_arm_1']) }));
    const fieldBox = view.groups.find((g) => g.id === 'baseline@baseline_arm_1');
    expect(fieldBox?.parent).toBe('baseline_arm_1');
    expect(fieldBox?.nodes).toContain('weight_kg@@baseline@baseline_arm_1');
    expect(view.nodes.find((n) => n.id === 'weight_kg@@baseline@baseline_arm_1')).toMatchObject({ field: 'weight_kg', form: 'baseline', event: 'baseline_arm_1' });
    expect(view.expandedNodes?.map((n) => n.id)).toEqual(['baseline@baseline_arm_1']);
    expect(view.edges.some((e) => e.from === 'weight_kg@@baseline@baseline_arm_1' && e.to === 'followup_arm_1')).toBe(true);
  });

  it('ignores an expanded form while its event stays collapsed', () => {
    const view = buildView(model, options({ expanded: new Set(['baseline@baseline_arm_1']) }));
    expect(view.mixed).toBeUndefined();
  });

  it('marks an edge between two opened forms as field level', () => {
    const view = buildView(model, options({ expandedEvents: new Set(['baseline_arm_1', 'followup_arm_1']), expanded: new Set(['baseline@baseline_arm_1', 'followup@followup_arm_1']) }));
    const edge = view.edges.find((e) => e.from === 'weight_kg@@baseline@baseline_arm_1');
    expect(edge?.fieldLevel).toBe(true);
    expect(edge?.to).toBe('weight_change@@followup@followup_arm_1');
  });
});

describe('explore buttons at event level', () => {
  it('offers none, since the event graph has no back / forward expansion', () => {
    const context = { level: 'event' as const, instanceMode: false, isFormId: () => true, formOf: () => 'baseline', instanceNodes: [] };
    expect(resolveExploreTarget(context, 'baseline')).toEqual({ kind: 'none' });
  });
});

describe('links inside one expanded event', () => {
  const field = (variable: string, form: string, branching = ''): Field => ({
    variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching, calc: '', annotation: '',
    required: false, choices: [], form,
  });
  // one event `visit` with three forms. `reader` names the event explicitly ([visit][source]); `plain` reads [source] with no event;
  // `extra` and `lonely` have no links at all
  const parsed: ParsedODM = {
    projectName: 't', redcapVersion: '0',
    forms: [
      { id: 'form_a', label: 'Form A', repeating: false, fields: ['source'] },
      { id: 'form_b', label: 'Form B', repeating: false, fields: ['reader', 'plain', 'extra'] },
      { id: 'form_c', label: 'Form C', repeating: false, fields: ['lonely'] },
    ],
    fields: [
      field('source', 'form_a'), field('reader', 'form_b', "[visit][source] = '1'"), field('plain', 'form_b', "[source] = '1'"),
      field('extra', 'form_b'), field('lonely', 'form_c'),
    ],
    formLogic: [], logicSources: [],
    events: [{ id: 'visit', label: 'Visit', arm: '1', armName: 'Arm', repeating: false, forms: ['form_a', 'form_b', 'form_c'] }],
    arms: [], repeatingInstruments: [],
  };
  const tiny = buildModel(parsed);
  const expandVisit = (over: Partial<ViewOptions> = {}) => buildView(tiny, options({ expandedEvents: new Set(['visit']), hideIsolatedNodes: false, ...over }));
  const pairs = (view: ReturnType<typeof buildView>) => view.edges.map((e) => [e.from, e.to, e.fieldLevel ?? false]);

  it('draws nothing while the event is collapsed', () => {
    expect(buildView(tiny, options({ hideIsolatedNodes: false })).edges).toEqual([]);
  });

  it('draws one link between the forms of the expanded event, counting the explicit and the plain reference', () => {
    const view = expandVisit();
    expect(pairs(view)).toEqual([['form_a', 'form_b', false]]);
    expect(view.edges[0].count).toBe(2);
  });

  it('draws a link per reading field once both forms are opened', () => {
    const view = expandVisit({ expanded: new Set(['form_a', 'form_b']) });
    expect(pairs(view)).toEqual([['source@@form_a', 'reader@@form_b', true], ['source@@form_a', 'plain@@form_b', true]]);
  });

  it('lists only the linked fields of an opened form while isolated fields are hidden', () => {
    const view = expandVisit({ expanded: new Set(['form_b']) });
    expect(view.groups.find((g) => g.id === 'form_b')?.nodes).toEqual(['reader@@form_b', 'plain@@form_b']);
  });

  it('lists every field when isolated fields are shown', () => {
    const view = expandVisit({ expanded: new Set(['form_b']), hideIsolated: false });
    expect(view.groups.find((g) => g.id === 'form_b')?.nodes).toEqual(['reader@@form_b', 'plain@@form_b', 'extra@@form_b']);
  });

  it('lists every field of an opened form that has no link at all, rather than nothing', () => {
    const view = expandVisit({ expanded: new Set(['form_c']) });
    expect(view.groups.find((g) => g.id === 'form_c')?.nodes).toEqual(['lonely@@form_c']);
  });
});

describe('show chain at event level', () => {
  const field = (variable: string, form: string, branching = ''): Field => ({
    variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching, calc: '', annotation: '',
    required: false, choices: [], form,
  });
  // source -> middle -> last, plus an unrelated pair other -> reader
  const parsed: ParsedODM = {
    projectName: 't', redcapVersion: '0',
    forms: [{ id: 'form_a', label: 'Form A', repeating: false, fields: ['source', 'other'] }, { id: 'form_b', label: 'Form B', repeating: false, fields: ['middle', 'last', 'reader'] }],
    fields: [
      field('source', 'form_a'), field('other', 'form_a'), field('middle', 'form_b', "[source] = '1'"),
      field('last', 'form_b', "[middle] = '1'"), field('reader', 'form_b', "[other] = '1'"),
    ],
    formLogic: [], logicSources: [],
    events: [{ id: 'visit', label: 'Visit', arm: '1', armName: 'Arm', repeating: false, forms: ['form_a', 'form_b'] }],
    arms: [], repeatingInstruments: [],
  };
  const chain = buildModel(parsed);
  const opened = (over: Partial<ViewOptions> = {}) => buildView(chain, options({
    expandedEvents: new Set(['visit']), expanded: new Set(['form_a', 'form_b']), hideIsolatedNodes: false, focus: 'source', focusDir: 'down', focusDepth: 10, ...over,
  }));

  it('stays at event level and keeps what is expanded', () => {
    const view = opened();
    expect(view.level).toBe('event');
    expect(view.mixed).toBe(true);
    expect(view.groups.map((g) => g.id)).toEqual(['visit', 'form_a', 'form_b']);
  });

  it('draws only the fields of the chain and marks the focused one', () => {
    const view = opened();
    expect(view.nodes.map((n) => n.id).sort()).toEqual(['last@@form_b', 'middle@@form_b', 'source@@form_a']);
    expect(view.nodes.find((n) => n.id === 'source@@form_a')?.focus).toBe(true);
    expect(view.edges.map((e) => [e.from, e.to])).toEqual([['source@@form_a', 'middle@@form_b'], ['middle@@form_b', 'last@@form_b']]);
  });

  it('reports how many fields a small depth hides', () => {
    expect(opened({ focusDepth: 1 }).focusHidden).toBe(1);
    expect(opened().focusHidden).toBeUndefined();
  });
});
