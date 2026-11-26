/* The large-graph guard (MAX_AUTO_EDGES, tooBig, "Render anyway") with the layout-engine renderers (Swimlane, ELK) on a
   synthetic longitudinal project big enough to exceed the limit. renderEngine is mocked so a layout run can be counted. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from 'solid-js';
import * as store from '../src/store';
import { renderEngine } from '../src/lib/renderers';

vi.mock('../src/lib/renderers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/renderers')>();
  const fakeSvg = (): SVGSVGElement => {
    const document = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', 'image/svg+xml');
    return document.documentElement as unknown as SVGSVGElement;
  };
  return { ...original, renderEngine: vi.fn(async () => fakeSvg()) };
});

const FORM_COUNT = 30;
const FORM_EVENT_COUNT = 8;
const EVENT_LEVEL_EVENT_COUNT = 40;

const pad = (n: number): string => String(n).padStart(2, '0');
const attribute = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A longitudinal ODM: every event collects every form, and every field's branching logic references the field of every other form. */
function buildProject(eventCount: number, crossEvent: boolean): string {
  const forms = Array.from({ length: FORM_COUNT }, (_, i) => pad(i + 1));
  const events = Array.from({ length: eventCount }, (_, i) => pad(i + 1));
  const eventDefs = events.map((e, index) => `
	<StudyEventDef OID="Event.visit${e}_arm_1" Name="Visit ${e}" Type="Common" Repeating="No" redcap:EventName="Visit ${e}" redcap:UniqueEventName="visit${e}_arm_1" redcap:ArmNum="1" redcap:ArmName="Main" redcap:DayOffset="${index * 7}">
${forms.map((f, order) => `		<FormRef FormOID="Form.form${f}" OrderNumber="${order + 1}" Mandatory="No" redcap:FormName="form${f}"/>`).join('\n')}
	</StudyEventDef>`).join('');
  const eventRefs = events.map((e, index) => `		<StudyEventRef StudyEventOID="Event.visit${e}_arm_1" OrderNumber="${index + 1}" Mandatory="No"/>`).join('\n');
  const formDefs = forms.map((f) => `
	<FormDef OID="Form.form${f}" Name="Form ${f}" Repeating="No" redcap:FormName="form${f}">
		<ItemGroupRef ItemGroupOID="form${f}.group" Mandatory="No"/>
	</FormDef>`).join('');
  const itemGroups = forms.map((f) => `
	<ItemGroupDef OID="form${f}.group" Name="Form ${f}" Repeating="No">
		<ItemRef ItemOID="field${f}" Mandatory="No" redcap:Variable="field${f}"/>
	</ItemGroupDef>`).join('');
  const itemDefs = forms.map((f, index) => {
    const neighbour = forms[(index + 1) % forms.length];
    const references = forms.filter((other) => other !== f).map((other) => `[field${other}] = "1"`);
    // cross-event references use the unique event name, which REDCap writes without hyphens
    const crossReferences = crossEvent ? events.filter((e) => e !== events[0]).map((e) => `[visit${e}_arm_1][field${neighbour}] = "1"`) : [];
    return `
	<ItemDef OID="field${f}" Name="field${f}" DataType="text" Length="999" redcap:Variable="field${f}" redcap:FieldType="text" redcap:BranchingLogic="${attribute([...references, ...crossReferences].join(' or '))}">
		<Question><TranslatedText>Field ${f}</TranslatedText></Question>
	</ItemDef>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" ?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:redcap="https://projectredcap.org" ODMVersion="1.3.1" FileOID="000" FileType="Snapshot" Description="Synthetic" AsOfDateTime="2026-01-01T00:00:00" CreationDateTime="2026-01-01T00:00:00" SourceSystem="REDCap" SourceSystemVersion="14.0.0">
<Study OID="Project.SYNTHETIC">
<GlobalVariables><StudyName>Synthetic</StudyName><StudyDescription>Synthetic</StudyDescription><ProtocolName>Synthetic</ProtocolName></GlobalVariables>
<MetaDataVersion OID="Metadata.SYNTHETIC" Name="Synthetic" redcap:RecordIdField="field01">
	<Protocol>
${eventRefs}
	</Protocol>${eventDefs}${formDefs}${itemGroups}${itemDefs}
</MetaDataVersion>
</Study>
</ODM>`;
}

/** Writes followed by a flush, so reads see the new values. */
const settle = (write: () => void): void => {
  write();
  flush();
};

/** Lets the (async) render step that the effect started finish. */
const letRenderSettle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
};

const renderLayoutMock = vi.mocked(renderEngine);

/** The guard expectations shared by every renderer and level. */
async function expectGuardThenRenderAnyway(rendererName: 'swimlane' | 'elk'): Promise<void> {
  expect(store.effectiveRenderer()).toBe(rendererName);
  expect(store.view()!.edges.length).toBeGreaterThan(store.MAX_AUTO_EDGES);
  expect(store.tooBig()).toBe(true);
  await letRenderSettle();
  expect(store.svgEl()).toBeNull();
  expect(renderLayoutMock).not.toHaveBeenCalled();

  // what the "Render anyway" button does (GraphView.tsx)
  settle(() => store.setForcedFor(store.dotSrc()));
  expect(store.tooBig()).toBe(false);
  await letRenderSettle();
  expect(renderLayoutMock).toHaveBeenCalledTimes(1);
  expect(renderLayoutMock.mock.calls[0]![0]).toBe(rendererName);
  expect(store.svgEl()).not.toBeNull();
}

afterEach(() => {
  settle(() => store.setForcedFor(''));
});

describe('large-graph guard on a longitudinal project, form level with instances', () => {
  beforeEach(() => {
    store.loadText(buildProject(FORM_EVENT_COUNT, false), 'synthetic');
    flush();
    settle(() => { store.selection.setLevel('form'); store.setInstances(true); store.setForcedFor(''); });
    renderLayoutMock.mockClear();
  });

  it('exceeds the limit with the synthetic project', () => {
    expect(store.view()!.level).toBe('form');
    expect(store.view()!.instances).toBe(true);
    expect(store.view()!.edges.length).toBeGreaterThan(store.MAX_AUTO_EDGES);
  });

  it('holds back Swimlane until "Render anyway"', async () => {
    settle(() => store.presentation.setRenderer('swimlane'));
    await expectGuardThenRenderAnyway('swimlane');
  });

  it('holds back ELK until "Render anyway"', async () => {
    settle(() => store.presentation.setRenderer('elk'));
    await expectGuardThenRenderAnyway('elk');
  });
});

describe('large-graph guard on a longitudinal project, event level', () => {
  beforeEach(() => {
    store.loadText(buildProject(EVENT_LEVEL_EVENT_COUNT, true), 'synthetic');
    flush();
    settle(() => { store.selection.setLevel('event'); store.setForcedFor(''); });
    renderLayoutMock.mockClear();
  });

  it('exceeds the limit with the synthetic project', () => {
    expect(store.view()!.level).toBe('event');
    expect(store.view()!.edges.length).toBeGreaterThan(store.MAX_AUTO_EDGES);
  });

  it('holds back Swimlane until "Render anyway"', async () => {
    settle(() => store.presentation.setRenderer('swimlane'));
    await expectGuardThenRenderAnyway('swimlane');
  });

  it('holds back ELK until "Render anyway"', async () => {
    settle(() => store.presentation.setRenderer('elk'));
    await expectGuardThenRenderAnyway('elk');
  });
});
