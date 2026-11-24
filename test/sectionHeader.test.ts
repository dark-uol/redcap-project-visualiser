import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import type { Field, Form, ParsedODM } from '../src/lib/types';

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

/** Minimal ODM with one ItemDef whose SectionHeader is the given raw attribute value. */
const odmWithSectionHeader = (sectionHeader: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:redcap="https://projectredcap.org" ODMVersion="1.3.1" SourceSystem="REDCap" SourceSystemVersion="14.0.0">
<Study OID="Project.TEST">
<GlobalVariables><StudyName>Test</StudyName><ProtocolName>Test</ProtocolName></GlobalVariables>
<MetaDataVersion OID="Metadata.TEST" Name="Test" redcap:RecordIdField="record_id">
<ItemDef OID="x" Name="x" DataType="text" Length="999" redcap:Variable="x" redcap:FieldType="descriptive" redcap:SectionHeader="${sectionHeader}"/>
</MetaDataVersion>
</Study>
</ODM>`;

describe('parseODM reads section headers from the sample project', () => {
  const parsed = parseODM(sampleXml);
  const byVariable = (variable: string): Field | undefined => parsed.fields.find((f) => f.variable === variable);

  it('keeps references in the header text of sc_intro', () => {
    expect(byVariable('sc_intro')?.section).toBe('Screening for [first_name] (born [dob])');
  });

  it('keeps the header text of sc_pain', () => {
    expect(byVariable('sc_pain')?.section).toBe('Pain for [first_name]');
  });

  it('gives an empty section to a field without a header', () => {
    expect(byVariable('record_id')?.section).toBe('');
  });
});

describe('parseODM strips HTML from section headers', () => {
  it('removes tags and keeps the text and references', () => {
    const parsed = parseODM(odmWithSectionHeader('&lt;b&gt;Hi&lt;/b&gt; [x]'));
    const header = parsed.fields.find((f) => f.variable === 'x')?.section;
    expect(header).toBe('Hi [x]');
  });
});

describe('buildModel draws piping edges from section header references', () => {
  it('draws a piping edge for a reference that appears only in the header', () => {
    const host = field('host', 'form1', { section: 'Header for [a]' });
    const model = buildModel(parsedWith([field('a', 'form1'), host]));
    const edge = model.edges.find((e) => e.from === 'a' && e.to === 'host');
    expect(edge?.type).toBe('piping');
    expect(edge?.missing).toBe(false);
  });

  it('dedupes a reference found in both the header and the label into one edge', () => {
    const host = field('host', 'form1', { label: 'Value of [a]', section: 'Header for [a]' });
    const model = buildModel(parsedWith([field('a', 'form1'), host]));
    const matching = model.edges.filter((e) => e.from === 'a' && e.to === 'host');
    expect(matching).toHaveLength(1);
    expect(matching[0].type).toBe('piping');
  });

  it('flags a header reference to an unknown variable as missing', () => {
    const host = field('host', 'form1', { section: 'Header for [nope]' });
    const model = buildModel(parsedWith([host]));
    const edge = model.edges.find((e) => e.from === 'nope' && e.to === 'host');
    expect(edge?.type).toBe('piping');
    expect(edge?.missing).toBe(true);
    expect(model.ghosts.has('nope')).toBe(true);
  });

  it('records a header referencing its own field as a self reference, not an edge', () => {
    const host = field('host', 'form1', { section: 'Header for [host]' });
    const model = buildModel(parsedWith([host]));
    expect(model.edges.some((e) => e.from === 'host' && e.to === 'host')).toBe(false);
    expect(model.selfRefs.some((ref) => ref.field === 'host' && ref.type === 'piping')).toBe(true);
  });
});

describe('a section header does not add branching of its own', () => {
  it('keeps the branching edge and the header piping edge separate', () => {
    const host = field('host', 'form1', { branching: "[b] = '1'", section: 'Header for [a]' });
    const model = buildModel(parsedWith([field('a', 'form1'), field('b', 'form1'), host]));
    const fromBranching = model.edges.find((e) => e.from === 'b' && e.to === 'host');
    const fromHeader = model.edges.find((e) => e.from === 'a' && e.to === 'host');
    expect(fromBranching?.type).toBe('branching');
    expect(fromHeader?.type).toBe('piping');
    expect(fromHeader).not.toBe(fromBranching);
    expect(model.edges.some((e) => e.from === 'a' && e.to === 'host' && e.type === 'branching')).toBe(false);
  });
});
