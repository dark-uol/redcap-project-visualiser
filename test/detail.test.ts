import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel, nodeInfo } from '../src/lib/graph';
import {
  crossFormEdges,
  edgePasses,
  eventEdges,
  formLink,
  linkedFieldsOf,
  repeatingEventLabels,
  repeatingNote,
  type EdgeFilter,
} from '../src/lib/detail';
import { parseODM } from '../src/lib/parser';
import type { Edge, Form, Model, ParsedODM } from '../src/lib/types';

const sampleModel: Model = buildModel(parseODM(sampleXml));
const sampleParsed: ParsedODM = sampleModel.parsed;

const allTypes: ReadonlySet<string> = new Set(['branching', 'calc', 'piping', 'embedding', 'actiontag', 'formlogic', 'logicsrc']);
const everything: EdgeFilter = { types: allTypes, showMissing: false };
const filterWith = (over: Partial<EdgeFilter>): EdgeFilter => ({ ...everything, ...over });

/** The sample edge from one variable to another; fails the test when the sample has no such edge. */
function sampleEdge(from: string, to: string): Edge {
  const edge = sampleModel.edges.find((candidate) => candidate.from === from && candidate.to === to);
  if (!edge) throw new Error(`sample has no edge ${from} -> ${to}`);
  return edge;
}

/** The form a variable (field, ghost, form node or logic node) sits in. */
const formOf = (variable: string): string => nodeInfo(sampleModel, variable).form;

/** The sample's parsed metadata with its repeating instruments replaced. */
function parsedWithInstruments(events: string[], formId = 'rep'): ParsedODM {
  return { ...sampleParsed, repeatingInstruments: events.map((event) => ({ form: formId, event, label: '[x]' })) };
}

describe('edgePasses', () => {
  it('lets an edge through when its type is allowed', () => {
    expect(edgePasses(everything, sampleEdge('sex', 'pregnant'))).toBe(true);
  });

  it('blocks an edge whose type is not in the filter', () => {
    expect(edgePasses(filterWith({ types: new Set(['calc']) }), sampleEdge('sex', 'pregnant'))).toBe(false);
  });

  it('hides a missing edge unless showMissing is set', () => {
    const missing = sampleEdge('smoking_status', 'risk_b');
    expect(missing.missing).toBe(true);
    expect(edgePasses(everything, missing)).toBe(false);
    expect(edgePasses(filterWith({ showMissing: true }), missing)).toBe(true);
  });
});

describe('linkedFieldsOf', () => {
  it('returns the linked fields of a form in field order and leaves out the unlinked ones', () => {
    expect(linkedFieldsOf(sampleModel, everything, 'followup')).toEqual([
      'fu_weight', 'weight_change', 'fu_summary', 'fu_complications', 'fu_details', 'fu_trend', 'partner_note',
    ]);
    expect(linkedFieldsOf(sampleModel, everything, 'followup')).not.toContain('fu_date');
  });

  it('returns [] for a form that is not in the model', () => {
    expect(linkedFieldsOf(sampleModel, everything, 'no_such_form')).toEqual([]);
  });

  it('drops the fields whose only links are of a type the filter removes', () => {
    const withoutBranching = filterWith({ types: new Set(['calc', 'piping', 'actiontag', 'embedding', 'formlogic', 'logicsrc']) });
    expect(linkedFieldsOf(sampleModel, withoutBranching, 'followup')).toEqual(['fu_weight', 'weight_change', 'fu_summary', 'fu_trend']);
  });

  it('counts a field linked only by a missing edge only when showMissing is set', () => {
    expect(linkedFieldsOf(sampleModel, everything, 'screening')).not.toContain('sc_ghost');
    expect(linkedFieldsOf(sampleModel, filterWith({ showMissing: true }), 'screening')).toContain('sc_ghost');
  });
});

describe('crossFormEdges', () => {
  it('lists exactly the edges with one end in the form', () => {
    expect(crossFormEdges(sampleModel, 'followup').map((edge) => [edge.from, edge.to, edge.type])).toEqual([
      ['weight_kg', 'fu_weight', 'piping'],
      ['weight_kg', 'weight_change', 'calc'],
      ['bmi', 'fu_summary', 'piping'],
      ['symptoms', 'fu_complications', 'branching'],
      ['consent', 'partner_note', 'branching'],
      ['weight_change', 'sc_total', 'calc'],
      ['fu_weight', 'sc_cur', 'calc'],
      ['fu_weight', 'sc_table', 'piping'],
      ['consent', 'form:followup', 'formlogic'],
    ]);
  });

  it('includes a form-level display rule that targets the form', () => {
    expect(crossFormEdges(sampleModel, 'screening').some((edge) => edge.to === 'form:screening')).toBe(true);
  });

  it('leaves out logic-source edges even when their logic node sits in another form', () => {
    const logicEdge = sampleEdge('consent', 'logic:alert-1');
    expect(logicEdge.type).toBe('logicsrc');
    expect(formOf('logic:alert-1')).not.toBe('demographics');
    expect(crossFormEdges(sampleModel, 'demographics')).not.toContain(logicEdge);
  });

  it('leaves out missing edges', () => {
    const missingCross = sampleModel.edges.filter((edge) => edge.missing &&
      (formOf(edge.from) === 'screening') !== (formOf(edge.to) === 'screening'));
    expect(missingCross.length).toBeGreaterThan(0);
    expect(crossFormEdges(sampleModel, 'screening').every((edge) => !edge.missing)).toBe(true);
  });
});

