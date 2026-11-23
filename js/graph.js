/* Dependency model, analysis (cycles, depth, hubs) and view building. */
(function (g) {
  'use strict';
  const RC = (g.RC = g.RC || {});

  RC.TYPES = {
    branching: { label: 'Branching logic', color: '#2563eb' },
    calc: { label: 'Calculation', color: '#ea580c' },
    piping: { label: 'Piping (labels/notes)', color: '#16a34a' },
    actiontag: { label: 'Action tags', color: '#9333ea' },
    formlogic: { label: 'Form display logic', color: '#0891b2' },
  };
  const LOGIC_TYPES = new Set(['branching', 'calc', 'actiontag']); // used for cycle detection
  const UNKNOWN_FORM = '(unknown)';

  function buildModel(parsed) {
    const byVar = new Map();
    parsed.fields.forEach((f) => byVar.set(f.variable, f));
    const ghosts = new Map();
    const edges = [];
    const seen = new Set();
    const edgeByKey = new Map();
    const selfRefs = [];
    const eventIds = new Set((parsed.events || []).map((e) => e.id));

    // <form>_complete status pseudo-fields are valid references but not ItemDefs
    parsed.forms.forEach((fm) => {
      const v = fm.id + '_complete';
      if (!byVar.has(v)) byVar.set(v, { variable: v, oid: v, type: 'form_status', label: 'Form status of “' + fm.label + '”', section: '', note: '', branching: '', calc: '', annotation: '', required: false, choices: [{ code: '0', label: 'Incomplete' }, { code: '1', label: 'Unverified' }, { code: '2', label: 'Complete' }], form: fm.id, synthetic: true });
    });

    function add(from, to, type, expr, cross) {
      const missing = !byVar.has(from);
      if (missing && !ghosts.has(from)) {
        ghosts.set(from, { variable: from, type: 'missing', label: 'not defined in this project', form: UNKNOWN_FORM, ghost: true });
      }
      if (from === to) { selfRefs.push({ field: to, type, expr }); return; }
      const key = from + '\u0000' + to + '\u0000' + type;
      if (seen.has(key)) return edgeByKey.get(key);
      seen.add(key);
      const edge = { from, to, type, expr, cross, missing };
      edgeByKey.set(key, edge);
      edges.push(edge);
      return edge;
    }

    parsed.fields.forEach((f) => {
      const sources = [
        ['branching', f.branching],
        ['calc', f.calc],
        ['piping', [f.label, f.note, f.section].filter(Boolean).join(' \n ')],
        ['actiontag', /@/.test(f.annotation || '') ? f.annotation : ''],
      ];
      sources.forEach(([type, text]) => {
        if (!text) return;
        const crossRef = /\]\s*\[/.test(text) && type !== 'piping';
        const smart = RC.extractSmart(text);
        const toks = RC.extractRefs(text);
        toks.forEach((r, i) => {
          // the event applies only to the token it directly prefixes
          const prev = toks[i - 1];
          const evs = prev && prev.adjNext && eventIds.has(prev.name) ? [prev.name] : [];
          // [event][var]: an unknown name directly followed by another token is an event prefix
          if (r.adjNext && !byVar.has(r.name)) return;
          const e = add(r.name, f.variable, type, text.trim(), false);
          if (e && crossRef) e.cross = true;
          if (e) {
            if (evs.length) e.events = [...new Set([...(e.events || []), ...evs])];
            if (smart.length) e.smart = [...new Set([...(e.smart || []), ...smart])];
          }
        });
      });
    });

    const formNodes = new Map();
    (parsed.formLogic || []).forEach((rule) => {
      rule.forms.forEach((fid) => {
        const node = 'form:' + fid;
        const fm = parsed.forms.find((x) => x.id === fid);
        formNodes.set(node, { variable: node, type: 'formnode', label: fm ? fm.label : fid, form: fid, formNode: true, logic: [] });
        formNodes.get(node).logic.push(rule.logic);
        RC.extractRefs(rule.logic).forEach((r) => {
          if (r.adjNext && !byVar.has(r.name)) return;
          add(r.name, node, 'formlogic', rule.logic.trim(), false);
        });
      });
    });
    const model = { parsed, byVar, ghosts, formNodes, edges, selfRefs, formsById: new Map(parsed.forms.map((x) => [x.id, x])) };
    model.analysis = analyse(model);
    return model;
  }

  function nodeInfo(model, v) { return model.byVar.get(v) || model.ghosts.get(v) || model.formNodes.get(v); }

  function analyse(model) {
    const vars = [...model.byVar.keys()];
    const realVars = model.parsed.fields.map((f) => f.variable);
    const out = new Map(), inn = new Map();
    vars.concat([...model.ghosts.keys()], [...model.formNodes.keys()]).forEach((v) => { out.set(v, []); inn.set(v, []); });
    model.edges.forEach((e) => { out.get(e.from).push(e); inn.get(e.to).push(e); });

    // Tarjan SCC on logic edges (iterative-safe enough via recursion; REDCap projects are small)
    const adj = new Map();
    out.forEach((es, v) => adj.set(v, es.filter((e) => LOGIC_TYPES.has(e.type)).map((e) => e.to)));
    let idx = 0; const index = new Map(), low = new Map(), on = new Set(), stack = [], sccs = [];
    function strong(v) {
      index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
      for (const w of adj.get(v)) {
        if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      }
      if (low.get(v) === index.get(v)) {
        const comp = []; let w;
        do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
        sccs.push(comp);
      }
    }
    adj.forEach((_, v) => { if (!index.has(v)) strong(v); });
    const cycles = sccs.filter((c) => c.length > 1).map((c) => c.reverse());
    const compOf = new Map();
    sccs.forEach((c, i) => c.forEach((v) => compOf.set(v, i)));

    // longest dependency chain (over logic edges, condensed)
    const memo = new Map();
    function depth(c) {
      if (memo.has(c)) return memo.get(c);
      memo.set(c, 0);
      let best = 0;
      sccs[c].forEach((v) => adj.get(v).forEach((w) => {
        const cw = compOf.get(w);
        if (cw !== c) best = Math.max(best, 1 + depth(cw));
      }));
      memo.set(c, best);
      return best;
    }
    let maxChain = 0;
    sccs.forEach((_, c) => { maxChain = Math.max(maxChain, depth(c)); });

    const degree = new Map();
    vars.forEach((v) => degree.set(v, { in: inn.get(v).length, out: out.get(v).length }));
    const isolated = realVars.filter((v) => !degree.get(v).in && !degree.get(v).out);
    const hubs = vars.map((v) => [v, degree.get(v).out]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const heavy = vars.map((v) => [v, degree.get(v).in]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const missing = model.edges.filter((e) => e.missing);
    const crossForm = model.edges.filter((e) => !e.missing && model.byVar.get(e.from).form !== nodeInfo(model, e.to).form);
    // forward references: a field depending on a field in a later position of the instrument order
    const order = new Map(vars.map((v, i) => [v, i]));
    const forward = model.edges.filter((e) => !e.missing && e.type === 'branching' && !model.byVar.get(e.from).synthetic && order.get(e.from) > order.get(e.to));
    return { degree, isolated, hubs, heavy, cycles, maxChain, missing, crossForm, forward, out, inn };
  }

  /** Build the view (nodes/edges/groups) that the exporters and renderers consume. */
  function buildView(model, o) {
    const A = model.analysis;
    let edges = model.edges.filter((e) => o.types.has(e.type) && (o.showMissing || !e.missing));
    if (o.crossOnly) edges = edges.filter((e) => e.events && e.events.length);
    const formOf = (v) => nodeInfo(model, v).form;
    if (o.level === 'event') return eventView(model, edges, o, formOf);
    const ex = o.explore && o.explore.level === o.level ? o.explore.set : null; // interactively expanded node set
    const pair = !ex && o.level === 'field' ? o.pair : null; // edges of one form -> form link (from form-level click)
    if (ex) edges = edges.filter((e) => ex.has(o.level === 'form' ? formOf(e.from) : e.from) && ex.has(o.level === 'form' ? formOf(e.to) : e.to));
    else if (pair) edges = edges.filter((e) => formOf(e.from) === pair.from && formOf(e.to) === pair.to);
    else if (o.forms && o.forms.size) edges = edges.filter((e) => o.forms.has(formOf(e.from)) && o.forms.has(formOf(e.to)));

    // focus (field level only)
    let focusSet = null;
    if (!ex && o.focus && model.byVar.has(o.focus) && o.level === 'field') {
      focusSet = new Set([o.focus]);
      const walk = (dir) => {
        let frontier = [o.focus];
        for (let d = 0; d < o.focusDepth && frontier.length; d++) {
          const next = [];
          edges.forEach((e) => {
            const a = dir === 'up' ? e.to : e.from, b = dir === 'up' ? e.from : e.to;
            if (frontier.includes(a) && !focusSet.has(b)) { focusSet.add(b); next.push(b); }
          });
          frontier = next;
        }
      };
      if (o.focusDir !== 'down') walk('up');
      if (o.focusDir !== 'up') walk('down');
      edges = edges.filter((e) => focusSet.has(e.from) && focusSet.has(e.to));
    }

    if (o.level === 'form') return formView(model, edges, o);

    const merged = new Map();
    edges.forEach((e) => {
      const k = e.from + '\u0000' + e.to;
      if (!merged.has(k)) merged.set(k, { from: e.from, to: e.to, types: [], count: 1 });
      const m = merged.get(k); if (!m.types.includes(e.type)) m.types.push(e.type);
    });
    const vedges = [...merged.values()];
    const used = new Set(); vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
    let names = model.parsed.fields.map((f) => f.variable).filter((v) => ex || pair || !o.forms || !o.forms.size || o.forms.has(formOf(v)));
    if (ex) names = names.filter((v) => ex.has(v));
    else if (focusSet) names = names.filter((v) => focusSet.has(v));
    else if (o.hideIsolated || pair) names = names.filter((v) => used.has(v));
    used.forEach((v) => { if ((o.showMissing && model.ghosts.has(v)) || model.formNodes.has(v) || (model.byVar.get(v) || {}).synthetic) { if (!names.includes(v)) names.push(v); } });
    const nodes = names.map((v) => {
      const f = nodeInfo(model, v);
      if (f.formNode) return { id: v, label: 'Form: ' + f.label, sub: 'display logic', form: f.form, kind: 'form', focus: false };
      return { id: v, label: v, sub: f.label || '', form: f.form, kind: f.ghost ? 'missing' : f.synthetic ? 'status' : f.type === 'calc' ? 'calc' : 'field', focus: v === o.focus };
    });
    const groups = [];
    if (o.group && (o.groupBy === 'event' || o.groupBy === 'arm') && (model.parsed.events || []).length) {
      // a field sits in the first (selected) event / arm whose schedule includes its form
      const evs = model.parsed.events.filter((e) => !o.eventSet || o.eventSet.has(e.id));
      const keyOf = (form) => {
        const e = evs.find((x) => x.forms.includes(form));
        if (!e) return null;
        return o.groupBy === 'arm' ? { id: 'arm:' + e.arm, label: 'Arm ' + e.arm + (e.armName ? ': ' + e.armName : '') } : { id: 'event:' + e.id, label: e.label };
      };
      const m = new Map();
      nodes.forEach((n) => {
        const k = keyOf(n.form) || { id: 'event:(none)', label: '(not in an event)' };
        if (!m.has(k.id)) m.set(k.id, { id: k.id, label: k.label, nodes: [], noSelect: true });
        m.get(k.id).nodes.push(n.id);
      });
      groups.push(...m.values());
    } else if (o.group) {
      const m = new Map();
      nodes.forEach((n) => { if (!m.has(n.form)) m.set(n.form, []); m.get(n.form).push(n.id); });
      m.forEach((ids, form) => {
        const fm = model.formsById.get(form);
        groups.push({ id: form, label: fm ? fm.label : form, nodes: ids });
      });
    }
    return { level: 'field', nodes, edges: vedges, groups };
  }

  /**
   * Event-level view: only explicit cross-event references ([event][var]) produce edges.
   * Edge = source event (the prefix) -> every event that collects the form of the field holding the logic.
   * References without a prefix stay inside one event and are not drawn (as same-form links are not at form level).
   */
  function eventView(model, edges, o, formOf) {
    const events = model.parsed.events || [];
    const shown = (e) => !o.eventSet || o.eventSet.has(e.id);
    const hosts = (form) => events.filter((e) => shown(e) && e.forms.includes(form));
    const merged = new Map();
    edges.forEach((e) => {
      if (!e.events || !e.events.length) return;
      if (o.forms && o.forms.size && !(o.forms.has(formOf(e.from)) && o.forms.has(formOf(e.to)))) return;
      const targets = hosts(formOf(e.to));
      e.events.forEach((src) => {
        if (!events.some((x) => x.id === src && shown(x))) return;
        targets.forEach((t) => {
          if (t.id === src) return;
          const k = src + '\u0000' + t.id;
          if (!merged.has(k)) merged.set(k, { from: src, to: t.id, types: [], count: 0, byType: {}, deps: new Set(), typeDeps: {} });
          const m = merged.get(k);
          m.deps.add(e.to); (m.typeDeps[e.type] = m.typeDeps[e.type] || new Set()).add(e.to);
          if (!m.types.includes(e.type)) m.types.push(e.type);
        });
      });
    });
    const vedges = [...merged.values()];
    vedges.forEach((m) => { m.count = m.deps.size; Object.keys(m.typeDeps).forEach((t) => { m.byType[t] = m.typeDeps[t].size; }); });
    const used = new Set(); vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
    const nodes = events.filter((e) => shown(e) && (!o.hideIsolated || used.has(e.id)))
      .map((e) => ({ id: e.id, label: e.label + (e.arm ? ' (arm ' + e.arm + ')' : ''), sub: e.forms.length + ' forms' + (e.repeating ? ' · repeating' : ''), form: e.id, kind: 'form' }));
    return { level: 'event', nodes, edges: vedges, groups: [] };
  }

  function formView(model, edges, o) {
    const merged = new Map();
    edges.forEach((e) => {
      const a = nodeInfo(model, e.from).form, b = nodeInfo(model, e.to).form;
      if (a === b) return;
      const k = a + '\u0000' + b;
      if (!merged.has(k)) merged.set(k, { from: a, to: b, types: [], count: 0, byType: {}, deps: new Set(), typeDeps: {} });
      const m = merged.get(k);
      m.deps.add(e.to); (m.typeDeps[e.type] = m.typeDeps[e.type] || new Set()).add(e.to);
      if (!m.types.includes(e.type)) m.types.push(e.type);
    });
    const vedges = [...merged.values()];
    // thickness/labels = number of distinct dependent fields on the target side
    vedges.forEach((m) => { m.count = m.deps.size; Object.keys(m.typeDeps).forEach((t) => { m.byType[t] = m.typeDeps[t].size; }); });
    const used = new Set(); vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
    const nodes = [];
    const ex = o.explore && o.explore.level === 'form' ? o.explore.set : null;
    model.parsed.forms.forEach((f) => {
      if (ex) { if (!ex.has(f.id)) return; }
      else {
        if (o.forms && o.forms.size && !o.forms.has(f.id)) return;
        if (o.hideIsolated && !used.has(f.id)) return;
      }
      nodes.push({ id: f.id, label: f.label, sub: f.fields.length + ' fields', form: f.id, kind: 'form' });
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
  function mixedView(model, edges, o, formNodes, xp) {
    const vis = new Set(formNodes.map((n) => n.id));
    const formOf = (v) => nodeInfo(model, v).form;
    const ep = (v) => (xp.has(formOf(v)) ? v : formOf(v));
    const merged = new Map();
    edges.forEach((e) => {
      const fa = formOf(e.from), fb = formOf(e.to);
      if (!vis.has(fa) || !vis.has(fb)) return;
      const a = ep(e.from), b = ep(e.to);
      if (a === b) return;
      const k = a + '\u0000' + b;
      if (!merged.has(k)) merged.set(k, { from: a, to: b, types: [], count: 0, byType: {}, deps: new Set(), typeDeps: {}, fieldLevel: xp.has(fa) && xp.has(fb) });
      const m = merged.get(k);
      m.deps.add(e.to); (m.typeDeps[e.type] = m.typeDeps[e.type] || new Set()).add(e.to);
      if (!m.types.includes(e.type)) m.types.push(e.type);
    });
    const vedges = [...merged.values()];
    vedges.forEach((m) => { m.count = m.deps.size; Object.keys(m.typeDeps).forEach((t) => { m.byType[t] = m.typeDeps[t].size; }); });
    const used = new Set(); vedges.forEach((e) => { used.add(e.from); used.add(e.to); });
    const nodes = [], groups = [];
    formNodes.forEach((n) => {
      if (!xp.has(n.id)) { nodes.push(n); return; }
      const fm = model.formsById.get(n.id), order = fm ? fm.fields : [];
      const ids = [...order.filter((v) => used.has(v)), ...[...used].filter((v) => nodeInfo(model, v) && !order.includes(v) && formOf(v) === n.id)];
      if (!ids.length) { nodes.push(n); return; }
      ids.forEach((v) => {
        const f = nodeInfo(model, v);
        nodes.push(f.formNode
          ? { id: v, label: 'Form: ' + f.label, sub: 'display logic', form: n.id, kind: 'form' }
          : { id: v, label: v, sub: f.label || '', form: n.id, kind: f.synthetic ? 'status' : f.type === 'calc' ? 'calc' : 'field' });
      });
      groups.push({ id: n.id, label: n.label, nodes: ids });
    });
    return { level: 'form', mixed: true, nodes, edges: vedges, groups };
  }

  /** Ids reachable in one step from `id` ('up' = what it depends on, 'down' = what depends on it) at the view's level. */
  RC.neighbors = function (model, o, id, dir) {
    const formOf = (v) => nodeInfo(model, v).form;
    const key = o.level === 'form' ? formOf : (v) => v;
    const out = new Set();
    if (dir === 'fup' || dir === 'fdown') { // field level: every cross-form link into / out of this node's form (both endpoints)
      const F = id.startsWith('@form:') ? id.slice(6) : formOf(id);
      model.edges.forEach((e) => {
        if (!o.types.has(e.type) || (!o.showMissing && e.missing)) return;
        const fa = formOf(e.from), fb = formOf(e.to);
        if (fa === fb) return;
        if ((dir === 'fup' && fb === F) || (dir === 'fdown' && fa === F)) { out.add(e.from); out.add(e.to); }
      });
      out.delete(id);
      return [...out];
    }
    model.edges.forEach((e) => {
      if (!o.types.has(e.type) || (!o.showMissing && e.missing)) return;
      const a = key(e.from), b = key(e.to);
      if (a === b) return;
      if (dir === 'up' && b === id) out.add(a);
      if (dir === 'down' && a === id) out.add(b);
    });
    return [...out];
  };
  RC.buildModel = buildModel;
  RC.buildView = buildView;
  RC.nodeInfo = nodeInfo;
})(window);
