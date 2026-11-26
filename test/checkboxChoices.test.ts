// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseODM } from '../src/lib/parser';

const xml = `<?xml version="1.0"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:redcap="https://projectredcap.org">
<Study OID="S"><MetaDataVersion OID="M" Name="m">
<ItemDef OID="meds___1" Name="meds___1" DataType="boolean" redcap:Variable="meds" redcap:FieldType="checkbox"><Question><TranslatedText>Meds?</TranslatedText></Question><CodeListRef CodeListOID="meds___1.choices"/></ItemDef>
<ItemDef OID="meds___2" Name="meds___2" DataType="boolean" redcap:Variable="meds" redcap:FieldType="checkbox"><CodeListRef CodeListOID="meds___2.choices"/></ItemDef>
<CodeList OID="meds___1.choices" Name="meds___1" DataType="boolean" redcap:Variable="meds" redcap:CheckboxChoices="1, Spray|2, Lozenges"><CodeListItem CodedValue="1"><Decode><TranslatedText>Checked</TranslatedText></Decode></CodeListItem><CodeListItem CodedValue="0"><Decode><TranslatedText>Unchecked</TranslatedText></Decode></CodeListItem></CodeList>
<CodeList OID="meds___2.choices" Name="meds___2" DataType="boolean" redcap:Variable="meds" redcap:CheckboxChoices="1, Spray|2, Lozenges"><CodeListItem CodedValue="1"><Decode><TranslatedText>Checked</TranslatedText></Decode></CodeListItem></CodeList>
</MetaDataVersion></Study></ODM>`;

describe('checkbox choices', () => {
  it('uses CheckboxChoices rather than Checked/Unchecked', () => {
    const field = parseODM(xml).fields.find((f) => f.variable === 'meds');
    expect(field?.choices).toEqual([{ code: '1', label: 'Spray' }, { code: '2', label: 'Lozenges' }]);
  });
});
