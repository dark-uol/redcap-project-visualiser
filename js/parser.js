/* REDCap ODM / project-metadata XML parser. Classic script (works from file://). */
(function (g) {
  'use strict';
  const RC = (g.RC = g.RC || {});

  const lname = (n) => (n.localName || n.nodeName.split(':').pop());
  function attr(el, name) {
    const l = name.toLowerCase();
    for (const a of el.attributes) if ((a.localName || a.name).toLowerCase() === l) return a.value;
    return '';
  }
  function kids(el, name) {
    const l = name.toLowerCase();
    return Array.from(el.children).filter((c) => lname(c).toLowerCase() === l);
  }
  function all(doc, name) { return Array.from(doc.getElementsByTagNameNS('*', name)); }
  const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * Find [variable] references in a REDCap logic / piping / action-tag string.
   * Returns tokens {name, code, mod, adjNext}. Smart variables ([event-name]) are skipped
   * because REDCap variable names can never contain a hyphen.
   * adjNext = another [..] follows immediately, so this token may be an event prefix ([event][var]).
   */
  function extractRefs(text) {
    const out = [];
    if (!text) return out;
    const re = /\[([^\[\]\r\n]{1,120}?)\]/g;
    const toks = [];
    let m;
    while ((m = re.exec(text))) toks.push({ raw: m[1], start: m.index, end: m.index + m[0].length });
    toks.forEach((t, i) => {
      const p = /^([A-Za-z][A-Za-z0-9_]*)(?:\(([^)]*)\))?(?::([A-Za-z0-9_]+))?$/.exec(t.raw.trim());
      if (!p) return;
      const next = toks[i + 1];
      out.push({ name: p[1], code: p[2] || '', mod: p[3] || '', adjNext: !!(next && next.start === t.end) });
    });
    return out;
  }

  /**
   * Form display logic (Project XML only, not in plain metadata exports).
   * Structure-agnostic: look at elements whose name contains "FormDisplayLogic"; the deepest element
   * that yields both a condition ([field] logic) and >=1 known form id is one rule.
   */
  function parseFormDisplayLogic(doc, forms) {
    // Real REDCap export: <redcap:FormDisplayLogicConditions control_condition="..." forms_events="event:form,event:form" .../>
    const direct = [];
    const known = new Set(forms.map((f) => f.id));
    all(doc, 'FormDisplayLogicConditions').forEach((el) => {
      const logic = attr(el, 'control_condition'), fe = attr(el, 'forms_events');
      if (!logic || !fe) return;
      const fs = new Set();
      fe.split(',').forEach((p) => { const f = p.trim().split(':').pop(); if (known.has(f)) fs.add(f); });
      if (fs.size) direct.push({ logic, forms: [...fs] });
    });
    if (direct.length) return direct;
    const ids = new Map();
    forms.forEach((f) => { ids.set(f.id, f.id); ids.set(f.label, f.id); });
    const cands = Array.from(doc.getElementsByTagNameNS('*', '*')).filter((el) => /FormDisplayLogic/i.test(lname(el)));
    const texts = (el) => {
      const t = [];
      for (const a of el.attributes) t.push(a.value);
      el.querySelectorAll('*').forEach((c) => {
        for (const a of c.attributes) t.push(a.value);
        if (!c.children.length) t.push(c.textContent);
      });
      if (!el.children.length) t.push(el.textContent);
      return t.map((x) => x.trim()).filter(Boolean);
    };
    const rule = (el) => {
      const ts = texts(el);
      const logic = ts.filter((x) => /\[[^\]]+\]/.test(x)).sort((a, b) => b.length - a.length)[0];
      const fs = new Set();
      ts.forEach((x) => x.split(/[,;|]/).forEach((p) => { if (ids.has(p.trim())) fs.add(ids.get(p.trim())); }));
      return logic && fs.size ? { logic, forms: [...fs] } : null;
    };
    const found = cands.map((el) => ({ el, r: rule(el) })).filter((x) => x.r);
    const deepest = found.filter((x) => !found.some((y) => y.el !== x.el && x.el.contains(y.el)));
    const seen = new Set();
    return deepest.map((x) => x.r).filter((r) => { const k = r.logic + '|' + r.forms.join(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function parseODM(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('Not valid XML: ' + err.textContent.split('\n')[0]);
    const root = doc.documentElement;
    if (!all(doc, 'ItemDef').length) {
      throw new Error('No <ItemDef> elements found – is this a REDCap project XML / ODM metadata export?');
    }

    const study = all(doc, 'Study')[0];
    let projectName = '';
    if (study) {
      const pn = all(study, 'ProtocolName')[0] || all(study, 'StudyName')[0];
      projectName = pn ? pn.textContent.trim() : '';
      if (!projectName) projectName = attr(study, 'OID');
    }
    const redcapVersion = attr(root, 'RedcapVersion') || attr(root, 'SourceSystemVersion');

    // Code lists (choices)
    const codeLists = {};
    all(doc, 'CodeList').forEach((cl) => {
      codeLists[attr(cl, 'OID')] = all(cl, 'CodeListItem').map((ci) => {
        const t = all(ci, 'TranslatedText')[0];
        return { code: attr(ci, 'CodedValue'), label: t ? t.textContent.trim() : '' };
      });
    });

    // Item groups -> form
    const groupItems = {};
    all(doc, 'ItemGroupDef').forEach((ig) => {
      groupItems[attr(ig, 'OID')] = kids(ig, 'ItemRef').map((r) => attr(r, 'ItemOID'));
    });
    const forms = [];
    const itemForm = {};
    all(doc, 'FormDef').forEach((fd) => {
      const oid = attr(fd, 'OID');
      const id = attr(fd, 'FormName') || oid.replace(/^Form\./, '');
      const form = { id, label: attr(fd, 'Name') || id, fields: [] };
      kids(fd, 'ItemGroupRef').forEach((r) => {
        (groupItems[attr(r, 'ItemGroupOID')] || []).forEach((io) => { if (!(io in itemForm)) itemForm[io] = form; });
      });
      forms.push(form);
    });
    const noForm = { id: '(no form)', label: '(no form)', fields: [] };

    const fields = [];
    const seenVars = new Set();
    all(doc, 'ItemDef').forEach((it) => {
      const oid = attr(it, 'OID');
      const variable = attr(it, 'Variable') || attr(it, 'Name') || oid;
      const q = all(it, 'TranslatedText')[0];
      let calc = attr(it, 'Calculation');
      if (!calc) {
        for (const a of it.attributes) if (/calc/i.test(a.localName || a.name) && !/type/i.test(a.localName || a.name)) calc = a.value;
        for (const c of it.children) if (/calc/i.test(lname(c)) && c.children.length === 0) calc = calc || c.textContent;
      }
      const clRef = kids(it, 'CodeListRef')[0];
      const f = {
        variable,
        oid,
        type: attr(it, 'FieldType') || attr(it, 'DataType'),
        label: stripHtml(q ? q.textContent : ''),
        section: stripHtml(attr(it, 'SectionHeader')),
        note: stripHtml(attr(it, 'FieldNote')),
        branching: attr(it, 'BranchingLogic'),
        calc: calc || '',
        annotation: attr(it, 'FieldAnnotation'),
        required: /^y/i.test(attr(it, 'RequiredField')),
        choices: clRef ? codeLists[attr(clRef, 'CodeListOID')] || [] : [],
        form: null,
      };
      // checkbox fields are exported as one ItemDef per option (var___1, var___2…): merge by variable
      if (seenVars.has(variable)) return;
      seenVars.add(variable);
      const cc = attr(it, 'CheckboxChoices');
      if (cc && !f.choices.length) {
        f.choices = cc.split('|').map((x) => { const i = x.indexOf(','); return { code: x.slice(0, i).trim(), label: x.slice(i + 1).trim() }; });
      }
      const form = itemForm[oid] || noForm;
      f.form = form.id;
      form.fields.push(variable);
      fields.push(f);
    });
    if (noForm.fields.length) forms.push(noForm);
    const formLogic = parseFormDisplayLogic(doc, forms);
    return { projectName: projectName || 'REDCap project', redcapVersion, forms, fields, formLogic };
  }

  RC.extractRefs = extractRefs;
  RC.parseODM = parseODM;
})(window);
