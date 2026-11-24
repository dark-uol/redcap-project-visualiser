/* REDCap ODM / project-metadata XML parser. Pure: no DOM globals beyond the DOMParser it is given via `parseODM`. */
import type {
  Choice, EmbedToken, EventDef, Field, Form, FormLogicRule, LogicSource, ParsedODM, RefToken, RepeatingInstrument,
} from './types';

type XmlRoot = Document | Element;

const lname = (n: Element): string => n.localName || n.nodeName.split(':').pop() || '';

function attr(el: Element, name: string): string {
  const l = name.toLowerCase();
  for (const a of el.attributes) if ((a.localName || a.name).toLowerCase() === l) return a.value;
  return '';
}

/** Tolerant lookup: attribute or child element whose local name equals (preferred) or contains `word`. */
function mediaVal(el: Element, word: string): string {
  const w = word.toLowerCase();
  let hit: { exact: boolean; val: string } | null = null;
  const consider = (name: string, val: string | null) => {
    const n = name.toLowerCase();
    if (!n.includes(w) || !(val || '').trim()) return;
    if (!hit || (n === w && !hit.exact)) hit = { exact: n === w, val: (val || '').trim() };
  };
  for (const a of el.attributes) consider(a.localName || a.name, a.value);
  for (const c of el.children) consider(lname(c), c.textContent);
  return hit ? (hit as { val: string }).val : '';
}

function kids(el: Element, name: string): Element[] {
  const l = name.toLowerCase();
  return Array.from(el.children).filter((c) => lname(c).toLowerCase() === l);
}

function all(root: XmlRoot, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', name));
}

const stripHtml = (s: string | null | undefined): string => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™',
  middot: '·', bull: '•',
};

/** stripHtml + single-pass decode of numeric and common named entities (labels only, never logic). */
const cleanLabel = (s: string | null | undefined): string =>
  stripHtml(s)
    .replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z]+));/g, (m: string, d?: string, h?: string, n?: string) => {
      if (n) return Object.prototype.hasOwnProperty.call(ENTITIES, n) ? ENTITIES[n] : m;
      const cp = d ? parseInt(d, 10) : parseInt(h ?? '', 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Find [variable] references in a REDCap logic / piping / action-tag string.
 * Smart variables ([event-name]) are skipped because REDCap variable names can never contain a hyphen.
 */
export function extractRefs(text: string | null | undefined): RefToken[] {
  const out: RefToken[] = [];
  if (!text) return out;
  const re = /\[([^[\]\r\n]{1,120}?)\]/g;
  const toks: { raw: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) toks.push({ raw: m[1], start: m.index, end: m.index + m[0].length });
  toks.forEach((t, i) => {
    const p = /^([A-Za-z][A-Za-z0-9_]*)(?:\(([^)]*)\))?(?::([A-Za-z0-9_]+))?$/.exec(t.raw.trim());
    if (!p) return;
    const next = toks[i + 1];
    out.push({ name: p[1], code: p[2] || '', mod: p[3] || '', adjNext: !!(next && next.start === t.end) });
  });
  return out;
}

/** Field embeddings (`{name}`, `{name:mod}`) in a label, note or section header. Stub: implemented by the extractor task. */
export function extractEmbeds(_text: string | null | undefined): EmbedToken[] {
  return [];
}

/** Smart variables ([event-name], [current-instance] …): hyphenated tokens, skipped by extractRefs. */
export function extractSmart(text: string | null | undefined): string[] {
  const out: string[] = [];
  const re = /\[([a-z]+(?:-[a-z]+)+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ''))) out.push(m[1]);
  return out;
}

/**
 * Form display logic (Project XML only, not in plain metadata exports).
 * Real REDCap exports carry FormDisplayLogicConditions elements; otherwise fall back to a structure-agnostic search.
 */
