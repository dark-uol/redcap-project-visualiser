import { describe, expect, it } from 'vitest';
import { buildModel, buildView } from '../src/lib/graph';
import type { DepType, EventDef, Field, FocusDir, Level, ParsedODM, View, ViewOptions } from '../src/lib/types';

const ALL_TYPES: DepType[] = ['branching', 'calc', 'piping', 'actiontag', 'formlogic', 'logicsrc'];

const field = (variable: string, form: string, over: Partial<Field> = {}): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form, ...over,
});
const event = (id: string, forms: string[]): EventDef => ({ id, label: id, arm: '1', armName: 'Arm 1', repeating: false, forms });

/*
 * enrol.enrol_id  --action tag-->  survey.survey_link        (enrol -> survey)
 * child.child_ready --form display logic--> form:survey      (child -> survey)
 * survey.survey_link --branching--> followup.follow_up       (survey -> followup)
 * unrelated.alone has no links.
 * Events: baseline collects enrol + child, survey_event collects survey, later collects followup.
 * The form display logic and the follow-up branching name their source event, so they are cross-event links.
 */
const parsed: ParsedODM = {
  projectName: 't', redcapVersion: '0',
  forms: [
    { id: 'enrol', label: 'Enrol', repeating: false, fields: ['enrol_id'] },
    { id: 'child', label: 'Child', repeating: false, fields: ['child_ready'] },
    { id: 'survey', label: 'Survey', repeating: false, fields: ['survey_link'] },
    { id: 'followup', label: 'Followup', repeating: false, fields: ['follow_up'] },
    { id: 'unrelated', label: 'Unrelated', repeating: false, fields: ['alone'] },
  ],
  fields: [
    field('enrol_id', 'enrol'), field('child_ready', 'child'),
    field('survey_link', 'survey', { annotation: "@DEFAULT='[enrol_id]'" }),
    field('follow_up', 'followup', { branching: '[survey_event][survey_link] = 1' }),
    field('alone', 'unrelated'),
  ],
  formLogic: [{ forms: ['survey'], logic: '[baseline][child_ready] = 1', formEvents: [{ event: 'survey_event', form: 'survey' }] }],
  logicSources: [],
  events: [event('baseline', ['enrol', 'child']), event('survey_event', ['survey']), event('later', ['followup'])],
  arms: [], repeatingInstruments: [],
};
const model = buildModel(parsed);

const options = (level: Level, focus: string, focusDir: FocusDir, over: Partial<ViewOptions> = {}): ViewOptions => ({
  level, eventSet: null, types: new Set(ALL_TYPES), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, expandedEvents: null, explore: null, pair: null, focus, focusDir, focusDepth: 10,
  showMissing: false, hideIsolated: true, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'label', group: false, groupBy: 'none', edgeLabels: false, ...over,
});

const ids = (view: View): string[] => view.nodes.map((node) => node.id).sort();
const pairs = (view: View): string[] => view.edges.map((edge) => edge.from + '>' + edge.to).sort();

describe('focus on a form with display logic, every level', () => {
  it('field level: both directions include the display-logic sources and the downstream field', () => {
    const view = buildView(model, options('field', 'survey', 'both'));
    expect(ids(view)).toEqual(['child_ready', 'enrol_id', 'follow_up', 'form:survey', 'survey_link']);
  });

  it('field level: up reaches only what feeds the form, down only what the form feeds', () => {
    expect(ids(buildView(model, options('field', 'survey', 'up')))).toEqual(['child_ready', 'enrol_id', 'form:survey', 'survey_link']);
    expect(ids(buildView(model, options('field', 'survey', 'down')))).toEqual(['follow_up', 'survey_link']);
  });

  it('field level: depth 1 still reaches the display-logic source', () => {
    const view = buildView(model, options('field', 'survey', 'up', { focusDepth: 1 }));
    expect(ids(view)).toEqual(expect.arrayContaining(['child_ready', 'enrol_id']));
  });

  it('form level (aggregated): both feeders and the follower are linked', () => {
    expect(pairs(buildView(model, options('form', 'survey', 'both')))).toEqual(['child>survey', 'enrol>survey', 'survey>followup']);
  });

  it('form level: up and down split the links', () => {
    expect(pairs(buildView(model, options('form', 'survey', 'up')))).toEqual(['child>survey', 'enrol>survey']);
    expect(pairs(buildView(model, options('form', 'survey', 'down')))).toEqual(['survey>followup']);
  });

  it('form level with expanded forms: lists the chain fields only', () => {
    const view = buildView(model, options('form', 'survey', 'up', { expanded: new Set(['child', 'enrol', 'survey']) }));
    expect(ids(view)).toEqual(expect.arrayContaining(['child_ready', 'enrol_id']));
    expect(ids(view)).not.toContain('alone');
  });

  it('form level with instances: the feeders still link into the survey', () => {
    const view = buildView(model, options('form', 'survey', 'up', { instances: true }));
    const text = view.nodes.map((node) => node.form).sort();
    expect(text).toEqual(expect.arrayContaining(['child', 'enrol', 'survey']));
    expect(view.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('event level: the chain follows the cross-event links', () => {
    const view = buildView(model, options('event', 'survey', 'both'));
    expect(pairs(view)).toEqual(expect.arrayContaining(['baseline>survey_event']));
  });
});

describe('focus on a field, every level', () => {
  it('field level: a field walks its own chain only', () => {
    expect(ids(buildView(model, options('field', 'survey_link', 'both')))).toEqual(['enrol_id', 'follow_up', 'survey_link']);
  });

  it('form level: only the chain\'s links are counted', () => {
    expect(pairs(buildView(model, options('form', 'survey_link', 'both')))).toEqual(['enrol>survey', 'survey>followup']);
  });

  it('event level: the field\'s cross-event links', () => {
    const view = buildView(model, options('event', 'survey_link', 'down'));
    expect(pairs(view)).toEqual(['survey_event>later']);
  });
});

describe('focus on an event, every level', () => {
  it('event level: up = events it reads from, down = events that read from it', () => {
    expect(pairs(buildView(model, options('event', 'survey_event', 'up')))).toEqual(['baseline>survey_event']);
    expect(pairs(buildView(model, options('event', 'survey_event', 'down')))).toEqual(['survey_event>later']);
    expect(pairs(buildView(model, options('event', 'survey_event', 'both')))).toEqual(['baseline>survey_event', 'survey_event>later']);
  });

  it('field level: an event starts from its forms\' linked fields, including display logic', () => {
    expect(ids(buildView(model, options('field', 'survey_event', 'up')))).toEqual(['child_ready', 'enrol_id', 'form:survey', 'survey_link']);
  });

  it('form level: the event\'s forms and their chains', () => {
    expect(pairs(buildView(model, options('form', 'survey_event', 'up')))).toEqual(['child>survey', 'enrol>survey']);
  });
});

describe('focus edge cases', () => {
  it('a form with no links is empty at every level', () => {
    expect(buildView(model, options('field', 'unrelated', 'both')).nodes).toHaveLength(0);
    expect(buildView(model, options('form', 'unrelated', 'both')).edges).toHaveLength(0);
  });

  it('focus depth 1 reports what it hides', () => {
    expect(buildView(model, options('field', 'survey', 'both', { focusDepth: 1 })).focusHidden ?? 0).toBe(0);
    expect(buildView(model, options('field', 'enrol_id', 'down', { focusDepth: 1 })).focusHidden).toBe(1);
  });
});
