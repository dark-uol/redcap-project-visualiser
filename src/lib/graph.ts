/* Dependency model, analysis (cycles, depth, hubs) and view building. */
import { extractRefs, extractSmart } from './parser';
import { groupFormIdOf, instanceFieldIdFor, instanceIdFor } from './selection';
import type {
  Analysis, DepType, Edge, EventDef, Field, Form, FormNode, GhostNode, LogicNode, Model, ModelBase,
  NeighborDir, NodeInfo, ParsedODM, RefToken, TypeMeta, View, ViewEdge, ViewFilter, ViewGroup, ViewNode, ViewOptions,
} from './types';

export type { Model } from './types';

export const TYPES: Record<DepType, TypeMeta> = {
  branching: { label: 'Branching logic', color: '#2563eb' },
  calc: { label: 'Calculation', color: '#ea580c' },
  piping: { label: 'Piping (labels/notes)', color: '#16a34a' },
  actiontag: { label: 'Action tags', color: '#9333ea' },
  formlogic: { label: 'Form display logic', color: '#0891b2' },
  logicsrc: { label: 'Other logic sources (alerts, queue…)', color: '#be185d' },
};

const LOGIC_TYPES = new Set<DepType>(['branching', 'calc', 'actiontag']); // used for cycle detection
/** Smart variables that depend on the current event / instance context rather than on another field. */
const CONTEXT_SMART = /^(event-name|event-label|event-number|arm-name|arm-number|current-instance|first-instance|last-instance|previous-instance|next-instance|previous-event-name|next-event-name|first-event-name|last-event-name)$/;
const UNKNOWN_FORM = '(unknown)';
const LOGIC_FORM = '(logic sources)';

/** Accumulator for an aggregated (form / event / instance) edge before its counts are finalised. */
interface EdgeAcc extends ViewEdge {
  deps: Set<string>;
  typeDeps: Partial<Record<DepType, Set<string>>>;
}

const newAcc = (from: string, to: string): EdgeAcc => ({
  from, to, types: [], count: 0, byType: {}, deps: new Set(), typeDeps: {},
});

/** Record one underlying dependency (`dep` = the dependent field) on an aggregated edge. */
function addDep(m: EdgeAcc, type: DepType, dep: string): void {
  m.deps.add(dep);
  (m.typeDeps[type] = m.typeDeps[type] || new Set()).add(dep);
  if (!m.types.includes(type)) m.types.push(type);
}

/** Finalise counts: count = distinct dependent fields, byType = per type. */
function finishAcc(m: EdgeAcc): void {
  m.count = m.deps.size;
  (Object.keys(m.typeDeps) as DepType[]).forEach((t) => { m.byType[t] = m.typeDeps[t]?.size ?? 0; });
}

/**
 * Attach the event prefix and smart variables of the reference at `toks[index]` to its edge. An event applies only to
 * the token it directly prefixes (`[evt][var]`), so only the token just before `index` is checked, and only if adjacent.
 */
function annotateRefEdge(edge: Edge | undefined, toks: RefToken[], index: number, eventIds: Set<string>, smart: string[]): void {
  if (!edge) return;
  const prev = toks[index - 1];
  const evs = prev && prev.adjNext && eventIds.has(prev.name) ? [prev.name] : [];
  if (evs.length) edge.events = [...new Set([...(edge.events || []), ...evs])];
  if (smart.length) edge.smart = [...new Set([...(edge.smart || []), ...smart])];
}