function parseFormDisplayLogic(doc: XmlRoot, forms: Form[]): FormLogicRule[] {
  const direct: FormLogicRule[] = [];
  const known = new Set(forms.map((f) => f.id));
  all(doc, 'FormDisplayLogicConditions').forEach((el) => {
    const logic = attr(el, 'control_condition'), fe = attr(el, 'forms_events');
    if (!logic || !fe) return;
    const fs = new Set<string>();
    const fev: { event: string; form: string }[] = [];
    fe.split(',').forEach((p) => {
      const parts = p.trim().split(':');
      const f = parts.pop() ?? '';
      if (known.has(f)) {
        fs.add(f);
        if (parts.length) fev.push({ event: parts.join(':'), form: f });
      }
    });
    if (fs.size) direct.push({ logic, forms: [...fs], formEvents: fev });
  });
  if (direct.length) return direct;

  const ids = new Map<string, string>();
  forms.forEach((f) => { ids.set(f.id, f.id); ids.set(f.label, f.id); });
  const cands = Array.from(doc.getElementsByTagNameNS('*', '*')).filter((el) => /FormDisplayLogic/i.test(lname(el)));
  const texts = (el: Element): string[] => {
    const t: string[] = [];
    for (const a of el.attributes) t.push(a.value);
    el.querySelectorAll('*').forEach((c) => {
      for (const a of c.attributes) t.push(a.value);
      if (!c.children.length) t.push(c.textContent ?? '');
    });
    if (!el.children.length) t.push(el.textContent ?? '');
    return t.map((x) => x.trim()).filter(Boolean);
  };
  const rule = (el: Element): FormLogicRule | null => {
    const ts = texts(el);
    const logic = ts.filter((x) => /\[[^\]]+\]/.test(x)).sort((a, b) => b.length - a.length)[0];
    const fs = new Set<string>();
    ts.forEach((x) => x.split(/[,;|]/).forEach((p) => {
      const id = ids.get(p.trim());
      if (id !== undefined) fs.add(id);
    }));
    return logic && fs.size ? { logic, forms: [...fs] } : null;
  };
  const found = cands
    .map((el) => ({ el, r: rule(el) }))
    .filter((x): x is { el: Element; r: FormLogicRule } => x.r !== null);
  const deepest = found.filter((x) => !found.some((y) => y.el !== x.el && x.el.contains(y.el)));
  const seen = new Set<string>();
  return deepest
    .map((x) => x.r)
    .filter((r) => {
      const k = r.logic + '|' + r.forms.join();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// Logic outside fields (alerts, survey queue, ...). Element names are NOT verified against a real export, so match tolerantly.
const LOGIC_KINDS: [string, RegExp][] = [
  ['survey-queue', /SurveyQueue/i], ['alert', /Alert/i], ['scheduler', /Scheduler/i], ['report', /Report/i],
  ['dashboard', /Dashboard/i], ['econsent', /EConsent/i], ['pdf-snapshot', /PdfSnapshot/i],
];
const LOGIC_MATCH = /Alert|SurveyQueue|Scheduler|Report|Dashboard|EConsent|PdfSnapshot/i;
const isLogicEl = (ln: string): boolean => LOGIC_MATCH.test(ln) && !/FormDisplayLogic/i.test(ln);

function parseLogicSources(doc: XmlRoot): LogicSource[] {
  const out: LogicSource[] = [];
  const counts: Record<string, number> = {};
  // A logic element yields a source from its own attributes/text plus non-logic descendants.
  // Logic-named children are processed recursively, so wrappers (AlertsGroup > Alert) contribute only their children.
  const processEl = (el: Element): void => {
    const ln = lname(el);
    if (!isLogicEl(ln)) return;
    let label = '';
    const vals: string[] = [];
    for (const a of el.attributes) {
      const n = a.localName || a.name;
      if (!label && /(name|title|label)$/i.test(n) && !/form/i.test(n) && a.value.trim()) label = a.value.trim();
      else vals.push(a.value);
    }
    for (const n of el.childNodes) if (n.nodeType === 3 || n.nodeType === 4) vals.push(n.nodeValue ?? '');
    // descendants: attributes + leaf text; nested logic-source elements are separate sources, so skip their subtrees
    const walk = (p: Element): void => {
      for (const c of p.children) {
        if (isLogicEl(lname(c))) { processEl(c); continue; }
        for (const a of c.attributes) vals.push(a.value);
        if (!c.children.length) vals.push(c.textContent ?? '');
        else {
          for (const n of c.childNodes) if (n.nodeType === 3 || n.nodeType === 4) vals.push(n.nodeValue ?? '');
          walk(c);
        }
      }
    };
    walk(el);
    const logics = vals.map((v) => v.trim()).filter((v) => v && extractRefs(v).length);
    if (!logics.length) return;
    const logic = logics.join('\n');
    const refs = [...new Set(extractRefs(logic).map((r) => r.name))];
    const hit = LOGIC_KINDS.find(([, re]) => re.test(ln));
    const kind = hit ? hit[0] : 'other';
    counts[kind] = (counts[kind] || 0) + 1;
    out.push({ id: kind + '-' + counts[kind], kind, label: label || ln, logic, refs });
  };
  // start only from top-level logic elements (no logic-named ancestor), so nothing is processed twice
  Array.from(doc.getElementsByTagNameNS('*', '*')).forEach((el) => {
    if (!isLogicEl(lname(el))) return;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (isLogicEl(lname(p))) return;
    }
    processEl(el);
  });
  return out;
}

export function parseODM(text: string): ParsedODM {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Not valid XML: ' + (err.textContent ?? '').split('\n')[0]);
  const root = doc.documentElement;
  if (!all(doc, 'ItemDef').length) {
    throw new Error('No <ItemDef> elements found – is this a REDCap project XML / ODM metadata export?');
  }

  const study = all(doc, 'Study')[0];
  let projectName = '';
  if (study) {
    const pn = all(study, 'ProtocolName')[0] || all(study, 'StudyName')[0];
    projectName = pn ? (pn.textContent ?? '').trim() : '';
    if (!projectName) projectName = attr(study, 'OID');
  }
  const redcapVersion = attr(root, 'RedcapVersion') || attr(root, 'SourceSystemVersion');

  // Code lists (choices)
  const codeLists: Record<string, Choice[]> = {};
  all(doc, 'CodeList').forEach((cl) => {
    codeLists[attr(cl, 'OID')] = all(cl, 'CodeListItem').map((ci) => {
      const t = all(ci, 'TranslatedText')[0];
      return { code: attr(ci, 'CodedValue'), label: t ? (t.textContent ?? '').trim() : '' };
    });
  });

  // Item groups -> form
  const groupItems: Record<string, string[]> = {};
  all(doc, 'ItemGroupDef').forEach((ig) => {
    groupItems[attr(ig, 'OID')] = kids(ig, 'ItemRef').map((r) => attr(r, 'ItemOID'));
  });
  const forms: Form[] = [];
  const itemForm: Record<string, Form> = {};
  all(doc, 'FormDef').forEach((fd) => {
    const oid = attr(fd, 'OID');
    const id = attr(fd, 'FormName') || oid.replace(/^Form\./, '');
    const form: Form = { id, label: attr(fd, 'Name') || id, repeating: /^y/i.test(attr(fd, 'Repeating')), fields: [] };
    kids(fd, 'ItemGroupRef').forEach((r) => {
      (groupItems[attr(r, 'ItemGroupOID')] || []).forEach((io) => { if (!(io in itemForm)) itemForm[io] = form; });
    });
    forms.push(form);
  });
  const noForm: Form = { id: '(no form)', label: '(no form)', repeating: false, fields: [] };
  const repeatingInstruments: RepeatingInstrument[] = all(doc, 'RepeatingInstrument').map((ri) => ({
    form: attr(ri, 'FormName'), event: attr(ri, 'UniqueEventName'), label: attr(ri, 'CustomLabel'),
  }));

  const fields: Field[] = [];
  const seenVars = new Set<string>();
  all(doc, 'ItemDef').forEach((it) => {
    const oid = attr(it, 'OID');
    const variable = attr(it, 'Variable') || attr(it, 'Name') || oid;
    const qPlain = all(it, 'TranslatedText')[0];
    const plainText = qPlain ? stripHtml(qPlain.textContent) : '';
    const qFmt = plainText ? null : all(it, 'FormattedTranslatedText').find((x) => cleanLabel(x.textContent)) || null;
    let calc = attr(it, 'Calculation');
    if (!calc) {
      for (const a of it.attributes) {
        const n = a.localName || a.name;
        if (/calc/i.test(n) && !/type/i.test(n)) calc = a.value;
      }
      for (const c of it.children) {
        if (/calc/i.test(lname(c)) && c.children.length === 0) calc = calc || (c.textContent ?? '');
      }
    }
    const clRef = kids(it, 'CodeListRef')[0];
    const media = {
      inlineImage: mediaVal(it, 'InlineImage'),
      videoUrl: mediaVal(it, 'VideoUrl'),
      videoInline: /^(y|yes|true|1)$/i.test(mediaVal(it, 'VideoDisplayInline')),
    };
    const f: Field = {
      variable,
      oid,
      type: attr(it, 'FieldType') || attr(it, 'DataType'),
      label: plainText || cleanLabel(qFmt ? qFmt.textContent : ''),
      section: stripHtml(attr(it, 'SectionHeader')),
      note: stripHtml(attr(it, 'FieldNote')),
      branching: attr(it, 'BranchingLogic'),
      calc: calc || '',
      annotation: attr(it, 'FieldAnnotation'),
      required: /^y/i.test(attr(it, 'RequiredField')),
      choices: clRef ? codeLists[attr(clRef, 'CodeListOID')] || [] : [],
      media,
      form: '',
    };
    // checkbox fields are exported as one ItemDef per option (var___1, var___2…): merge by variable
    if (seenVars.has(variable)) return;
    seenVars.add(variable);
    const cc = attr(it, 'CheckboxChoices');
    if (cc && !f.choices.length) {
      f.choices = cc.split('|').map((x) => {
        const i = x.indexOf(',');
        return { code: x.slice(0, i).trim(), label: x.slice(i + 1).trim() };
      });
    }
    const form = itemForm[oid] || noForm;
    f.form = form.id;
    form.fields.push(variable);
    fields.push(f);
  });
  if (noForm.fields.length) forms.push(noForm);
  const formLogic = parseFormDisplayLogic(doc, forms);

  // Events / arms (longitudinal projects): StudyEventDef carries redcap:UniqueEventName, ArmNum, ArmName.
  const formByOid: Record<string, string | undefined> = {};
  all(doc, 'FormDef').forEach((fd, i) => { formByOid[attr(fd, 'OID')] = forms[i] && forms[i].id; });
  const events: EventDef[] = all(doc, 'StudyEventDef').map((se) => {
    const oid = attr(se, 'OID');
    return {
      id: attr(se, 'UniqueEventName') || oid.replace(/^Event\./, ''),
      label: attr(se, 'Name') || oid,
      arm: attr(se, 'ArmNum'),
      armName: attr(se, 'ArmName'),
      repeating: /^y/i.test(attr(se, 'Repeating')),
      forms: all(se, 'FormRef')
        .map((r) => formByOid[attr(r, 'FormOID')])
        .filter((x): x is string => Boolean(x)),
    };
  });
  const arms: ParsedODM['arms'] = [];
  events.forEach((e) => {
    if (e.arm && !arms.some((a) => a.num === e.arm)) arms.push({ num: e.arm, name: e.armName || 'Arm ' + e.arm });
  });
  return {
    projectName: projectName || 'REDCap project',
    redcapVersion,
    forms,
    fields,
    formLogic,
    logicSources: parseLogicSources(doc),
    events,
    arms,
    repeatingInstruments,
  };
}
