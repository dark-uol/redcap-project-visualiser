import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel, buildView } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import type { DepType, Field, Form, ParsedODM, ViewOptions } from '../src/lib/types';

const field = (variable: string, form: string, over: Partial<Field> = {}): Field => ({
  variable, oid: variable, type: 'text', label: variable, section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form, ...over,
});

const form = (id: string, fields: string[]): Form => ({ id, label: id, repeating: false, fields });

const parsedWith = (fields: Field[]): ParsedODM => ({
  projectName: 'test',
  redcapVersion: '0',
  forms: [form('form1', fields.map((f) => f.variable))],
  fields,
  formLogic: [],
  logicSources: [],
  events: [],
  arms: [],
  repeatingInstruments: [],
});

const ALL_TYPES: DepType[] = ['branching', 'calc', 'piping', 'embedding', 'actiontag', 'formlogic', 'logicsrc'];

const options = (types: DepType[], over: Partial<ViewOptions> = {}): ViewOptions => ({
  level: 'field', eventSet: null, types: new Set(types), forms: null, formsNone: false, crossOnly: false, instOnly: false,
  instances: false, expanded: null, explore: null, pair: null, focus: '', focusDir: 'both', focusDepth: 1,
  showMissing: false, hideIsolated: true, hideIsolatedNodes: false,
  dir: 'LR', labelMode: 'label', group: false, groupBy: 'none', edgeLabels: false, ...over,
});

const embeddingEdges = (model: ReturnType<typeof buildModel>) => model.edges.filter((e) => e.type === 'embedding');