export function buildModel(parsed: ParsedODM): Model {
  const byVar = new Map<string, Field>();
  parsed.fields.forEach((f) => byVar.set(f.variable, f));
  const ghosts = new Map<string, GhostNode>();
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const edgeByKey = new Map<string, Edge>();
  const selfRefs: ModelBase['selfRefs'] = [];
  const eventIds = new Set((parsed.events || []).map((e) => e.id));
  const smartDeps: ModelBase['smartDeps'] = new Map();

  // <form>_complete status pseudo-fields are valid references but not ItemDefs
  parsed.forms.forEach((fm) => {
    const v = fm.id + '_complete';
    if (!byVar.has(v)) {
      byVar.set(v, {
        variable: v, oid: v, type: 'form_status', label: 'Form status of “' + fm.label + '”', section: '', note: '',
        branching: '', calc: '', annotation: '', required: false,
        choices: [{ code: '0', label: 'Incomplete' }, { code: '1', label: 'Unverified' }, { code: '2', label: 'Complete' }],
        form: fm.id, synthetic: true,
      });
    }
  });

  function add(from: string, to: string, type: DepType, expr: string, cross: boolean): Edge | undefined {
    const missing = !byVar.has(from);
    if (missing && !ghosts.has(from)) {
      ghosts.set(from, { variable: from, type: 'missing', label: 'not defined in this project', form: UNKNOWN_FORM, ghost: true });
    }
    if (from === to) { selfRefs.push({ field: to, type, expr }); return undefined; }
    const key = from + '\u0000' + to + '\u0000' + type;
    if (seen.has(key)) return edgeByKey.get(key);
    seen.add(key);
    const edge: Edge = { from, to, type, expr, cross, missing };
    edgeByKey.set(key, edge);
    edges.push(edge);
    return edge;
  }

  parsed.fields.forEach((f) => {
    const sources: [DepType, string][] = [
      ['branching', f.branching],
      ['calc', f.calc],
      ['piping', [f.label, f.note, f.section].filter(Boolean).join(' \n ')],
      ['actiontag', /@/.test(f.annotation || '') ? f.annotation : ''],
    ];
    sources.forEach(([type, text]) => {
      if (!text) return;
      const crossRef = /\]\s*\[/.test(text) && type !== 'piping';
      const smart = extractSmart(text);
      const contextSmart = smart.filter((name) => CONTEXT_SMART.test(name));
      if (contextSmart.length) {
        const list = smartDeps.get(f.variable) ?? [];
        list.push({ type, smart: contextSmart });
        smartDeps.set(f.variable, list);
      }
      const toks = extractRefs(text);
      toks.forEach((r, i) => {
        // [event][var]: an unknown name directly followed by another token is an event prefix
        if (r.adjNext && !byVar.has(r.name)) return;
        const e = add(r.name, f.variable, type, text.trim(), false);
        if (e && crossRef) e.cross = true;
        annotateRefEdge(e, toks, i, eventIds, smart);
      });
    });
  });

  const formNodes = new Map<string, FormNode>();
  (parsed.formLogic || []).forEach((rule) => {
    rule.forms.forEach((fid) => {
      const node = 'form:' + fid;
      const fm = parsed.forms.find((x) => x.id === fid);
      // one node per form, accumulating every display rule that applies to it
      let fn = formNodes.get(node);
      if (!fn) {
        fn = { variable: node, type: 'formnode', label: fm ? fm.label : fid, form: fid, formNode: true, logic: [], logicEvents: [] };
        formNodes.set(node, fn);
      }
      fn.logic.push(rule.logic);
      // REDCap unique event names this rule applies the form in (empty = all events)
      fn.logicEvents.push((rule.formEvents || []).filter((x) => x.form === fid).map((x) => x.event));
      const toks = extractRefs(rule.logic);
      const smart = extractSmart(rule.logic);
      toks.forEach((r, i) => {
        if (r.adjNext && !byVar.has(r.name)) return;
        const e = add(r.name, node, 'formlogic', rule.logic.trim(), false);
        annotateRefEdge(e, toks, i, eventIds, smart);
        if (e) { // the rule applies only to the listed events' instances of this form (none listed = every event)
          const evs = (rule.formEvents || []).filter((x) => x.form === fid).map((x) => x.event);
          if (!evs.length) e.tgtAllEvents = true;
          else if (!e.tgtAllEvents) e.tgtEvents = [...new Set([...(e.tgtEvents || []), ...evs])];
        }
      });
    });
  });

  // logic outside fields (alerts, survey queue, ...): one node each, fed by the existing fields it references
  const logicNodes = new Map<string, LogicNode>();
  (parsed.logicSources || []).forEach((src) => {
    const node = 'logic:' + src.id;
    const toks = extractRefs(src.logic);
    if (!toks.some((r) => byVar.has(r.name))) return;
    const smart = extractSmart(src.logic);
    logicNodes.set(node, { variable: node, type: 'logicnode', label: src.label, form: LOGIC_FORM, logicNode: true, kind: src.kind, logic: src.logic });
    toks.forEach((r, i) => {
      // event prefixes are unknown names, so they are skipped here as in the field loop
      if (r.adjNext && !byVar.has(r.name)) return;
      if (!byVar.has(r.name)) return; // logic sources feed only from known fields, never ghosts
      annotateRefEdge(add(r.name, node, 'logicsrc', src.logic.trim(), false), toks, i, eventIds, smart);
    });
  });

  const formsById = new Map<string, Form>(parsed.forms.map((x) => [x.id, x]));
  const base: ModelBase = { parsed, byVar, ghosts, formNodes, logicNodes, edges, selfRefs, formsById, smartDeps };
  return { ...base, analysis: analyse(base) };
}

/** The node behind an id, if the model knows it. */
export function findNode(model: ModelBase, v: string): NodeInfo | undefined {
  return model.byVar.get(v) || model.ghosts.get(v) || model.formNodes.get(v) || model.logicNodes.get(v);
}

/** The node behind an id that the caller knows is in the model. */
export function nodeInfo(model: ModelBase, v: string): NodeInfo {
  return findNode(model, v) as NodeInfo;
}

