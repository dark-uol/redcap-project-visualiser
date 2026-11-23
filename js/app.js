/* UI built with SolidJS (solid-js/html tagged templates: no build step, works from file://). */
(async function () {
  'use strict';
  const root = document.getElementById('root');
  let Solid;
  try { Solid = await RC.loadSolid(); } catch (e) {
    root.innerHTML = '<p style="padding:24px">Could not load SolidJS from the CDN or from <code>vendor/solid.iife.js</code>.</p>';
    return;
  }
  const { createSignal, createMemo, createEffect, on, onMount, For, Show, render, html } = Solid;
  const MAX_AUTO_EDGES = 700;
  const TYPE_KEYS = Object.keys(RC.TYPES);

  // ================= state =================
  let modelSeq = 0; // bumps on each file load; history entries from an older file are ignored
  const [model, setModel] = createSignal(null);
  const [fileBase, setFileBase] = createSignal('redcap');
  const [dragOver, setDragOver] = createSignal(false);
  const [loadError, setLoadError] = createSignal('');

  const [level, setLevel] = createSignal('form'); // open in form-level view
  const [renderer, setRenderer] = createSignal('graphviz');
  const [dir, setDir] = createSignal('LR');
  const [labelMode, setLabelMode] = createSignal('var');
  const [groupBy, setGroupBy] = createSignal('form'); // field level clusters: none | form | event | arm
  const [edgeLabels, setEdgeLabels] = createSignal(false);
  const [hideIso, setHideIso] = createSignal(true);
  const [showMissing, setShowMissing] = createSignal(true);
  const [typesOn, setTypesOn] = createSignal(Object.fromEntries(TYPE_KEYS.map((k) => [k, true])));
  const [formsOn, setFormsOn] = createSignal({}); // id -> bool (absent = on)
  const [focus, setFocus] = createSignal('');
  const [focusDir, setFocusDir] = createSignal('both');
  const [focusDepth, setFocusDepthRaw] = createSignal(3);
  const setFocusDepth = (v) => setFocusDepthRaw(Math.min(50, Math.max(1, Math.round(Number(v)) || 1)));
  const [eventsOn, setEventsOn] = createSignal({}); // event id -> bool (absent = on)
  const [instOnly, setInstOnly] = createSignal(false); // only logic using [current/first/last/previous/next-instance]
  const [instances, setInstances] = createSignal(false); // form level, longitudinal: one node per form per event
  const [crossOnly, setCrossOnly] = createSignal(false); // only references that name another event ([event][var])
  const [formQ, setFormQ] = createSignal('');
  const [pair, setPair] = createSignal(null);       // {from,to} form ids: show only the field links of one form->form edge
  const [selEdge, setSelEdge] = createSignal(null); // form-level edge clicked in the graph
  const [expanded, setExpanded] = createSignal(new Set()); // form ids expanded in place at form level
  const [explore, setExplore] = createSignal(null);   // {level, seeds:[id], exp:[{node,dir,added:[id]}]} interactive expansion

  const [tab, setTab] = createSignal('graph');
  const [dlOpen, setDlOpen] = createSignal(false);
  document.addEventListener('click', (e) => { if (!(e.target.closest && e.target.closest('.dlmenu'))) setDlOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDlOpen(false); });
  const [selected, setSelectedRaw] = createSignal(null);
  const setSelected = (v) => Solid.batch(() => { if (v) setSelEdge(null); setSelectedRaw(v); });
  const [depQ, setDepQ] = createSignal('');
  const [fieldQ, setFieldQ] = createSignal('');
  const [svgEl, setSvgEl] = createSignal(null);
  const [svgView, setSvgView] = createSignal(null); // the view svgEl was rendered from (view() may already be newer)
  const [busy, setBusy] = createSignal(false);
  const [renderMsg, setRenderMsg] = createSignal('');
  const [forcedFor, setForcedFor] = createSignal('');

  // keeps zoom + the position of the node you acted on across expand/collapse re-renders
  const viewAnchor = { capture: null, pending: null, zoomBack: new Map() };
  // ---- interactive expansion of back / forward references ----
  const exVisible = (ex) => new Set([...ex.seeds, ...ex.exp.flatMap((x) => x.added)]);
  const instMode = () => instances() && level() === 'form' && !!model() && (model().parsed.events || []).length > 0;
  const curEx = () => { const e = explore(); return e && e.level === level() && !!e.inst === instMode() ? e : null; };
  function expandRef(t, dir) {
    viewAnchor.capture && viewAnchor.capture(t);
    Solid.batch(() => {
      const ex = curEx() || { level: level(), seeds: [], exp: [] };
      const nb = RC.neighbors(model(), opts(), t, dir);
      const seeds = exVisible(ex).has(t) ? ex.seeds : [...ex.seeds, t];
      setExplore({ level: ex.level, inst: instMode(), seeds, exp: [...ex.exp, { node: t, dir, added: nb }] });
      setPair(null); setFocus('');
    });
  }
  function collapseRef(t, dir) {
    const ex = curEx(); if (!ex) return;
    viewAnchor.capture && viewAnchor.capture(t);
    let exp = ex.exp.filter((x) => !(x.node === t && x.dir === dir));
    for (;;) { // drop expansions whose own node is no longer visible
      const vis = exVisible({ seeds: ex.seeds, exp });
      const keep = exp.filter((x) => vis.has(x.node));
      if (keep.length === exp.length) break;
      exp = keep;
    }
    setExplore({ ...ex, exp });
  }
  createEffect(on(level, () => setExplore(null), { defer: true }));
  // node ids differ between plain and Instances mode (form vs form@event): drop a selection that may no longer exist
  createEffect(on(instMode, () => { const s = selected(); if (s && (s.includes('@') && !s.startsWith('@form:'))) setSelectedRaw(null); }, { defer: true }));
  function toggleExpandForm(F) {
    const on = expanded().has(F);
    viewAnchor.capture && viewAnchor.capture(F, on ? { back: true } : { zoom: true });
    const next = new Set(expanded()); on ? next.delete(F) : next.add(F);
    setExpanded(next);
  }

  // ================= derived =================
  const formIds = createMemo(() => (model() ? model().parsed.forms.map((f) => f.id) : []));
  const opts = createMemo(() => {
    if (!model()) return null;
    const fo = formsOn();
    // event/arm filter narrows the form set: only forms collected in at least one selected event stay
    const evs = model().parsed.events || [], eo = eventsOn();
    const evActive = evs.some((e) => eo[e.id] === false);
    const evForms = evActive ? new Set(evs.filter((e) => eo[e.id] !== false).flatMap((e) => e.forms)) : null;
    const on = formIds().filter((i) => fo[i] !== false && (!evForms || evForms.has(i)));
    const t = typesOn();
    return {
      level: level(), dir: dir(), labelMode: labelMode(), group: groupBy() !== 'none' && level() === 'field', groupBy: groupBy(),
      eventSet: evActive ? new Set(evs.filter((e) => eo[e.id] !== false).map((e) => e.id)) : null, edgeLabels: edgeLabels(),
      hideIsolated: hideIso(), showMissing: showMissing(), types: new Set(TYPE_KEYS.filter((k) => t[k])),
      forms: on.length === formIds().length ? null : new Set(on), formsNone: on.length === 0, crossOnly: crossOnly(), instOnly: instOnly(),
      instances: instMode(), expanded: level() === 'form' ? expanded() : null, explore: curEx() && { level: level(), inst: instMode(), set: exVisible(curEx()) }, pair: pair(), focus: focus(), focusDir: focusDir(), focusDepth: Math.max(1, +focusDepth() || 1),
    };
  });
  const view = createMemo(() => {
    if (!model()) return null;
    const o = opts();
    return o.formsNone ? { level: o.level, nodes: [], edges: [], groups: [] } : RC.buildView(model(), o);
  });
  // lazy: only built when read (the renderer in use, or a download), and only once per view
  const lazySrc = (fn) => { let v0, o0, out = ''; return () => { const v = view(), o = opts(); if (v !== v0 || o !== o0) { v0 = v; o0 = o; out = v ? fn(v, o) : ''; } return out; }; };
  const mermaidSrc = lazySrc(RC.toMermaid);
  const dotSrc = lazySrc(RC.toDot);
  // string memo: downstream only re-runs when the text sent to the renderer actually changes
  const graphSrc = createMemo(() => (view() ? (renderer() === 'graphviz' ? dotSrc() : mermaidSrc()) : null));
  const graphStatus = createMemo(() => {
    const v = view(); if (!v) return '';
    if (!v.nodes.length) return 'Nothing to show with the current filters.';
    if (v.level === 'event' && !v.edges.length) return 'No cross-event references ([event][field]) with the current filters.';
    if (v.level === 'form' && v.instances && !v.edges.length) return 'No dependencies between form instances with the current filters.';
    if (v.level === 'form' && !v.edges.length) return 'No cross-form dependencies with the current filters.';
    return '';
  });
  const tooBig = createMemo(() => view() && view().edges.length > MAX_AUTO_EDGES && forcedFor() !== dotSrc());
  const formLabel = (id) => { const f = model().formsById.get(id); return f ? f.label : id; };

  // ================= graph rendering =================
  let token = 0, mermaidReady = false;
  createEffect(async () => {
    const src = graphSrc(), r = renderer(), big = tooBig(), status = graphStatus();
    if (src == null) return;
    const my = ++token, v = Solid.untrack(view); // v = the view this SVG is drawn from
    const clear = (msg) => Solid.batch(() => { setBusy(false); setSvgEl(null); setSvgView(null); setRenderMsg(msg); });
    if (status) { clear(status); return; }
    if (big) { clear(''); return; }
    setRenderMsg(Solid.untrack(svgEl) ? '' : 'Rendering…');
    setBusy(true); // keep the previous SVG on screen (dimmed) until the new one is ready
    try {
      let svg;
      if (r === 'graphviz') {
        await RC.loadLib('viz');
        const viz = await Viz.instance();
        svg = viz.renderSVGElement(src);
      } else {
        await RC.loadLib('mermaid');
        if (!mermaidReady) { mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', maxTextSize: 5e6, maxEdges: 20000, flowchart: { htmlLabels: false, useMaxWidth: false }, theme: 'default' }); mermaidReady = true; }
        const out = await mermaid.render('mmd' + my, src);
        const d = document.createElement('div'); d.innerHTML = out.svg; svg = d.querySelector('svg');
      }
      if (my !== token) return;
      Solid.batch(() => { setRenderMsg(''); setBusy(false); setSvgView(v); setSvgEl(svg); });
    } catch (e) {
      if (my !== token) return;
      clear('Could not render graph: ' + e.message + ' (check network or the vendor/ folder). The Mermaid and DOT downloads still work.');
    }
  });

  // ================= loading =================
  function loadText(text, name) {
    try {
      const parsed = RC.parseODM(text);
      const m = RC.buildModel(parsed);
      modelSeq++;
      Solid.batch(() => {
        setLoadError('');
        setFileBase((name || parsed.projectName).replace(/\.xml$/i, '').replace(/[^\w.-]+/g, '_') || 'redcap');
        setLevel('form'); setFormQ(''); setFormsOn({}); setEventsOn({}); setCrossOnly(false); setInstOnly(false); setFocus(''); setPair(null); setExplore(null); setExpanded(new Set()); setSelEdge(null); setSelected(null); setTab('graph');
        setTypesOn(Object.fromEntries(TYPE_KEYS.map((k) => [k, true])));
        setModel(m);
      });
    } catch (e) { setLoadError(e.message); }
  }
  async function loadSample() {
    try {
      const res = await fetch('sample/sample.xml');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      loadText(await res.text(), 'sample');
    } catch (e) { setLoadError('Could not load sample/sample.xml (' + e.message + '). Serve the folder over http, e.g. python3 -m http.server.'); }
  }
  function readFile(f) {
    const r = new FileReader();
    r.onload = () => loadText(String(r.result), f.name);
    r.onerror = () => setLoadError('Could not read file');
    r.readAsText(f);
  }
  document.addEventListener('dragover', (e) => { e.preventDefault(); setDragOver(true); });
  document.addEventListener('dragleave', (e) => { e.preventDefault(); setDragOver(false); });
  document.addEventListener('drop', (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });

  // ================= downloads =================
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const suffix = () => (level() === 'form' ? (instMode() ? '_instances' : '_forms') : level() === 'event' ? '_events' : '_fields');
  const dlMermaid = () => download(fileBase() + suffix() + '.mmd', mermaidSrc());
  const dlDot = () => download(fileBase() + suffix() + '.dot', dotSrc());
  const dlCsv = () => download(fileBase() + '_dependencies.csv', RC.toCsv(model(), model().edges.filter((e) => opts().types.has(e.type))), 'text/csv;charset=utf-8');
  const dlSvg = () => {
    const s = svgEl();
    if (!s) { alert('Render the graph first.'); return; }
    const c = s.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    download(fileBase() + suffix() + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c), 'image/svg+xml;charset=utf-8');
  };

  // ================= small form helpers =================
  const Select = (get, set, options) => html`<select onChange=${(e) => set(e.target.value)}>${options.map(([v, l]) => html`<option value=${v} selected=${() => get() === v}>${l}</option>`)}</select>`;
  const Check = (get, set, label) => html`<label class="chk"><input type="checkbox" checked=${get} onChange=${(e) => set(e.target.checked)}> ${label}</label>`;
  const jumpToField = (v) => { Solid.batch(() => { setLevel('field'); setFocus(v); setPair(null); setSelEdge(null); setSelected(v); setTab('graph'); }); };
  const pickNode = (id) => Solid.batch(() => { setSelEdge(null); setSelected(id); });

  // ================= sidebar =================
  function Sidebar() {
    const shownForms = createMemo(() => {
      const q = formQ().toLowerCase().trim();
      return model().parsed.forms.filter((f) => !q || (f.label + ' ' + f.id).toLowerCase().includes(q));
    });
    // all / none apply to the forms currently listed (so you can search, then select the matches)
    const setForms = (val) => setFormsOn({ ...formsOn(), ...Object.fromEntries(shownForms().map((f) => [f.id, val])) });
    const armEvents = (a) => model().parsed.events.filter((e) => !a.num || e.arm === a.num);
    const setEvents = (val) => setEventsOn(Object.fromEntries(model().parsed.events.map((e) => [e.id, val])));
    const setArm = (a, val) => setEventsOn({ ...eventsOn(), ...Object.fromEntries(armEvents(a).map((e) => [e.id, val])) });
    const pickField = (e) => {
      const v = e.target.value.trim();
      if (!v) { setFocus(''); return; }
      if (model().byVar.has(v)) Solid.batch(() => { setLevel('field'); setExplore(null); setPair(null); setFocus(v); });
      else e.target.value = focus();
    };
    return html`<aside id="side">
      <details class="sec" open>
        <summary><h2>View</h2></summary>
        <label>Level ${Select(level, setLevel, [['field', 'Fields'], ['form', 'Forms (aggregated)'], ['event', 'Events (cross-event links)']])}</label>
        <label>Renderer ${Select(renderer, setRenderer, [['graphviz', 'Graphviz'], ['mermaid', 'Mermaid']])}</label>
        <label>Direction ${Select(dir, setDir, [['LR', 'Left → right'], ['TD', 'Top → down']])}</label>
        <label>Node text ${Select(labelMode, setLabelMode, [['var', 'Variable name'], ['label', 'Name + field label']])}</label>
        <label>Group fields by ${Select(groupBy, setGroupBy, [['form', 'Form'], ['event', 'Event (longitudinal)'], ['arm', 'Arm (longitudinal)'], ['none', 'No grouping']])}</label>
        <${Show} when=${() => level() === 'form' && (model().parsed.events || []).length > 0}>
          ${Check(instances, setInstances, 'Instances (one node per form per event)')}
          <${Show} when=${instances}><p class="muted small" style="margin:0 0 6px">A form collected in several events gets one node per event, banded by event (or by arm via Group by). Select a node to expand its back / forward references or zoom into its fields.</p><//>
        <//>
        ${Check(edgeLabels, setEdgeLabels, 'Edge labels')}
        ${Check(hideIso, setHideIso, 'Hide fields with no dependencies')}
        ${Check(showMissing, setShowMissing, 'Show undefined references')}
      </details>
      <details class="sec">
        <summary><h2>Dependency types</h2></summary>
        <${For} each=${() => Object.entries(RC.TYPES)}>${([k, t]) => html`
          <label class="typerow"><input type="checkbox" checked=${() => typesOn()[k]} onChange=${(e) => setTypesOn({ ...typesOn(), [k]: e.target.checked })}>
            <span class="sw" style=${`border-color:${t.color};border-top-style:${k === 'branching' ? 'solid' : k === 'calc' ? 'double' : 'dashed'}`}></span>${t.label}</label>`}<//>
      </details>
      <${Show} when=${() => curEx()}>
        <details class="sec" open>
        <summary><h2>Exploring</h2></summary>
          <p class="small" style="margin:0 0 6px">${() => exVisible(curEx()).size} nodes shown. Select a node and use <b>Expand / Collapse</b> in its panel.</p>
          <button class="btn sm" onClick=${() => setExplore(null)}>✕ Exit exploring</button>
        </details>
      <//>
      <${Show} when=${pair}>
        <details class="sec" open>
        <summary><h2>Form link focus</h2></summary>
          <p class="small" style="margin:0 0 6px">Showing only the fields linking <b>${() => (pair() ? formLabel(pair().from) : '')}</b> → <b>${() => (pair() ? formLabel(pair().to) : '')}</b></p>
          <button class="btn sm" onClick=${() => setPair(null)}>✕ Clear</button>
        </details>
      <//>
      <details class="sec">
        <summary><h2>Focus on a field</h2></summary>
        <label>Field (search)
          <span class="row2"><input type="search" list="fieldlist" placeholder="Type to search fields…" autocomplete="off" value=${focus} onChange=${pickField}>
            <button class="btn sm" title="Clear focus" onClick=${() => setFocus('')}>✕</button></span>
          <datalist id="fieldlist"><${For} each=${() => model().parsed.fields}>${(f) => html`<option value=${f.variable}>${f.label.slice(0, 70)}</option>`}<//></datalist>
        </label>
        <label>Show ${Select(focusDir, setFocusDir, [['both', 'Upstream + downstream'], ['up', 'Upstream (what it depends on)'], ['down', 'Downstream (what depends on it)']])}</label>
        <label>Max depth
          <span class="stepper"><button class="btn sm" onClick=${() => setFocusDepth(focusDepth() - 1)}>−</button>
            <input type="number" inputmode="numeric" min="1" max="50" step="1" value=${focusDepth} onChange=${(e) => { setFocusDepth(e.target.value); e.target.value = focusDepth(); }}>
            <button class="btn sm" onClick=${() => setFocusDepth(focusDepth() + 1)}>+</button></span></label>
        <p class="muted small">Choosing a field switches to the field-level view. Tip: click a node to see its logic code.</p>
      </details>
      <${Show} when=${() => (model().parsed.events || []).length}>
        <details class="sec">
        <summary><h2>Events &amp; arms <button class="link" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setEvents(true); }}>all</button> <button class="link" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setEvents(false); }}>none</button></h2></summary>
          ${Check(crossOnly, setCrossOnly, 'Only cross-event references')}
          ${Check(instOnly, setInstOnly, 'Only repeating-instance logic')}
          <div id="events">
            <${For} each=${() => model().parsed.arms.length ? model().parsed.arms : [{ num: '', name: '' }]}>${(a) => html`
              <div class="armrow">
                <${Show} when=${() => a.num}>
                  <label class="chk"><input type="checkbox" checked=${() => armEvents(a).every((e) => eventsOn()[e.id] !== false)} onChange=${(e) => setArm(a, e.target.checked)}> <b>${a.name}</b> <span class="muted small">arm ${a.num}</span></label>
                <//>
                <${For} each=${() => armEvents(a)}>${(ev) => html`
                  <label class="chk" style="margin-left:14px"><input type="checkbox" checked=${() => eventsOn()[ev.id] !== false} onChange=${(e) => setEventsOn({ ...eventsOn(), [ev.id]: e.target.checked })}> ${ev.label}${ev.repeating ? ' ↻' : ''} <span class="muted small">(${ev.forms.length})</span></label>`}<//>
              </div>`}<//>
          </div>
          <p class="muted small">Keeps forms collected in the ticked events (↻ = repeating). Combines with the Forms list.</p>
        </details>
      <//>
      <details class="sec">
        <summary><h2>Forms <button class="link" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setForms(true); }}>all</button> <button class="link" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setForms(false); }}>none</button></h2></summary>
        <input type="search" class="formsearch" placeholder="Search forms…" value=${formQ} onInput=${(e) => setFormQ(e.target.value)}>
        <div id="forms">
          <${For} each=${shownForms}>${(f) => html`
            <label class="chk"><input type="checkbox" checked=${() => formsOn()[f.id] !== false} onChange=${(e) => setFormsOn({ ...formsOn(), [f.id]: e.target.checked })}> ${f.label} <span class="muted small">(${f.fields.length})</span></label>`}<//>
        </div>
      </details>
    </aside>`;
  }

  // ================= graph stage (pan / zoom) =================
  function GraphStage() {
    let stage, canvas, pz = { x: 0, y: 0, k: 1 };
    const apply = () => { canvas.style.transform = `translate(${pz.x}px,${pz.y}px) scale(${pz.k})`; };
    const fit = () => {
      const s = svgEl(); if (!s || !stage.clientWidth) return;
      const w = +s.dataset.w, h = +s.dataset.h;
      const k = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1.5) * 0.96;
      pz = { k, x: (stage.clientWidth - w * k) / 2, y: (stage.clientHeight - h * k) / 2 };
      apply();
    };
    const zoomAt = (f, cx, cy) => {
      const r = stage.getBoundingClientRect();
      cx = cx == null ? r.width / 2 : cx - r.left; cy = cy == null ? r.height / 2 : cy - r.top;
      const k = Math.min(10, Math.max(0.02, pz.k * f));
      pz.x = cx - (cx - pz.x) * (k / pz.k); pz.y = cy - (cy - pz.y) * (k / pz.k); pz.k = k; apply();
    };
    // ---- keep zoom and the acted-on node in place across expand/collapse ----
    const elFor = (t) => {
      const s = svgEl(), v = svgView(); if (!s || !v) return null;
      if (t.startsWith('@form:')) {
        const gi = v.groups.findIndex((g) => g.id === t.slice(6)); if (gi < 0) return null;
        return [...s.querySelectorAll('g.cluster')].find((c) => { const ti = c.querySelector('title'); return ti && ti.textContent === 'cluster_' + gi; }) || null;
      }
      const ni = v.nodes.findIndex((n) => n.id === t);
      if (ni < 0) { // a form that is now drawn as a box of fields
        const gi = v.groups.findIndex((g) => g.id === t); if (gi < 0) return null;
        return [...s.querySelectorAll('g.cluster')].find((c) => { const ti = c.querySelector('title'); return ti && ti.textContent === 'cluster_' + gi; }) || null;
      }
      return [...s.querySelectorAll('g.node')].find((n) => nodeKey(n) === 'n' + ni) || null;
    };
    viewAnchor.capture = (t, opt = {}) => {
      if (!svgEl()) { viewAnchor.pending = null; return; }
      const el = elFor(t), sr = stage.getBoundingClientRect(), a = { t, k: pz.k, time: Date.now(), zoom: !!opt.zoom };
      if (opt.zoom) viewAnchor.zoomBack.set(t, pz.k);
      if (opt.back && viewAnchor.zoomBack.has(t)) { a.k = viewAnchor.zoomBack.get(t); viewAnchor.zoomBack.delete(t); }
      if (el) { const r = el.getBoundingClientRect(); a.sx = r.left + r.width / 2 - sr.left; a.sy = r.top + r.height / 2 - sr.top; }
      viewAnchor.pending = a;
    };
    const restoreOrFit = () => {
      const a = viewAnchor.pending; viewAnchor.pending = null;
      if (!a || Date.now() - a.time > 15000) { fit(); return; }
      pz = { k: a.k, x: 0, y: 0 }; apply();
      const el = elFor(a.t);
      if (!el || a.sx == null) { fit(); return; }
      const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      pz.x = a.sx - (r.left + r.width / 2 - sr.left); pz.y = a.sy - (r.top + r.height / 2 - sr.top);
      apply();
      if (a.zoom) { // animate: zoom the expanded form's box to fill most of the stage, neighbours stay visible around it
        const cl = elFor('@form:' + a.t); if (!cl) return;
        const cr = cl.getBoundingClientRect(), cx = cr.left + cr.width / 2 - sr.left, cy = cr.top + cr.height / 2 - sr.top;
        const nk = Math.min(6, Math.max(0.02, pz.k * Math.min(stage.clientWidth * 0.7 / cr.width, stage.clientHeight * 0.7 / cr.height)));
        const f = nk / pz.k, tx = stage.clientWidth / 2 - (cx - pz.x) * f, ty = stage.clientHeight / 2 - (cy - pz.y) * f;
        canvas.style.transition = 'transform .45s ease'; void canvas.offsetWidth;
        pz = { k: nk, x: tx, y: ty }; apply();
        setTimeout(() => { canvas.style.transition = ''; }, 500);
      }
    };
    createEffect(() => {
      const s = svgEl();
      canvas.innerHTML = '';
      if (!s) return;
      s.removeAttribute('style');
      const vb = s.viewBox && s.viewBox.baseVal;
      const w = vb && vb.width ? vb.width : parseFloat(s.getAttribute('width')) || 800;
      const h = vb && vb.height ? vb.height : parseFloat(s.getAttribute('height')) || 600;
      if (!vb || !vb.width) s.setAttribute('viewBox', `0 0 ${w} ${h}`);
      s.setAttribute('width', w); s.setAttribute('height', h); s.dataset.w = w; s.dataset.h = h;
      canvas.appendChild(s);
      restoreOrFit();
    });
    // ---- highlight a node's direct links (hover, or the selected node) ----
    const nodeKey = (g) => {
      const t = g.querySelector('title');
      if (t && /^n\d+$/.test(t.textContent)) return t.textContent;
      const m = /-(n\d+)-/.exec(g.id || ''); return m ? m[1] : null;
    };
    const edgeKey = (g) => {
      const t = g.querySelector && g.querySelector('title');
      let m = t && /^(n\d+)->(n\d+)$/.exec(t.textContent);
      if (m) return [m[1], m[2]];
      m = /L[_-](n\d+)[_-](n\d+)/.exec(g.id || ''); return m ? [m[1], m[2]] : null;
    };
    let hover = null;
    const applyHl = () => {
      const s = svgEl(); if (!s) return;
      let key = hover;
      if (!key && selected() && svgView()) { const sn = svgView().nodes; let i = sn.findIndex((n) => n.id === selected()); if (i < 0) i = sn.findIndex((n) => n.field && n.field === selected()); if (i >= 0) key = 'n' + i; }
      const nodes = s.querySelectorAll('g.node'), edges = s.querySelectorAll('g.edge, path.flowchart-link');
      if (!key || nodes.length > 2500) { s.classList.remove('hl'); nodes.forEach((n) => n.classList.remove('on')); edges.forEach((n) => n.classList.remove('on')); return; }
      const keep = new Set([key]);
      edges.forEach((el) => {
        const k = edgeKey(el), on = !!k && (k[0] === key || k[1] === key);
        el.classList.toggle('on', on);
        if (on) { keep.add(k[0]); keep.add(k[1]); }
      });
      nodes.forEach((n) => n.classList.toggle('on', keep.has(nodeKey(n))));
      s.classList.add('hl');
    };
    createEffect(() => { svgEl(); selected(); applyHl(); }); // applyHl reads svgView (set with svgEl), not view()
    // widen the clickable area of form-level edges (thin lines are hard to hit)
    createEffect(() => {
      const s = svgEl(), sv = svgView(); if (!s || !sv || sv.level !== 'form') return;
      s.querySelectorAll('g.edge').forEach((g) => {
        const p = g.querySelector('path'); if (!p) return;
        const h = p.cloneNode(); h.removeAttribute('marker-end'); h.setAttribute('stroke', 'transparent'); h.setAttribute('stroke-width', '14'); h.setAttribute('fill', 'none'); h.style.pointerEvents = 'stroke'; h.style.cursor = 'pointer';
        g.appendChild(h);
      });
    });

    createEffect(() => { stage.classList.toggle('busy', busy()); });
    // refit only when returning to the tab; opening the detail panel must not change the view
    createEffect(on(tab, () => requestAnimationFrame(fit), { defer: true }));

    onMount(() => {
      let drag = null, moved = 0;
      stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
      stage.addEventListener('mousedown', (e) => { drag = { x: e.clientX - pz.x, y: e.clientY - pz.y }; moved = 0; stage.classList.add('drag'); });
      window.addEventListener('mousemove', (e) => { if (!drag) return; moved++; pz.x = e.clientX - drag.x; pz.y = e.clientY - drag.y; apply(); });
      window.addEventListener('mouseup', () => { drag = null; stage.classList.remove('drag'); });
      window.addEventListener('resize', fit);
      stage.addEventListener('mouseover', (e) => {
        const g = e.target.closest && e.target.closest('g.node');
        const k = g ? nodeKey(g) : null;
        if (k !== hover) { hover = k; applyHl(); }
      });
      stage.addEventListener('mouseleave', () => { if (hover) { hover = null; applyHl(); } });
      stage.addEventListener('click', (e) => {
        if (moved > 4) return;
        const eg = e.target.closest && e.target.closest('g.edge, path.flowchart-link');
        const sv = svgView(); if (!sv) return;
        if (eg && sv.level === 'form') {
          const k = edgeKey(eg);
          const a = k && sv.nodes[+k[0].slice(1)], b = k && sv.nodes[+k[1].slice(1)];
          const isForm = (n) => n && n.kind !== 'field' && n.kind !== 'calc' && n.kind !== 'status' && (model().formsById.has(n.form || n.id) || n.id === '(unknown)');
          if (isForm(a) && isForm(b)) { Solid.batch(() => { setSelectedRaw(null); setSelEdge({ from: a.form || a.id, to: b.form || b.id }); }); return; }
        }
        const node = e.target.closest && e.target.closest('g.node');
        if (!node) {
          const cl = e.target.closest && e.target.closest('g.cluster');
          if (cl && (sv.level === 'field' || sv.mixed)) {
            const t = cl.querySelector('title');
            const m = (t && /^cluster_(\d+)$/.exec(t.textContent)) || /(?:^|[-_])g(\d+)$/.exec(cl.id || '');
            const gr = m && sv.groups[+m[1]];
            if (gr && !gr.noSelect) setSelected(sv.mixed ? gr.id : '@form:' + gr.id);
          } else if (!(e.target.closest && e.target.closest('g.edge, path.flowchart-link, .edgeLabel'))) {
            // click on the empty diagram background: close the detail pane
            Solid.batch(() => { setSelected(null); setSelEdge(null); });
          }
          return;
        }
        let id = null;
        const t = node.querySelector('title');
        if (t && /^n\d+$/.test(t.textContent)) id = t.textContent;
        else { const m = /-(n\d+)-/.exec(node.id || ''); if (m) id = m[1]; }
        const n = id && sv.nodes[+id.slice(1)];
        if (n) setSelected(n.id); // full node id (variable@@instance) so the right copy is highlighted
      });
    });

    return html`<div>
      <div class="graphbar">
        <span class="muted">${() => (view() ? `${view().nodes.length} nodes · ${view().edges.length} edges` : '')}</span><span class="grow"></span>
        <button class="btn sm" title="Zoom in" onClick=${() => zoomAt(1.3)}>+</button>
        <button class="btn sm" title="Zoom out" onClick=${() => zoomAt(1 / 1.3)}>−</button>
        <button class="btn sm" onClick=${fit}>Fit</button>
      </div>
      <div id="graphwrap">
        <div id="stage" ref=${(el) => (stage = el)}>
          <${Show} when=${() => renderMsg() || tooBig()}>
            <div id="msg">
              <${Show} when=${tooBig} fallback=${html`<div>${renderMsg}</div>`}>
                <div>Large graph (${() => view().edges.length} edges). Rendering may be slow.<br><br>
                  <button class="btn primary" onClick=${() => setForcedFor(dotSrc())}>Render anyway</button><br><br>
                  <span class="muted small">Or narrow it with the filters / focus, or just download the .mmd / .dot files.</span></div>
              <//>
            </div>
          <//>
          <div id="canvas" ref=${(el) => (canvas = el)}></div>
        </div>
        <${Detail}/>
      </div>
      <div class="legend">
        <${For} each=${() => Object.values(RC.TYPES)}>${(t) => html`<span><i class="sw" style=${`border-color:${t.color}`}></i>${t.label}</span>`}<//>
        <${Show} when=${() => level() === 'form'}><span><b>Line thickness = number of dependent fields</b> (log scale)</span><//>
        <span>Nodes: blue = field, orange = calculated, grey = form, red dashed = undefined reference</span>
      </div>
    </div>`;
  }

  // ================= detail panel (reveal code) =================
  function CodeBlock(title, text, copyable) {
    if (!text) return '';
    const parts = text.split(/(\[[A-Za-z][A-Za-z0-9_]*(?:\([^)\]]*\))?(?::[A-Za-z0-9_]+)?\])/);
    const nodes = parts.map((p) => {
      const m = /^\[([A-Za-z][A-Za-z0-9_]*)/.exec(p);
      if (!m || p[0] !== '[') return p;
      const ok = model().byVar.has(m[1]);
      return ok ? html`<span class="ref" style="cursor:pointer" onClick=${() => setSelected(m[1])}>${p}</span>` : html`<span class="ref bad">${p}</span>`;
    });
    return html`<div><h4>${title} ${copyable ? html`<button class="link" onClick=${(e) => { navigator.clipboard && navigator.clipboard.writeText(text); e.target.textContent = 'copied'; }}>copy</button>` : ''}</h4><pre>${nodes}</pre></div>`;
  }
  const Chips = (arr) => (arr.length
    ? html`<div class="chips">${arr.map((x) => html`<button class="chip" title=${x.t} onClick=${() => setSelected(x.id)}>${x.id}</button>`)}</div>`
    : html`<span class="muted small">none</span>`);
  const tagOf = (t) => html`<span class="tag" style=${`background:${RC.TYPES[t].color}`}>${t}</span>`;

  function ExploreButtons(id) {
    const m = model();
    if (instMode()) return InstanceExploreButtons(id);
    // at form level the target is the form owning the selected node
    const isGroup = id.startsWith('@form:');
    const t = level() === 'form' ? (m.formsById.has(id) || id === '(unknown)' ? id : (RC.nodeInfo(m, id) || {}).form) : id;
    const fid = isGroup ? id.slice(6) : (RC.nodeInfo(m, id) || {}).form;
    if (!t) return '';
    const ex = curEx(), vis = ex ? exVisible(ex) : new Set();
    const btn = (dir, label, tip) => {
      const nb = RC.neighbors(m, opts(), t, dir);
      const open = !!(ex && ex.exp.some((x) => x.node === t && x.dir === dir));
      const fresh = nb.filter((x) => !vis.has(x)).length;
      return html`<button class="btn sm" title=${tip} disabled=${!nb.length && !open} onClick=${() => (open ? collapseRef(t, dir) : expandRef(t, dir))}>${open ? 'Collapse ' : 'Expand '}${label} (${open ? nb.length : fresh})</button>`;
    };
    return html`<div class="exrow">
      ${isGroup ? '' : html`${btn('up', '◀ back refs', 'Add what this depends on')}${btn('down', 'forward refs ▶', 'Add what depends on this')}`}
      ${level() === 'field' && fid ? html`${isGroup ? '' : html`<div class="muted small" style="width:100%">Whole form <b>${formLabel(fid)}</b>:</div>`}
        ${btn('fup', '◀ form back refs', 'Add every field in other forms that this form depends on (with the fields in this form they feed)')}${btn('fdown', 'form forward refs ▶', 'Add every field in other forms that depends on this form (with the fields in this form they use)')}` : ''}
      ${level() === 'form' && t !== id ? html`<div class="muted small" style="width:100%">applies to its form: ${formLabel(t)}</div>` : ''}
    </div>`;
  }
  // Instances mode: the explore target is an instance node (form@event); a plain field or form id resolves to its only instance
  function InstanceExploreButtons(id) {
    const m = model(), v = view();
    const all = v ? [...v.nodes, ...(v.expandedNodes || [])].filter((n) => !n.field) : [];
    let t = all.some((n) => n.id === id) ? id : null;
    if (!t) {
      const fid = id.startsWith('@form:') ? id.slice(6) : (RC.nodeInfo(m, id) || {}).form;
      const c = all.filter((n) => n.form === fid);
      if (c.length === 1) t = c[0].id;
      else return html`<div class="muted small" style="margin:6px 0">${c.length ? 'Select one of this form\'s instance nodes to expand its references.' : ''}</div>`;
    }
    const ex = curEx(), vis = ex ? exVisible(ex) : new Set();
    const btn = (dir, label, tip) => {
      const nb = RC.neighbors(m, opts(), t, dir);
      const open = !!(ex && ex.exp.some((x) => x.node === t && x.dir === dir));
      const fresh = nb.filter((x) => !vis.has(x)).length;
      return html`<button class="btn sm" title=${tip} disabled=${!nb.length && !open} onClick=${() => (open ? collapseRef(t, dir) : expandRef(t, dir))}>${open ? 'Collapse ' : 'Expand '}${label} (${open ? nb.length : fresh})</button>`;
    };
    return html`<div class="exrow">${btn('up', '◀ back refs', 'Add the instances this one depends on')}${btn('down', 'forward refs ▶', 'Add the instances that depend on this one')}
      ${t !== id ? html`<div class="muted small" style="width:100%">applies to the instance node ${t}</div>` : ''}</div>`;
  }
  // a form box (cluster) clicked in the field-level graph
  function groupDetail(fid) {
    const m = model(), fm = m.formsById.get(fid), o = opts();
    const label = fm ? fm.label : fid;
    const linked = new Set();
    m.edges.forEach((e) => { if (o.types.has(e.type) && (o.showMissing || !e.missing)) { linked.add(e.from); linked.add(e.to); } });
    const inForm = fm ? fm.fields.filter((v) => linked.has(v)) : [];
    const seeds = ['@form:' + fid, ...(inForm.length ? inForm : fm ? fm.fields : [])];
    return html`<div><h3>${label}</h3><div class="muted small">form <code>${fid}</code> · ${fm ? fm.fields.length : 0} fields · ${inForm.length} with dependencies</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick=${() => Solid.batch(() => { setPair(null); setFocus(''); setExplore({ level: 'field', seeds, exp: [] }); })}>Focus on this form</button></p>
      ${ExploreButtons('@form:' + fid)}
      <p class="muted small">Focus shows this form's linked fields only; then expand back / forward references from the whole form. Select any node to expand it individually.</p></div>`;
  }
  function detailContent(id, inst) {
    // an expanded field node of the Instances view is `variable@@instanceId`: show the field, explore its instance
    const at = !inst ? id.indexOf('@@') : -1;
    if (at > 0) return detailContent(id.slice(0, at), id.slice(at + 2));
    if (id.startsWith('@form:')) return groupDetail(id.slice(6));
    const m = model(), A = m.analysis, info = RC.nodeInfo(m, id);
    if (!info && instMode()) { const d = instanceDetail(id); if (d) return d; }
    if (!info) { // form-level node
      if (id === '(unknown)') return html`<div><h3>Undefined fields</h3><div class="muted small">fields referenced by logic but not defined in the project</div>${ExploreButtons(id)}</div>`;
      const ev = (m.parsed.events || []).find((x) => x.id === id);
      if (ev) return eventDetail(ev);
      const fm = m.formsById.get(id); if (!fm) return '';
      const cross = m.edges.filter((e) => !e.missing && (RC.nodeInfo(m, e.from).form === id) !== (RC.nodeInfo(m, e.to).form === id));
      return html`<div><h3>${fm.label}</h3><div class="muted small">form <code>${fm.id}</code> · ${fm.fields.length} fields</div>
        ${instMode() ? '' : html`<p style="margin:8px 0"><button class="btn sm primary" onClick=${() => toggleExpandForm(id)}>${expanded().has(id) ? 'Collapse back to form' : 'Zoom into fields'}</button></p>`}
        ${ExploreButtons(id)}
        <h4>Cross-form dependencies (${cross.length})</h4>
        ${cross.length ? cross.map((e) => html`<div class="small" style="margin-bottom:6px">
          <button class="fieldlink" onClick=${() => setSelected(e.from)}>${e.from}</button> → <button class="fieldlink" onClick=${() => setSelected(e.to)}>${e.to}</button> ${tagOf(e.type)}<pre>${e.expr}</pre></div>`) : html`<span class="muted small">none</span>`}</div>`;
    }
    if (info.formNode) return html`<div><h3>Form: ${info.label}</h3><div class="muted small">form display logic target</div>${ExploreButtons(inst || id)}${info.logic.map((l) => CodeBlock('Display condition', l, true))}</div>`;
    if (info.ghost) return html`<div><h3>${id}</h3><div class="muted small">Referenced but not defined in this project</div>${ExploreButtons(inst || id)}<h4>Used by</h4>${Chips(A.out.get(id).map((e) => ({ id: e.to, t: e.type })))}</div>`;
    const f = info;
    const up = A.inn.get(id).map((e) => ({ id: e.from, t: e.type })), down = A.out.get(id).map((e) => ({ id: e.to, t: e.type }));
    return html`<div>
      <h3>${f.variable}</h3>
      <div class="muted small">${f.type} · form <b>${formLabel(f.form)}</b>${f.required ? ' · required' : ''}</div>
      ${f.label ? html`<p style="margin:6px 0">${f.label}</p>` : ''}
      ${ExploreButtons(inst || id)}
      <p style="margin:6px 0"><button class="btn sm" onClick=${() => { Solid.batch(() => { setLevel('field'); setExplore(null); setFocus(id); }); }}>Focus graph on this field</button></p>
      ${CodeBlock('Branching logic', f.branching, true)}${CodeBlock('Calculation', f.calc, true)}${CodeBlock('Action tags / annotation', f.annotation, true)}
      ${CodeBlock('Section header (piping)', f.section)}${CodeBlock('Field note (piping)', f.note)}
      ${!f.branching && !f.calc && !f.annotation ? html`<p class="muted small">No logic code on this field.</p>` : ''}
      ${f.choices.length ? html`<div><h4>Choices</h4><pre>${f.choices.map((c) => c.code + ', ' + c.label).join('\n')}</pre></div>` : ''}
      <h4>Depends on (${up.length})</h4>${Chips(up)}<h4>Used by (${down.length})</h4>${Chips(down)}</div>`;
  }
  // a node of the Instances view: form@event (or a plain form id when the form is in one event)
  function instanceDetail(id) {
    const v = view(), m = model(); if (!v || !v.instances) return '';
    const nodes = [...(v.nodes || []), ...(v.expandedNodes || [])].filter((x) => !x.field), n = nodes.find((x) => x.id === id);
    if (!n || !n.form) return '';
    const fm = m.formsById.get(n.form), evs = m.parsed.events || [];
    const evLabel = (eid) => { const e = evs.find((x) => x.id === eid); return e ? e.label : eid || ''; };
    const nlabel = (nid) => { const x = nodes.find((y) => y.id === nid); return x ? (fm0(x) + (x.event ? ' @ ' + evLabel(x.event) : '')) : nid; };
    const fm0 = (x) => { const f = m.formsById.get(x.form); return f ? f.label : x.form || x.id; };
    const others = nodes.filter((x) => x.form === n.form && x.id !== n.id);
    const ie = v.instEdges || v.edges || [], inn = ie.filter((e) => e.to === id && e.from !== id), out = ie.filter((e) => e.from === id && e.to !== id);
    const flags = (e) => ['cross', 'mismatch', 'relative', 'crossArm'].filter((k) => e[k]).map((k) => html`<span class="tag" style="background:#6b7280">${k === 'crossArm' ? 'cross-arm' : k}</span> `);
    const row = (e, other) => html`<div class="small" style="margin-bottom:4px"><button class="fieldlink" onClick=${() => setSelected(other)}>${nlabel(other)}</button> ${flags(e)}</div>`;
    return html`<div><h3>${fm ? fm.label : n.form}${n.event ? ' @ ' + evLabel(n.event) : ''}</h3>
      <div class="muted small">form <code>${n.form}</code>${n.event ? html` · event <code>${n.event}</code>` : ''}${fm ? ' · ' + fm.fields.length + ' fields' : ''}</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick=${() => toggleExpandForm(id)}>${expanded().has(id) ? 'Collapse back to form' : 'Zoom into fields'}</button></p>
      ${ExploreButtons(id)}
      ${others.length ? html`<h4>Also collected in (${others.length})</h4><div class="chips">${others.map((x) => html`<button class="chip" onClick=${() => setSelected(x.id)}>${evLabel(x.event)}</button>`)}</div>` : ''}
      <h4>Incoming from other instances (${inn.length})</h4>${inn.length ? inn.map((e) => row(e, e.from)) : html`<span class="muted small">none</span>`}
      <h4>Outgoing to other instances (${out.length})</h4>${out.length ? out.map((e) => row(e, e.to)) : html`<span class="muted small">none</span>`}</div>`;
  }
  // an event box clicked in the event-level graph
  function eventDetail(ev) {
    const m = model();
    const out = m.edges.filter((e) => (e.events || []).includes(ev.id));
    const inn = m.edges.filter((e) => (m.parsed.events.some((x) => x.forms.includes(RC.nodeInfo(m, e.to).form) && x.id === ev.id)) && (e.events || []).some((x) => x !== ev.id));
    const row = (e) => html`<div class="small" style="margin-bottom:6px"><button class="fieldlink" onClick=${() => jumpToField(e.from)}>${e.from}</button> → <button class="fieldlink" onClick=${() => jumpToField(e.to)}>${e.to}</button> ${tagOf(e.type)} <span class="muted">${(e.events || []).join(', ')}</span><pre>${e.expr}</pre></div>`;
    return html`<div><h3>${ev.label}</h3><div class="muted small">event <code>${ev.id}</code>${ev.arm ? ' · arm ' + ev.arm + (ev.armName ? ' (' + ev.armName + ')' : '') : ''}${ev.repeating ? ' · repeating' : ''}</div>
      <p class="small" style="margin:6px 0">Forms: ${ev.forms.map(formLabel).join(', ') || 'none'}</p>
      <h4>Read from this event (${out.length})</h4>${out.length ? out.map(row) : html`<span class="muted small">none</span>`}
      <h4>Reads other events (${inn.length})</h4>${inn.length ? inn.map(row) : html`<span class="muted small">none</span>`}</div>`;
  }
  // form-level edge: the fields that make up the link
  function edgeDetail(ed) {
    const m = model(), o = opts();
    const fl = (id) => (id === '(unknown)' ? 'Undefined fields' : formLabel(id));
    const es = m.edges.filter((e) => o.types.has(e.type) && (o.showMissing || !e.missing) && RC.nodeInfo(m, e.from).form === ed.from && RC.nodeInfo(m, e.to).form === ed.to);
    const byDep = new Map();
    es.forEach((e) => { if (!byDep.has(e.to)) byDep.set(e.to, []); byDep.get(e.to).push(e); });
    const srcs = new Set(es.map((e) => e.from));
    return html`<div>
      <h3>${() => fl(ed.from)} → ${() => fl(ed.to)}</h3>
      <div class="muted small">${srcs.size} source field${srcs.size === 1 ? '' : 's'} · ${byDep.size} dependent field${byDep.size === 1 ? '' : 's'} · ${es.length} dependenc${es.length === 1 ? 'y' : 'ies'}</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick=${() => Solid.batch(() => { setLevel('field'); setFocus(''); setPair({ from: ed.from, to: ed.to }); setSelEdge(null); })}>Show these fields in the field graph</button></p>
      ${[...byDep.entries()].map(([dep, list]) => html`<div style="margin-bottom:10px">
        <button class="fieldlink" style="font-weight:600" onClick=${() => setSelected(dep)}>${dep}</button>
        <span class="muted small"> depends on </span>
        ${list.map((e) => html`<div class="small" style="margin:3px 0">${tagOf(e.type)} <button class="fieldlink" onClick=${() => setSelected(e.from)}>${e.from}</button><pre>${e.expr}</pre></div>`)}
      </div>`)}
    </div>`;
  }
  function Detail() {
    return html`<${Show} when=${() => selected() || selEdge()}>
      <aside id="detail">
        <button class="link" style="float:right" onClick=${() => { setSelected(null); setSelEdge(null); }}>✕ close</button>
        ${() => (selEdge() ? edgeDetail(selEdge()) : detailContent(selected()))}
      </aside><//>`;
  }

  // ================= tables / analysis =================
  function DepsTab() {
    const rows = createMemo(() => {
      const m = model(), o = opts(), q = depQ().toLowerCase().trim();
      return m.edges.filter((e) => o.types.has(e.type) && (o.showMissing || !e.missing)).filter((e) =>
        !q || [e.from, e.to, e.type, RC.nodeInfo(m, e.from).form, RC.nodeInfo(m, e.to).form, e.expr].join(' ').toLowerCase().includes(q));
    });
    return html`<div>
      <input class="filter" placeholder="Filter by field, form, type or expression…" value=${depQ} onInput=${(e) => setDepQ(e.target.value)}>
      <p class="muted small">${() => rows().length} dependencies${() => (rows().length > 1000 ? ' (showing first 1000)' : '')}</p>
      <table><thead><tr><th>Source field</th><th></th><th>Dependent field</th><th>Type</th><th>Expression</th></tr></thead><tbody>
        <${For} each=${() => rows().slice(0, 1000)}>${(e) => html`<tr>
          <td>${e.from}<div class="muted small">${formLabel(RC.nodeInfo(model(), e.from).form)}</div></td><td>→</td>
          <td>${e.to}<div class="muted small">${formLabel(RC.nodeInfo(model(), e.to).form)}</div></td>
          <td>${tagOf(e.type)}${e.cross ? html`<span class="tag" style="background:#6b7280">cross-event</span>` : ''}</td><td class="expr">${e.expr}</td></tr>`}<//>
      </tbody></table></div>`;
  }
  function FieldsTab() {
    const rows = createMemo(() => {
      const q = fieldQ().toLowerCase().trim();
      return model().parsed.fields.filter((f) => !q || [f.variable, f.form, f.type, f.label].join(' ').toLowerCase().includes(q));
    });
    const deg = (v) => model().analysis.degree.get(v);
    return html`<div>
      <input class="filter" placeholder="Filter fields…" value=${fieldQ} onInput=${(e) => setFieldQ(e.target.value)}>
      <table id="fieldTable"><thead><tr><th>Variable</th><th>Form</th><th>Type</th><th>Label</th><th>Depends on</th><th>Used by</th></tr></thead><tbody>
        <${For} each=${rows}>${(f) => html`<tr data-v="1" onClick=${() => { setSelected(f.variable); setTab('graph'); }}>
          <td>${f.variable}</td><td>${formLabel(f.form)}</td><td>${f.type}</td><td>${f.label.slice(0, 80)}</td><td>${deg(f.variable).in}</td><td>${deg(f.variable).out}</td></tr>`}<//>
      </tbody></table></div>`;
  }
  function AnalysisTab() {
    const m = model(), A = m.analysis;
    const fb = (v) => html`<button class="fieldlink" onClick=${() => jumpToField(v)}>${v}</button>`;
    const list = (arr, fn) => (arr.length ? html`<ul>${arr.map((x) => html`<li>${fn(x)}</li>`)}</ul>` : html`<p class="muted">None 🎉</p>`);
    const card = (n, label, warn) => html`<div class=${'card' + (warn ? ' warn' : '')}><b>${n}</b>${label}</div>`;
    return html`<div class="an">
      <div class="cards">
        ${card(m.parsed.fields.length, 'fields')}${card(m.edges.length, 'dependencies')}${card(A.maxChain, 'longest logic chain')}
        ${card(A.isolated.length, 'isolated fields')}${card(A.cycles.length, 'circular groups', A.cycles.length)}
        ${card(A.missing.length, 'undefined refs', A.missing.length)}${card(A.forward.length, 'forward branching refs')}
      </div>
      <h3>Circular dependencies <span class="muted small">(branching / calc / action-tag logic)</span></h3>
      ${list(A.cycles, (c) => c.map((v, i) => html`<span>${i ? ' ⇄ ' : ''}${fb(v)}</span>`))}
      <h3>References to undefined fields</h3>
      ${list(A.missing, (e) => html`<span>${fb(e.to)} → <code>[${e.from}]</code> in ${tagOf(e.type)}</span>`)}
      <h3>Branching on a field that appears later in the project</h3>
      ${list(A.forward, (e) => html`<span>${fb(e.to)} is shown depending on ${fb(e.from)}, which is asked later</span>`)}
      <h3>Most influential fields (most dependants)</h3>
      ${list(A.hubs, ([v, n]) => html`<span>${fb(v)} — ${n}</span>`)}
      <h3>Most dependent fields (most inputs)</h3>
      ${list(A.heavy, ([v, n]) => html`<span>${fb(v)} — ${n}</span>`)}
      <h3>Cross-form dependencies</h3>
      <p>${A.crossForm.length} of ${m.edges.length} dependencies link different forms. Use the “Forms” level to see them aggregated.</p>
      ${m.selfRefs.length ? html`<div><h3>Self-references ignored</h3>${list(m.selfRefs, (r) => html`<span>${fb(r.field)} (${r.type})</span>`)}</div>` : ''}
    </div>`;
  }


  // ================= dependency structure matrix =================
  const [mxCell, setMxCell] = createSignal(0); // 0 = automatic cell size
  function MatrixTab() {
    let cv, scroller;
    const [tip, setTip] = createSignal(null);
    const L = 230, T = 130, MAXN = 6000, MAXPX = 14000;
    const data = createMemo(() => {
      const v = view(), m = model();
      const formIdx = new Map(m.parsed.forms.map((f, i) => [f.id, i]));
      // "Group fields by" event / arm re-bands the matrix by that group instead of by form
      const gs = (v.level === 'field' && (groupBy() === 'event' || groupBy() === 'arm')) || v.instances ? (v.groups || []) : [];
      const gOf = new Map(); gs.forEach((g, gi) => (g.nodes || []).forEach((id) => gOf.set(id, { gi, g })));
      const nodes = v.nodes.map((n, i) => { const o = gOf.get(n.id); return o ? { ...n, i, form: o.g.id, gLabel: o.g.label, gi: o.gi } : { ...n, i, gi: 999 }; })
        .sort((a, b) => (gs.length ? a.gi - b.gi : (formIdx.get(a.form) ?? 999) - (formIdx.get(b.form) ?? 999)) || a.i - b.i);
      const pos = new Map(nodes.map((n, k) => [n.id, k]));
      const N = nodes.length, cells = new Map();
      v.edges.forEach((e) => { const r = pos.get(e.to), c = pos.get(e.from); if (r != null && c != null) cells.set(r * N + c, e); });
      const auto = N <= 60 ? 18 : N <= 150 ? 14 : N <= 300 ? 10 : N <= 600 ? 7 : N <= 1200 ? 4 : N <= 2400 ? 3 : 2;
      const cell = Math.max(1, Math.min(mxCell() || auto, Math.floor(MAXPX / Math.max(N, 1))));
      return { nodes, N, cells, cell, auto };
    });
    const prim = (e) => ['branching', 'calc', 'formlogic', 'actiontag', 'piping'].find((t) => e.types.includes(t));
    let hov = null;
    const draw = () => {
      const { nodes, N, cells, cell } = data();
      if (!cv || !N || N > MAXN) return;
      const W = L + N * cell + 12, H = T + N * cell + 12;
      let dpr = window.devicePixelRatio || 1; if (W * H * dpr * dpr > 1.2e8) dpr = 1;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const x = cv.getContext('2d'); x.scale(dpr, dpr); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      const fs = Math.min(11, cell - 2), labels = cell >= 9;
      // form bands
      let start = 0;
      for (let k = 1; k <= N; k++) {
        if (k === N || nodes[k].form !== nodes[start].form) {
          const band = (k - start);
          if ((nodes[start].form && formIdxOdd(start))) { x.fillStyle = '#f3f4f6'; x.fillRect(L, T + start * cell, N * cell, band * cell); x.fillRect(L + start * cell, T, band * cell, N * cell); }
          x.fillStyle = '#374151'; x.font = 'bold 10px system-ui,sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
          const fm = model().formsById.get(nodes[start].form);
          const lab = (nodes[start].gLabel || (nodes[start].kind === 'missing' ? '(unknown)' : fm ? fm.label : nodes[start].form));
          x.fillText(lab.length > 26 ? lab.slice(0, 25) + '…' : lab, 4, T + (start + Math.min(band, 2) / 2) * cell);
          x.strokeStyle = '#9ca3af'; x.lineWidth = 1; x.beginPath();
          x.moveTo(0, T + start * cell + .5); x.lineTo(L + N * cell, T + start * cell + .5);
          x.moveTo(L + start * cell + .5, 0); x.lineTo(L + start * cell + .5, T + N * cell); x.stroke();
          start = k;
        }
      }
      function formIdxOdd(i) { let c = 0; for (let k = 1; k <= i; k++) if (nodes[k].form !== nodes[k - 1].form) c++; return c % 2 === 1; }
      // hover crosshair
      if (hov) { x.fillStyle = 'rgba(37,99,235,.10)'; x.fillRect(L, T + hov.r * cell, N * cell, cell); x.fillRect(L + hov.c * cell, T, cell, N * cell); }
      // light grid when zoomed in enough, diagonal
      for (let k = 0; k < N; k++) { x.fillStyle = '#e5e7eb'; x.fillRect(L + k * cell, T + k * cell, cell, cell); }
      cells.forEach((e, key) => {
        const r = Math.floor(key / N), c = key % N;
        x.fillStyle = RC.TYPES[prim(e)].color; x.fillRect(L + c * cell + 1, T + r * cell + 1, cell - 1, cell - 1);
        if (cells.has(c * N + r)) { x.strokeStyle = '#dc2626'; x.lineWidth = 1.5; x.strokeRect(L + c * cell + 1.5, T + r * cell + 1.5, cell - 2, cell - 2); }
      });
      if (labels) {
        x.fillStyle = '#111'; x.font = fs + 'px ui-monospace,Menlo,monospace'; x.textBaseline = 'middle';
        nodes.forEach((n, k) => {
          const t = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label;
          x.textAlign = 'right'; x.fillText(t, L - 4, T + k * cell + cell / 2);
          x.save(); x.translate(L + k * cell + cell / 2, T - 4); x.rotate(-Math.PI / 2); x.textAlign = 'left'; x.fillText(t, 0, 0); x.restore();
        });
      }
    };
    createEffect(() => { data(); draw(); });
    const locate = (e) => {
      const { N, cell } = data(); const r0 = cv.getBoundingClientRect();
      const px = e.clientX - r0.left, py = e.clientY - r0.top;
      return { px, py, r: Math.floor((py - T) / cell), c: Math.floor((px - L) / cell), N };
    };
    const onMove = (e) => {
      const { nodes, N, cells } = data(); const p = locate(e);
      const inR = p.r >= 0 && p.r < N, inC = p.c >= 0 && p.c < N;
      const nh = inR && inC ? { r: p.r, c: p.c } : null;
      if ((nh && (!hov || hov.r !== nh.r || hov.c !== nh.c)) || (!nh && hov)) { hov = nh; draw(); }
      if (nh) {
        const ed = cells.get(nh.r * N + nh.c);
        const nm = (n) => (n.field ? n.field + ' @ ' + (n.event || n.form) : n.id);
        setTip({ x: e.clientX + 14, y: e.clientY + 14, row: nm(nodes[nh.r]), col: nm(nodes[nh.c]), e: ed });
      } else setTip(null);
    };
    const onClick = (e) => {
      const { nodes, N, cells } = data(); const p = locate(e);
      if (p.r >= 0 && p.r < N && p.c >= 0 && p.c < N) { const ed = cells.get(p.r * N + p.c); setSelected(ed ? ed.to : nodes[p.r].id); }
      else if (p.r >= 0 && p.r < N && p.px < L) setSelected(nodes[p.r].id);
      else if (p.c >= 0 && p.c < N && p.py < T) setSelected(nodes[p.c].id);
    };
    return html`<div>
      <div class="mxnote small"><label>Cell size <input type="range" min="1" max=${() => Math.min(20, Math.max(1, Math.floor(MAXPX / Math.max(1, data().N))))} value=${() => data().cell} onInput=${(e) => setMxCell(+e.target.value)} style="vertical-align:middle;width:160px"></label>
        <span class="muted">${() => data().cell}px · ${() => data().N} ${() => (view() && view().level === 'field' ? 'fields' : 'nodes')}</span> <button class="link" onClick=${() => setMxCell(0)}>auto</button>
        <span class="muted"> — labels appear at 9px or more; at small sizes hover for names.</span></div>
      <p class="muted small mxnote">Each <b>row</b> depends on the <b>columns</b> where it has a coloured cell (reads: row ← column). Colour = dependency type; a <span style="color:#dc2626;font-weight:600">red outline</span> means the pair depend on each other (circular). Fields are grouped by form (alternating bands), or by event / arm when chosen under Group fields by. Uses the same filters as the graph.</p>
      <${Show} when=${() => data().N > MAXN} fallback=${html`<div class="mxwrap">
          <div class="mxscroll" ref=${(el) => (scroller = el)}>
            <${Show} when=${() => data().N} fallback=${html`<p style="padding:16px;color:#555">Nothing to show with the current filters.</p>`}>
              <canvas ref=${(el) => (cv = el)} onMousemove=${onMove} onMouseleave=${() => { hov = null; setTip(null); draw(); }} onClick=${onClick}></canvas>
            <//>
          </div>
          <${Detail}/>
        </div>`}>
        <p style="padding:16px">${() => data().N} nodes is too many for the matrix. Narrow the view with the Forms list or Focus.</p>
      <//>
      <${Show} when=${tip}>${() => {
        const t = tip(); if (!t) return '';
        return html`<div class="mxtip" style=${`left:${t.x}px;top:${t.y}px`}><b>${t.row}</b> ← <b>${t.col}</b>${t.e ? html`<div>${t.e.types.join(' + ')}${t.e.expr ? html`<div><code>${String(t.e.expr).slice(0, 220)}</code></div>` : ''}</div>` : ''}</div>`;
      }}<//>
    </div>`;
  }

  // ================= app shell =================
  const TABS = [['graph', 'Graph'], ['matrix', 'Matrix'], ['analysis', 'Analysis'], ['deps', 'Dependencies'], ['fields', 'Fields']];
  function Workspace() {
    return html`<main id="app">
      <${Sidebar}/>
      <div id="content">
        <nav id="tabs">
          <${For} each=${TABS}>${([k, l]) => html`<button data-tab=${k} class=${() => (tab() === k ? 'active' : '')} onClick=${() => setTab(k)}>${l}</button>`}<//>
          <span class="grow"></span>
          <div class="dlmenu">
            <button class="btn sm" onClick=${() => setDlOpen(!dlOpen())}>⬇ Download ▾</button>
            <${Show} when=${dlOpen}>
              <div class="dlpop">
                <button onClick=${() => { setDlOpen(false); dlMermaid(); }}>Mermaid (.mmd)</button>
                <button onClick=${() => { setDlOpen(false); dlDot(); }}>Graphviz (.dot)</button>
                <button onClick=${() => { setDlOpen(false); dlSvg(); }}>SVG image</button>
                <button onClick=${() => { setDlOpen(false); dlCsv(); }}>Dependencies (.csv)</button>
              </div>
            <//>
          </div>
        </nav>
        <div class=${() => 'tab' + (tab() === 'graph' ? ' active' : '')} id="tab-graph"><${GraphStage}/></div>
        <${Show} when=${() => tab() === 'matrix'}><div class="tab active"><${MatrixTab}/></div><//>
        <${Show} when=${() => tab() === 'analysis'}><div class="tab active" id="tab-analysis">${AnalysisTab}</div><//>
        <${Show} when=${() => tab() === 'deps'}><div class="tab active" id="tab-deps"><${DepsTab}/></div><//>
        <${Show} when=${() => tab() === 'fields'}><div class="tab active" id="tab-fields"><${FieldsTab}/></div><//>
      </div>
    </main>`;
  }

  function App() {
    return html`<div style="display:contents">
      <header>
        <h1>REDCap field dependencies</h1>
        <div class="hdr-actions">
          <label class="btn primary">Open metadata XML…<input type="file" accept=".xml,text/xml,application/xml" hidden onChange=${(e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; }}></label>
          <button class="btn" onClick=${loadSample}>Load sample</button>
          <span class="muted">${() => { const m = model(); if (!m) return ''; const p = m.parsed; return `${p.projectName} · ${p.fields.length} fields · ${p.forms.length} forms` + (p.redcapVersion ? ` · REDCap ${p.redcapVersion}` : ''); }}</span>
        </div>
      </header>
      <${Show} when=${loadError}><p style="color:var(--danger);padding:8px 16px;margin:0">${loadError}</p><//>
      <${Show} when=${() => !model()}>
        <div class=${() => 'drop' + (dragOver() ? ' over' : '')}>
          <div><strong>Drop a REDCap project XML here</strong><br><span class="muted">Export from REDCap: Project Setup → Other Functionality → “Download metadata only (XML)”. Everything is processed locally in your browser.</span></div>
        </div>
      <//>
      <${Show} when=${model}><${Workspace}/><//>
    </div>`;
  }

  // ---- browser history: back/forward step through tab / level / focus / selection ----
  let lastKey = null;
  createEffect(() => {
    if (!model()) return;
    const st = { m: modelSeq, tab: tab(), level: level(), focus: focus(), pair: pair(), sel: selected(), edge: selEdge() };
    const key = JSON.stringify(st);
    if (key === lastKey) return;
    const sameFile = lastKey !== null && JSON.parse(lastKey).m === st.m;
    try { sameFile ? history.pushState(st, '') : history.replaceState(st, ''); } catch (e) { /* history unavailable */ }
    lastKey = key;
  });
  window.addEventListener('popstate', (e) => {
    const st = e.state;
    if (!st || !model() || st.m !== modelSeq) return;
    lastKey = JSON.stringify(st);
    Solid.batch(() => { setTab(st.tab); setLevel(st.level); setFocus(st.focus); setPair(st.pair); setSelectedRaw(st.sel); setSelEdge(st.edge); });
  });

  RC.loadText = loadText;
  root.textContent = '';
  render(App, root);
})();