describe('field embedding dependencies', () => {
  it('draws an embedding edge from the host field to the embedded field, not the reverse', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Pain: {b}' }),
      field('b', 'form1'),
    ]));
    const edge = model.edges.find((e) => e.type === 'embedding');
    expect(edge).toBeDefined();
    expect(edge?.from).toBe('a');
    expect(edge?.to).toBe('b');
    expect(model.edges.some((e) => e.type === 'embedding' && e.from === 'b' && e.to === 'a')).toBe(false);
    expect(edge?.missing).toBe(false);
  });

  it('takes embeds from the section header and the field note as well as the label', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { note: 'Note {b}' }),
      field('b', 'form1'),
      field('d', 'form1', { section: 'Intro {c}' }),
      field('c', 'form1'),
    ]));
    expect(model.edges.some((e) => e.type === 'embedding' && e.from === 'a' && e.to === 'b')).toBe(true);
    expect(model.edges.some((e) => e.type === 'embedding' && e.from === 'd' && e.to === 'c')).toBe(true);
  });

  it('gives a single edge when the same field is embedded in both the label and the note', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Rate {b}', note: 'Again {b}' }),
      field('b', 'form1'),
    ]));
    expect(embeddingEdges(model)).toHaveLength(1);
  });

  it('takes embeds from answer-choice labels, with the host as the field that owns the choices', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { type: 'radio', choices: [{ code: '1', label: 'Yes' }, { code: '99', label: 'Other: {b}' }] }),
      field('b', 'form1'),
    ]));
    const edge = embeddingEdges(model)[0];
    expect(embeddingEdges(model)).toHaveLength(1);
    expect(edge?.from).toBe('a');
    expect(edge?.to).toBe('b');
    expect(edge?.missing).toBe(false);
  });

  it('gives a single edge when the same field is embedded in a label and in a choice', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { type: 'radio', label: 'Rate {b}', choices: [{ code: '99', label: 'Other: {b}' }] }),
      field('b', 'form1'),
    ]));
    expect(embeddingEdges(model)).toHaveLength(1);
  });

  it('does not draw piping or embedding for a square-bracket token inside a choice label', () => {
    // Current scope: piping is read from label, note and section only, so [b] in a choice is ignored.
    const model = buildModel(parsedWith([
      field('a', 'form1', { type: 'radio', choices: [{ code: '99', label: 'Other: [b]' }] }),
      field('b', 'form1'),
    ]));
    expect(model.edges.some((e) => e.from === 'b' && e.to === 'a')).toBe(false);
    expect(embeddingEdges(model)).toHaveLength(0);
  });

  it('creates a ghost and a missing edge when a choice embeds an undefined field', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { type: 'radio', choices: [{ code: '99', label: 'Other: {ghost}' }] }),
    ]));
    const edge = embeddingEdges(model)[0];
    expect(edge?.from).toBe('a');
    expect(edge?.to).toBe('ghost');
    expect(edge?.missing).toBe(true);
    expect(model.ghosts.get('ghost')).toMatchObject({ variable: 'ghost', type: 'missing', ghost: true });
  });

  it('accepts the modifier syntax {field:mod}', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Rating {b:icons}' }),
      field('b', 'form1'),
    ]));
    const edge = model.edges.find((e) => e.type === 'embedding');
    expect(edge?.from).toBe('a');
    expect(edge?.to).toBe('b');
    expect(edge?.expr).toBe('{b:icons}');
  });

  it('creates a ghost and a missing edge when the embedded field is undefined', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Pain {ghost}' }),
    ]));
    const edge = model.edges.find((e) => e.type === 'embedding');
    expect(edge?.from).toBe('a');
    expect(edge?.to).toBe('ghost');
    expect(edge?.missing).toBe(true);
    expect(model.ghosts.get('ghost')).toMatchObject({ variable: 'ghost', type: 'missing', ghost: true });
    expect(model.analysis.missing).toContain(edge);
    expect(model.ghosts.has('a')).toBe(false);
  });

  it('shows the undefined embedded field as a missing node when undefined fields are shown', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Pain {ghost}' }),
    ]));
    const view = buildView(model, options(ALL_TYPES, { showMissing: true }));
    const ghostNode = view.nodes.find((n) => n.id === 'ghost');
    expect(ghostNode?.kind).toBe('missing');
    expect(view.edges.some((e) => e.from === 'a' && e.to === 'ghost')).toBe(true);
    const hidden = buildView(model, options(ALL_TYPES));
    expect(hidden.edges.some((e) => e.to === 'ghost')).toBe(false);
  });

  it('records a self-embedding in selfRefs and creates no edge', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Me {a}' }),
    ]));
    expect(model.selfRefs).toContainEqual({ field: 'a', type: 'embedding', expr: '{a}' });
    expect(embeddingEdges(model)).toHaveLength(0);
  });

  it('does not count an embedding as a cycle, even when the embedded field branches back on the host', () => {
    // a embeds b (embedding a -> b) and a's branching uses b (branching b -> a): a cycle only if embedding were logic
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Host {b}', branching: '[b] = 1' }),
      field('b', 'form1'),
    ]));
    expect(model.edges.some((e) => e.type === 'embedding' && e.from === 'a' && e.to === 'b')).toBe(true);
    expect(model.edges.some((e) => e.type === 'branching' && e.from === 'b' && e.to === 'a')).toBe(true);
    expect(model.analysis.cycles).toEqual([]);
  });

  it('is shown when only the embedding type is enabled, and hidden when only piping is', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Pain {b}' }),
      field('b', 'form1'),
    ]));
    const onlyEmbedding = buildView(model, options(['embedding']));
    expect(onlyEmbedding.edges.some((e) => e.from === 'a' && e.to === 'b' && e.types.includes('embedding'))).toBe(true);
    const onlyPiping = buildView(model, options(['piping']));
    expect(onlyPiping.edges.some((e) => e.from === 'a' && e.to === 'b')).toBe(false);
  });

  it('keeps square-bracket piping as a piping edge and does not treat it as an embedding', () => {
    const model = buildModel(parsedWith([
      field('a', 'form1', { label: 'Value is [b]' }),
      field('b', 'form1'),
    ]));
    expect(model.edges.some((e) => e.type === 'piping' && e.from === 'b' && e.to === 'a')).toBe(true);
    expect(embeddingEdges(model)).toHaveLength(0);
  });
});

describe('field embedding in the sample project', () => {
  const model = buildModel(parseODM(sampleXml));
  const embeddingPairs = embeddingEdges(model).map((e) => e.from + '>' + e.to).sort();

  it('draws host-to-embedded edges for labels, notes, section headers and answer choices', () => {
    expect(embeddingPairs).toEqual([
      'em_ghost_host>em_missing_target',
      'em_header_host>em_header_target',
      'em_host>em_other_text',
      'em_host>em_rating',
      'em_note_host>em_note_target',
      'em_pick>em_choice_target',
    ]);
  });

  it('keeps the modifier in the embedding edge expression', () => {
    const edge = embeddingEdges(model).find((e) => e.from === 'em_host' && e.to === 'em_rating');
    expect(edge?.expr).toBe('{em_rating:icons}');
  });

  it('has no modifier in the expression for an unmodified embed in the same label', () => {
    const edge = embeddingEdges(model).find((e) => e.from === 'em_host' && e.to === 'em_other_text');
    expect(edge?.expr).toBe('{em_other_text}');
  });

  it('flags the embedding of an undefined field as missing', () => {
    const edge = embeddingEdges(model).find((e) => e.to === 'em_missing_target');
    expect(edge?.missing).toBe(true);
    expect(model.ghosts.has('em_missing_target')).toBe(true);
  });
});