function analyse(model: ModelBase): Analysis {
  const vars = [...model.byVar.keys()];
  const realVars = model.parsed.fields.map((f) => f.variable);
  const out = new Map<string, Edge[]>(), inn = new Map<string, Edge[]>();
  [...vars, ...model.ghosts.keys(), ...model.formNodes.keys(), ...model.logicNodes.keys()].forEach((v) => {
    out.set(v, []);
    inn.set(v, []);
  });
  model.edges.forEach((e) => { out.get(e.from)?.push(e); inn.get(e.to)?.push(e); });

  // Tarjan SCC on logic edges (recursive; REDCap projects are small)
  const adj = new Map<string, string[]>();
  out.forEach((es, v) => adj.set(v, es.filter((e) => LOGIC_TYPES.has(e.type)).map((e) => e.to)));
  let idx = 0;
  const index = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>();
  const stack: string[] = [], sccs: string[][] = [];
  function strong(v: string): void {
    index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do { w = stack.pop(); if (w === undefined) break; on.delete(w); comp.push(w); } while (w !== v);
      sccs.push(comp);
    }
  }
  adj.forEach((_, v) => { if (!index.has(v)) strong(v); });
  const cycles = sccs.filter((c) => c.length > 1).map((c) => c.reverse());
  const compOf = new Map<string, number>();
  sccs.forEach((c, i) => c.forEach((v) => compOf.set(v, i)));

  // longest dependency chain (over logic edges, condensed)
  const memo = new Map<number, number>();
  function depth(c: number): number {
    if (memo.has(c)) return memo.get(c) as number;
    memo.set(c, 0);
    let best = 0;
    sccs[c].forEach((v) => (adj.get(v) ?? []).forEach((w) => {
      const cw = compOf.get(w);
      if (cw !== undefined && cw !== c) best = Math.max(best, 1 + depth(cw));
    }));
    memo.set(c, best);
    return best;
  }
  let maxChain = 0;
  sccs.forEach((_, c) => { maxChain = Math.max(maxChain, depth(c)); });

  const degree = new Map<string, { in: number; out: number }>();
  vars.forEach((v) => degree.set(v, {
    in: (inn.get(v) ?? []).filter((e) => e.type !== 'logicsrc').length,
    out: (out.get(v) ?? []).filter((e) => e.type !== 'logicsrc').length,
  }));
  const isolated = realVars.filter((v) => !inn.get(v)?.length && !out.get(v)?.length);
  const hubs = vars
    .map((v): [string, number] => [v, degree.get(v)?.out ?? 0])
    .filter((x) => x[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const heavy = vars
    .map((v): [string, number] => [v, degree.get(v)?.in ?? 0])
    .filter((x) => x[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const missing = model.edges.filter((e) => e.missing);
  const crossForm = model.edges.filter((e) =>
    !e.missing && e.type !== 'logicsrc' && nodeInfo(model, e.from).form !== nodeInfo(model, e.to).form);
  // forward references: a field depending on a field in a later position of the instrument order
  const order = new Map(vars.map((v, i) => [v, i] as [string, number]));
  const forward = model.edges.filter((e) => {
    if (e.missing || e.type !== 'branching' || model.byVar.get(e.from)?.synthetic) return false;
    const a = order.get(e.from), b = order.get(e.to);
    return a !== undefined && b !== undefined && a > b;
  });
  return { degree, isolated, hubs, heavy, cycles, maxChain, missing, crossForm, forward, out, inn };
}

/** Model edges that pass the type / missing / cross-event / instance-logic filters. */
function baseEdges(model: Model, o: ViewFilter): Edge[] {
  let edges = model.edges.filter((e) => o.types.has(e.type) && (o.showMissing || !e.missing) && (e.type !== 'logicsrc' || o.level === 'field'));
  if (o.crossOnly) edges = edges.filter((e) => e.events && e.events.length);
  if (o.instOnly) edges = edges.filter((e) => (e.smart || []).some((x) => /-instance$/.test(x)));
  return edges;
}

/** Build the view (nodes/edges/groups) that the exporters and renderers consume. */
export function buildView(model: Model, o: ViewOptions): View {
  let edges = baseEdges(model, o);
  const formOf = (v: string): string => nodeInfo(model, v).form;
  if (o.level === 'event') return eventView(model, edges, o, formOf);
  const instMode = !!o.instances && o.level === 'form' && (model.parsed.events || []).length > 0;
  const ex = !instMode && o.explore && o.explore.level === o.level && !o.explore.inst ? o.explore.set : null; // interactively expanded node set
  const exI = instMode && o.explore && o.explore.level === 'form' && o.explore.inst ? o.explore.set : null; // same, as instance node ids
  const pair = !ex && o.level === 'field' ? o.pair : null; // edges of one form -> form link (from form-level click)
  if (ex) edges = edges.filter((e) => ex.has(o.level === 'form' ? formOf(e.from) : e.from) && ex.has(o.level === 'form' ? formOf(e.to) : e.to));
  else if (pair) edges = edges.filter((e) => formOf(e.from) === pair.from && formOf(e.to) === pair.to);
  else if (!exI && o.forms && o.forms.size) {
    // a logic node has no form: it stays visible (with its edges) when a field it references is in a selected form
    const forms = o.forms;
    const vis = (v: string): boolean => (model.logicNodes.has(v) ? false : forms.has(formOf(v)));
    edges = edges.filter((e) => (model.logicNodes.has(e.to) ? vis(e.from) : model.logicNodes.has(e.from) ? vis(e.to) : vis(e.from) && vis(e.to)));
  }

  // focus (field level only)
  let focusSet: Set<string> | null = null;
  if (!ex && o.focus && model.byVar.has(o.focus) && o.level === 'field') {
    const fs = new Set<string>([o.focus]);
    focusSet = fs;
    const walk = (dir: 'up' | 'down'): void => {
      let frontier = [o.focus];
      for (let d = 0; d < o.focusDepth && frontier.length; d++) {
        const next: string[] = [];
        edges.forEach((e) => {
          const a = dir === 'up' ? e.to : e.from, b = dir === 'up' ? e.from : e.to;
          if (frontier.includes(a) && !fs.has(b)) { fs.add(b); next.push(b); }
        });
        frontier = next;
      }
    };
    if (o.focusDir !== 'down') walk('up');
    if (o.focusDir !== 'up') walk('down');
    edges = edges.filter((e) => fs.has(e.from) && fs.has(e.to));
  }

  if (instMode) return instancesView(model, edges, o, formOf, exI);
  if (o.level === 'form') return formView(model, edges, o);

  const merged = new Map<string, EdgeAcc>();
  edges.forEach((e) => {
    const k = e.from + '\u0000' + e.to;
    if (!merged.has(k)) merged.set(k, { ...newAcc(e.from, e.to), count: 1 });
    const m = merged.get(k) as EdgeAcc;
    if (!m.types.includes(e.type)) m.types.push(e.type);
  });
  const vedges = [...merged.values()];
  const used = new Set<string>();
  vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
  let names = model.parsed.fields.map((f) => f.variable).filter((v) => ex || pair || !o.forms || !o.forms.size || o.forms.has(formOf(v)));
  if (ex) names = names.filter((v) => ex.has(v));
  else if (focusSet) names = names.filter((v) => (focusSet as Set<string>).has(v));
  else if (o.hideIsolated || pair) names = names.filter((v) => used.has(v) || (!pair && smartTokensFor(model, v, o.types).length > 0));
  used.forEach((v) => {
    if ((o.showMissing && model.ghosts.has(v)) || model.formNodes.has(v) || model.logicNodes.has(v) || model.byVar.get(v)?.synthetic) {
      if (!names.includes(v)) names.push(v);
    }
  });
  const nodes: ViewNode[] = names.map((v) => {
    const f = nodeInfo(model, v);
    if (isFormNode(f)) return { id: v, label: 'Form: ' + f.label, sub: 'display logic', form: f.form, kind: 'form', focus: false };
    if (isLogicNode(f)) return { id: v, label: f.label, sub: f.kind, form: f.form, kind: 'logic', focus: false };
    const fld = f as Field | GhostNode;
    const smart = smartTokensFor(model, v, o.types);
    return {
      id: v,
      label: v,
      sub: withSmart(('label' in fld ? fld.label : '') || '', smart),
      form: fld.form,
      kind: isGhost(fld) ? 'missing' : fld.synthetic ? 'status' : fld.type === 'calc' ? 'calc' : 'field',
      focus: v === o.focus,
      ...(smart.length ? { smart } : {}),
    };
  });
  const groups: ViewGroup[] = [];
  if (o.group && (o.groupBy === 'event' || o.groupBy === 'arm') && (model.parsed.events || []).length) {
    // a field sits in the first (selected) event / arm whose schedule includes its form
    const evs = model.parsed.events.filter((e) => !o.eventSet || o.eventSet.has(e.id));
    const keyOf = (form: string): { id: string; label: string } | null => {
      const e = evs.find((x) => x.forms.includes(form));
      if (!e) return null;
      return o.groupBy === 'arm'
        ? { id: 'arm:' + e.arm, label: 'Arm ' + e.arm + (e.armName ? ': ' + e.armName : '') }
        : { id: 'event:' + e.id, label: e.label };
    };
    const m = new Map<string, ViewGroup>();
    nodes.forEach((n) => {
      const k = keyOf(n.form) || { id: 'event:(none)', label: '(not in an event)' };
      if (!m.has(k.id)) m.set(k.id, { id: k.id, label: k.label, nodes: [], noSelect: true });
      (m.get(k.id) as ViewGroup).nodes.push(n.id);
    });
    groups.push(...m.values());
  } else if (o.group) {
    const m = new Map<string, string[]>();
    nodes.forEach((n) => { if (!m.has(n.form)) m.set(n.form, []); (m.get(n.form) as string[]).push(n.id); });
    m.forEach((ids, form) => {
      const fm = model.formsById.get(form);
      groups.push({ id: form, label: fm ? fm.label : form, nodes: ids });
    });
  }
  return { level: 'field', nodes, edges: vedges, groups };
}

/** The context smart variables a field's logic uses, restricted to the enabled dependency types (first-seen order, no duplicates). */
function smartTokensFor(model: ModelBase, field: string, types: Set<DepType>): string[] {
  const out: string[] = [];
  (model.smartDeps.get(field) ?? []).forEach((dep) => {
    if (types.has(dep.type)) dep.smart.forEach((name) => { if (!out.includes(name)) out.push(name); });
  });
  return out;
}

/** Node detail text with the smart variables appended, e.g. `Label · [event-name]`. */
function withSmart(sub: string, smart: string[]): string {
  if (!smart.length) return sub;
  const tokens = '[' + smart.join(', ') + ']';
  return sub ? sub + ' · ' + tokens : tokens;
}

export const isFormNode = (n: NodeInfo): n is FormNode => 'formNode' in n;
export const isLogicNode = (n: NodeInfo): n is LogicNode => 'logicNode' in n;
export const isGhost = (n: NodeInfo): n is GhostNode => 'ghost' in n;

/**
 * Event-level view: only explicit cross-event references ([event][var]) produce edges.
 * Edge = source event (the prefix) -> every event that collects the form of the field holding the logic.
 * References without a prefix stay inside one event and are not drawn (as same-form links are not at form level).
 */
function eventView(model: Model, edges: Edge[], o: ViewFilter, formOf: (v: string) => string): View {
  const events = model.parsed.events || [];
  const shown = (e: EventDef): boolean => !o.eventSet || o.eventSet.has(e.id);
  const hosts = (form: string): EventDef[] => events.filter((e) => shown(e) && e.forms.includes(form));
  const merged = new Map<string, EdgeAcc>();
  edges.forEach((e) => {
    if (!e.events || !e.events.length) return;
    if (o.forms && o.forms.size && !(o.forms.has(formOf(e.from)) && o.forms.has(formOf(e.to)))) return;
    const targets = hosts(formOf(e.to));
    e.events.forEach((src) => {
      if (!events.some((x) => x.id === src && shown(x))) return;
      targets.forEach((t) => {
        if (t.id === src) return;
        const k = src + '\u0000' + t.id;
        if (!merged.has(k)) merged.set(k, newAcc(src, t.id));
        addDep(merged.get(k) as EdgeAcc, e.type, e.to);
      });
    });
  });
  const vedges = [...merged.values()];
  vedges.forEach(finishAcc);
  const used = new Set<string>();
  vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
  const nodes: ViewNode[] = events
    .filter((e) => shown(e) && (!o.hideIsolatedNodes || used.has(e.id)))
    .map((e) => ({
      id: e.id,
      label: e.label + (e.arm ? ' (arm ' + e.arm + ')' : ''),
      sub: e.forms.length + ' forms' + (e.repeating ? ' · repeating' : ''),
      form: e.id,
      kind: 'form',
    }));
  return { level: 'event', nodes, edges: vedges, groups: [] };
}

/** An instance of a form: a node id plus the event it is collected in (null when not in a shown event). */
interface Inst {
  id: string;
  ev: EventDef | null;
}

interface InstPair {
  s: Inst;
  t: Inst;
  cross?: boolean;
  mismatch?: boolean;
}

/**
 * Instance context shared by the Instances view and its neighbours: which shown events host each form, and
 * `pairs(e)` = the (source instance, target instance) pairs one model edge draws. Edges follow the event
 * qualifier ([event][var]) when present, otherwise stay within the same event.
 */
function instanceCtx(model: Model, o: ViewFilter, formOf: (v: string) => string) {
  const allEvents = model.parsed.events || [];
  const events = allEvents.filter((e) => !o.eventSet || o.eventSet.has(e.id));
  const hostsOf = new Map<string, EventDef[]>(); // form -> shown events collecting it
  events.forEach((ev) => ev.forms.forEach((f) => {
    if (!hostsOf.has(f)) hostsOf.set(f, []);
    const list = hostsOf.get(f) as EventDef[];
    if (!list.includes(ev)) list.push(ev);
  }));
  const idOf = (form: string, ev: EventDef): string => ((hostsOf.get(form) || []).length >= 2 ? instanceIdFor(form, ev.id) : form);
  const insts = (form: string): Inst[] => (hostsOf.get(form) || []).map((ev) => ({ id: idOf(form, ev), ev }));
  const pairs = (e: Edge): InstPair[] => {
    const fa = formOf(e.from), fb = formOf(e.to), res: InstPair[] = [];
    const qualified = !!(e.events && e.events.length);
    let tgts = insts(fb);
    const srcsAll = insts(fa);
    if (e.tgtEvents && !e.tgtAllEvents) { // form display logic: only the instances in the rule's events
      const tev = e.tgtEvents;
      const ft = tgts.filter((t) => t.ev !== null && tev.includes(t.ev.id));
      if (!ft.length) return res; // those events are hidden (or the form is in none of them): nothing to draw
      tgts = ft;
    }
    if (qualified) {
      // only the named event's instance of the source form; a hidden event or one not collecting the form draws nothing
      let srcs: Inst[] = [];
      (e.events as string[]).forEach((evId) => srcs.push(...srcsAll.filter((i) => i.ev?.id === evId)));
      srcs = srcs.filter((s, i) => srcs.findIndex((x) => x.id === s.id) === i);
      if (!srcs.length) {
        if (srcsAll.length) return res;
        srcs = [{ id: fa, ev: null }]; // source form is in no shown event: keep its plain node
      }
      const ts: Inst[] = tgts.length ? tgts : [{ id: fb, ev: null }];
      srcs.forEach((s) => ts.forEach((t) => res.push({ s, t, cross: true })));
    } else {
      const shared = srcsAll.filter((s) => tgts.some((t) => t.ev === s.ev));
      if (shared.length) shared.forEach((s) => res.push({ s, t: tgts.find((t) => t.ev === s.ev) as Inst }));
      else {
        const ss: Inst[] = srcsAll.length ? srcsAll : [{ id: fa, ev: null }];
        const ts: Inst[] = tgts.length ? tgts : [{ id: fb, ev: null }];
        ss.forEach((s) => ts.forEach((t) => res.push({ s, t, mismatch: true })));
      }
    }
    return res;
  };
  return { events, hostsOf, idOf, pairs };
}

/**
 * Form-level "Instances" view: a form collected in several shown events becomes one node per (form, event).
 * `ex` (explore set of instance ids) restricts the nodes; o.expanded instances open into their linked fields.
 */
function instancesView(model: Model, edges: Edge[], o: ViewOptions, formOf: (v: string) => string, ex: Set<string> | null): View {
  const { hostsOf, idOf, pairs } = instanceCtx(model, o, formOf);
  const xp = o.expanded && o.expanded.size ? o.expanded : null;
  const fid = (v: string, inst: string): string => instanceFieldIdFor(v, inst);
  const relRe = /^(previous|next)-/;
  const merged = new Map<string, EdgeAcc>(), imerged = new Map<string, EdgeAcc>();
  const usedF = new Map<string, Set<string>>(); // expanded instance id -> variables
  const link = (map: Map<string, EdgeAcc>, e: Edge, a: string, b: string, src: Inst, tgt: Inst, p: InstPair, fieldLevel: boolean) => {
    const k = a + '\u0000' + b;
    if (!map.has(k)) map.set(k, newAcc(a, b));
    const m = map.get(k) as EdgeAcc;
    if (fieldLevel) m.fieldLevel = true;
    addDep(m, e.type, e.to);
    if (p.cross) m.cross = true;
    if (p.mismatch) m.mismatch = true;
    if ((e.smart || []).some((x) => relRe.test(x))) m.relative = true;
    if (src.ev && tgt.ev && src.ev.arm !== tgt.ev.arm) m.crossArm = true;
  };
  const markUsed = (inst: string, v: string) => {
    if (!usedF.has(inst)) usedF.set(inst, new Set());
    (usedF.get(inst) as Set<string>).add(v);
  };
  edges.forEach((e) => {
    const fa = formOf(e.from), fb = formOf(e.to);
    if (!ex && o.forms && o.forms.size && !(o.forms.has(fa) && o.forms.has(fb))) return;
    pairs(e).forEach((p) => {
      const s = p.s, t = p.t;
      if (ex && !(ex.has(s.id) && ex.has(t.id))) return;
      if (s.id === t.id) { // inside one instance: only drawn between fields of an expanded instance
        if (!(xp && xp.has(s.id))) return;
      }
      const sx = !!xp && xp.has(s.id), tx = !!xp && xp.has(t.id);
      const a = sx ? fid(e.from, s.id) : s.id, b = tx ? fid(e.to, t.id) : t.id;
      if (a === b) return;
      if (sx) markUsed(s.id, e.from);
      if (tx) markUsed(t.id, e.to);
      link(merged, e, a, b, s, t, p, sx && tx);
      if (s.id !== t.id) link(imerged, e, s.id, t.id, s, t, p, false);
    });
  });
  const vedges = [...merged.values()];
  vedges.forEach(finishAcc);
  const iedges = [...imerged.values()];
  iedges.forEach(finishAcc);
  const used = new Set<string>();
  iedges.forEach((e) => { used.add(e.from); used.add(e.to); });
  usedF.forEach((_, id) => used.add(id));

  const nodes: ViewNode[] = [];
  const evOfNode = new Map<string, EventDef | null>();
  model.parsed.forms.forEach((f) => {
    if (!ex && o.forms && o.forms.size && !o.forms.has(f.id)) return;
    const hs = hostsOf.get(f.id) || [];
    const list: (EventDef | null)[] = hs.length ? hs : [null];
    list.forEach((ev) => {
      const id = ev ? idOf(f.id, ev) : f.id;
      if (ex ? !ex.has(id) : (o.hideIsolatedNodes && !used.has(id))) return;
      const sub = ev
        ? ev.label + (ev.repeating ? ' ↻' : '') + (o.groupBy === 'arm' && ev.arm ? ' (arm ' + ev.arm + ')' : '')
        : f.fields.length + ' fields';
      const repeating = ev ? isRepeatingInstance(model.parsed, f, ev.id) : f.repeating;
      nodes.push({ id, label: f.label + (repeating ? ' ↻' : ''), sub, form: f.id, event: ev ? ev.id : null, kind: 'form' });
      evOfNode.set(id, ev);
    });
  });
  if (used.has(UNKNOWN_FORM) || (ex && ex.has(UNKNOWN_FORM))) {
    const names = [...new Set(edges.filter((e) => formOf(e.from) === UNKNOWN_FORM).map((e) => e.from))];
    const extra = names.slice(0, 6).map((n) => '[' + n + ']');
    if (names.length > 6) extra.push('+' + (names.length - 6) + ' more');
    nodes.push({ id: UNKNOWN_FORM, label: 'Undefined fields', sub: '', extra, form: UNKNOWN_FORM, event: null, kind: 'missing' });
  }
  const gm = new Map<string, ViewGroup>();
  nodes.forEach((n) => {
    const ev = evOfNode.get(n.id);
    let k: { id: string; label: string };
    if (!ev) k = { id: 'event:(none)', label: '(not in an event)' };
    else if (o.groupBy === 'arm') k = { id: 'arm:' + ev.arm, label: 'Arm ' + ev.arm + (ev.armName ? ': ' + ev.armName : '') };
    else k = { id: 'event:' + ev.id, label: ev.label };
    if (!gm.has(k.id)) gm.set(k.id, { id: k.id, label: k.label, nodes: [], noSelect: true });
    (gm.get(k.id) as ViewGroup).nodes.push(n.id);
    n.band = k.id;
  });
  const groups: ViewGroup[] = o.groupBy === 'none' ? [] : [...gm.values()];
  let outNodes = nodes;
  const expandedNodes: ViewNode[] = [];
  if (xp) {
    outNodes = [];
    const clusters: ViewGroup[] = [];
    nodes.forEach((n) => {
      const used0 = usedF.get(n.id) || new Set<string>();
      const fm = model.formsById.get(n.form);
      const order = fm ? fm.fields : [];
      // with "hide fields with no dependencies" off, an expanded instance lists every field, linked or not
      const vs = o.hideIsolated
        ? [...order.filter((v) => used0.has(v)), ...[...used0].filter((v) => !order.includes(v))]
        : [...order, ...[...used0].filter((v) => !order.includes(v))];
      if (!xp.has(n.id) || !vs.length) { outNodes.push(n); return; }
      const ids: string[] = [];
      vs.forEach((v) => {
        const f = nodeInfo(model, v), id = fid(v, n.id);
        ids.push(id);
        outNodes.push(isFormNode(f)
          ? { id, label: 'Form: ' + f.label, sub: 'display logic', form: n.form, event: n.event, field: v, kind: 'form' }
          : { id, label: v, sub: ('label' in f ? f.label : '') || '', form: n.form, event: n.event, field: v, kind: (f as Field).synthetic ? 'status' : (f as Field).type === 'calc' ? 'calc' : 'field' });
      });
      expandedNodes.push(n);
      const band = groups.find((g) => g.id === n.band);
      if (band) band.nodes = band.nodes.filter((x) => x !== n.id);
      clusters.push({ id: n.id, label: n.label + (n.event ? ' @ ' + n.sub : ''), nodes: ids, parent: band ? band.id : undefined });
    });
    groups.push(...clusters);
  }
  nodes.forEach((n) => { delete n.band; });
  const view: View = { level: 'form', instances: true, nodes: outNodes, edges: vedges, groups, instEdges: iedges };
  if (expandedNodes.length) { view.mixed = true; view.expandedNodes = expandedNodes; }
  return view;
}

function formView(model: Model, edges: Edge[], o: ViewFilter): View {
  const merged = new Map<string, EdgeAcc>();
  edges.forEach((e) => {
    const a = nodeInfo(model, e.from).form, b = nodeInfo(model, e.to).form;
    if (a === b) return;
    const k = a + '\u0000' + b;
    if (!merged.has(k)) merged.set(k, newAcc(a, b));
    addDep(merged.get(k) as EdgeAcc, e.type, e.to);
  });
  const vedges = [...merged.values()];
  // thickness/labels = number of distinct dependent fields on the target side
  vedges.forEach(finishAcc);
  const used = new Set<string>();
  vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
  const nodes: ViewNode[] = [];
  const ex = o.explore && o.explore.level === 'form' ? o.explore.set : null;
  model.parsed.forms.forEach((f) => {
    if (ex) { if (!ex.has(f.id)) return; }
    else {
      if (o.forms && o.forms.size && !o.forms.has(f.id)) return;
      if (o.hideIsolatedNodes && !used.has(f.id)) return;
    }
    nodes.push({ id: f.id, label: f.label + (formIsRepeating(model.parsed, f) ? ' ↻' : ''), sub: f.fields.length + ' fields', form: f.id, kind: 'form' });
  });
  if (used.has(UNKNOWN_FORM) || (ex && ex.has(UNKNOWN_FORM))) {
    const names = [...new Set(edges.filter((e) => nodeInfo(model, e.from).form === UNKNOWN_FORM).map((e) => e.from))];
    const extra = names.slice(0, 6).map((n) => '[' + n + ']');
    if (names.length > 6) extra.push('+' + (names.length - 6) + ' more');
    nodes.push({ id: UNKNOWN_FORM, label: 'Undefined fields', sub: '', extra, form: UNKNOWN_FORM, kind: 'missing' });
  }
  const xp = o.expanded && o.expanded.size ? o.expanded : null;
  if (xp && nodes.some((n) => xp.has(n.id))) return mixedView(model, edges, o, nodes, xp);
  return { level: 'form', nodes, edges: vedges, groups: [] };
}

/** Form-level view where some forms are expanded in place into their linked fields (semantic zoom). */
function mixedView(model: Model, edges: Edge[], o: ViewFilter, formNodes: ViewNode[], xp: Set<string>): View {
  const vis = new Set(formNodes.map((n) => n.id));
  const formOf = (v: string): string => nodeInfo(model, v).form;
  const ep = (v: string): string => (xp.has(formOf(v)) ? v : formOf(v));
  const merged = new Map<string, EdgeAcc>();
  edges.forEach((e) => {
    const fa = formOf(e.from), fb = formOf(e.to);
    if (!vis.has(fa) || !vis.has(fb)) return;
    const a = ep(e.from), b = ep(e.to);
    if (a === b) return;
    const k = a + '\u0000' + b;
    if (!merged.has(k)) {
      const m = newAcc(a, b);
      m.fieldLevel = xp.has(fa) && xp.has(fb);
      merged.set(k, m);
    }
    addDep(merged.get(k) as EdgeAcc, e.type, e.to);
  });
  const vedges = [...merged.values()];
  vedges.forEach(finishAcc);
  const used = new Set<string>();
  vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
  const nodes: ViewNode[] = [], groups: ViewGroup[] = [];
  formNodes.forEach((n) => {
    if (!xp.has(n.id)) { nodes.push(n); return; }
    const fm = model.formsById.get(n.id);
    const order = fm ? fm.fields : [];
    const extra = [...used].filter((v) => findNode(model, v) && !order.includes(v) && formOf(v) === n.id);
    // with "hide fields with no dependencies" off, an expanded form lists every field, linked or not
    const ids = [...(o.hideIsolated ? order.filter((v) => used.has(v)) : order), ...extra];
    if (!ids.length) { nodes.push(n); return; }
    ids.forEach((v) => {
      const f = nodeInfo(model, v);
      nodes.push(isFormNode(f)
        ? { id: v, label: 'Form: ' + f.label, sub: 'display logic', form: n.id, kind: 'form' }
        : { id: v, label: v, sub: ('label' in f ? f.label : '') || '', form: n.id, kind: (f as Field).synthetic ? 'status' : (f as Field).type === 'calc' ? 'calc' : 'field' });
    });
    groups.push({ id: n.id, label: n.label, nodes: ids });
  });
  return { level: 'form', mixed: true, nodes, edges: vedges, groups };
}

/** Ids reachable in one step from `id` ('up' = what it depends on, 'down' = what depends on it) at the view's level. */
export function neighbors(model: Model, o: ViewFilter, id: string, dir: NeighborDir): string[] {
  const formOf = (v: string): string => nodeInfo(model, v).form;
  const key = o.level === 'form' ? formOf : (v: string) => v;
  const out = new Set<string>();
  if (o.instances && o.level === 'form' && (dir === 'up' || dir === 'down')) { // Instances: adjacent instance nodes
    const ctx = instanceCtx(model, o, formOf);
    baseEdges(model, o).forEach((e) => ctx.pairs(e).forEach((p) => {
      if (p.s.id === p.t.id) return;
      if (dir === 'up' && p.t.id === id) out.add(p.s.id);
      if (dir === 'down' && p.s.id === id) out.add(p.t.id);
    }));
    return [...out];
  }
  if (dir === 'fup' || dir === 'fdown') { // field level: every cross-form link into / out of this node's form (both endpoints)
    const F = groupFormIdOf(id) ?? formOf(id);
    model.edges.forEach((e) => {
      if (!o.types.has(e.type) || (!o.showMissing && e.missing) || e.type === 'logicsrc') return;
      const fa = formOf(e.from), fb = formOf(e.to);
      if (fa === fb) return;
      if ((dir === 'fup' && fb === F) || (dir === 'fdown' && fa === F)) { out.add(e.from); out.add(e.to); }
    });
    out.delete(id);
    return [...out];
  }
  model.edges.forEach((e) => {
    if (!o.types.has(e.type) || (!o.showMissing && e.missing) || (e.type === 'logicsrc' && o.level !== 'field')) return;
    const a = key(e.from), b = key(e.to);
    if (a === b) return;
    if (dir === 'up' && b === id) out.add(a);
    if (dir === 'down' && a === id) out.add(b);
  });
  return [...out];
}

/**
 * Is this form repeating in this event? Assumption (REDCap semantics not verified against an export):
 * if the form has any RepeatingInstrument entries, the (form, event) pair decides; else fall back to FormDef Repeating.
 */
export function isRepeatingInstance(parsed: ParsedODM, form: Form, eventId: string): boolean {
  const ris = (parsed.repeatingInstruments || []).filter((r) => r.form === form.id);
  return ris.length ? ris.some((r) => r.event === eventId) : form.repeating;
}

/** Form-level rule: repeating in at least one event ("any event" by design) = FormDef Repeating or any RepeatingInstrument names the form. */
export function formIsRepeating(parsed: ParsedODM, form: Form): boolean {
  return form.repeating || (parsed.repeatingInstruments || []).some((r) => r.form === form.id);
}