describe('repeatingEventLabels and repeatingNote', () => {
  it('names the events a form repeats in', () => {
    expect(repeatingEventLabels(sampleParsed, 'baseline')).toBe('Baseline');
    expect(repeatingEventLabels(sampleParsed, 'demographics')).toBe('');
  });

  it('gives an empty note for a form that does not repeat', () => {
    expect(repeatingNote(sampleParsed, sampleModel.parsed.forms.find((form) => form.id === 'demographics')!)).toBe('');
  });

  it('names the events when a repeating form repeats in some of them', () => {
    expect(repeatingNote(sampleParsed, sampleModel.parsed.forms.find((form) => form.id === 'baseline')!)).toBe(' · repeating in Baseline');
  });

  it('says only "repeating" when the form repeats but no instrument names an event', () => {
    const repeatingForm: Form = { id: 'rep', label: 'Rep', repeating: true, fields: [] };
    expect(repeatingNote(sampleParsed, repeatingForm)).toBe(' · repeating');
  });

  it('lists every event named by the instruments, in instrument order, without repeats', () => {
    const parsed = parsedWithInstruments(['followup_arm_1', 'enrol_arm_2', 'followup_arm_1']);
    const repeatingForm: Form = { id: 'rep', label: 'Rep', repeating: false, fields: [] };
    expect(repeatingEventLabels(parsed, 'rep')).toBe('Follow-up, Enrolment');
    expect(repeatingNote(parsed, repeatingForm)).toBe(' · repeating in Follow-up, Enrolment');
  });

  it('falls back to the event id when the instrument names an unknown event', () => {
    const parsed = parsedWithInstruments(['ghost_event']);
    expect(repeatingEventLabels(parsed, 'rep')).toBe('ghost_event');
  });
});

describe('eventEdges', () => {
  it('lists the edges whose logic runs in the event', () => {
    const result = eventEdges(sampleModel, 'baseline_arm_1');
    expect(result.readFromEvent.map((edge) => [edge.from, edge.to])).toEqual([['weight_kg', 'weight_change']]);
    expect(result.readsOtherEvents).toEqual([]);
  });

  it('lists the edges into the event forms that read from other events', () => {
    const result = eventEdges(sampleModel, 'followup_arm_2');
    expect(result.readFromEvent).toEqual([]);
    expect(result.readsOtherEvents.map((edge) => [edge.from, edge.to])).toEqual([['weight_kg', 'weight_change'], ['consent', 'partner_note']]);
  });

  it('lists the edges that read this event and no others', () => {
    const result = eventEdges(sampleModel, 'enrol_arm_2');
    expect(result.readFromEvent.map((edge) => [edge.from, edge.to])).toEqual([['consent', 'partner_note']]);
    expect(result.readsOtherEvents).toEqual([]);
  });

  it('returns nothing for an event the model does not have', () => {
    expect(eventEdges(sampleModel, 'no_such_event')).toEqual({ readFromEvent: [], readsOtherEvents: [] });
  });
});

describe('formLink', () => {
  it('groups the edges between two forms by dependent field, in first-seen order', () => {
    const link = formLink(sampleModel, everything, 'demographics', 'baseline');
    expect(link.dependents.map((group) => group.dependent)).toEqual(['age', 'pack_years', 'form:baseline']);
    expect(link.dependents[0].edges.map((edge) => edge.from)).toEqual(['dob']);
    expect(link.sourceCount).toBe(3);
    expect(link.dependencyCount).toBe(3);
  });

  it('counts several edges into one dependent field as one dependent', () => {
    const link = formLink(sampleModel, everything, 'demographics', 'screening');
    expect(link.dependents.map((group) => group.dependent)).toEqual(
      ['sc_intro', 'sc_dmy', 'sc_email', 'sc_score', 'sc_code', 'sc_pain', 'sc_sleep', 'form:screening']);
    expect(link.dependents.find((group) => group.dependent === 'sc_intro')!.edges).toHaveLength(4);
    expect(link.dependents.find((group) => group.dependent === 'sc_code')!.edges).toHaveLength(2);
    expect(link.sourceCount).toBe(6);
    expect(link.dependencyCount).toBe(12);
  });

  it('reports the number of distinct source fields feeding the link', () => {
    const link = formLink(sampleModel, everything, 'baseline', 'demographics');
    expect(link.sourceCount).toBe(1);
    expect(link.dependents.map((group) => group.dependent)).toEqual(['pregnant', 'consent']);
    expect(link.dependencyCount).toBe(2);
  });

  it('returns an empty link for a pair of forms with no edges between them', () => {
    expect(formLink(sampleModel, everything, 'followup', 'demographics')).toEqual({ sourceCount: 0, dependents: [], dependencyCount: 0 });
  });

  it('respects the type filter', () => {
    const withoutCalc = filterWith({ types: new Set(['branching', 'piping', 'actiontag', 'formlogic']) });
    const link = formLink(sampleModel, withoutCalc, 'demographics', 'screening');
    expect(link.dependents.map((group) => group.dependent)).not.toContain('sc_code');
    expect(link.sourceCount).toBe(5);
    expect(link.dependencyCount).toBe(10);
  });
});
