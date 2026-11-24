/* Detail panel: logic code, explore buttons, form / instance / event / edge summaries. */
import { Show } from 'solid-js';
import { TYPES, nodeInfo, neighbors, isRepeatingInstance, formIsRepeating } from '../lib/graph.js';
import {
  model, view, opts, level, selected, selEdge, setSelEdge, setSelected, setLevel, setFocus, setPair, setExplore, expanded,
  curEx, exVisible, instMode, formLabel, expandRef, collapseRef, toggleExpandForm, jumpToField,
} from '../store.js';

const TOKEN_RE = /(\[[A-Za-z][A-Za-z0-9_]*(?:\([^)\]]*\))?(?::[A-Za-z0-9_]+)?\])/;

function repEvents(parsed, fm) {
  const evs = (parsed.repeatingInstruments || []).filter((r) => r.form === fm.id).map((r) => r.event);
  return [...new Set(evs)].map((id) => ((parsed.events || []).find((e) => e.id === id) || { label: id }).label).join(', ');
}

function Tag(props) {
  return <span class="tag" style={`background:${TYPES[props.type].color}`}>{props.type}</span>;
}

/** Logic code with clickable [variable] references (red when undefined). */
function CodeBlock(props) {
  const nodes = () => props.text.split(TOKEN_RE).map((p) => {
    const m = /^\[([A-Za-z][A-Za-z0-9_]*)/.exec(p);
    if (!m || p[0] !== '[') return p;
    const ok = model().byVar.has(m[1]);
    return ok ? <span class="ref" style="cursor:pointer" onClick={() => setSelected(m[1])}>{p}</span> : <span class="ref bad">{p}</span>;
  });
  return (
    <Show when={props.text}>
      <div><h4>{props.title} {props.copyable ? <button class="link" onClick={(e) => { navigator.clipboard && navigator.clipboard.writeText(props.text); e.target.textContent = 'copied'; }}>copy</button> : ''}</h4><pre>{nodes()}</pre></div>
    </Show>
  );
}

function Chips(props) {
  return (
    <>
      {props.items.length
        ? <div class="chips">{props.items.map((x) => <button class="chip" title={x.t} onClick={() => setSelected(x.id)}>{x.id}</button>)}</div>
        : <span class="muted small">none</span>}
    </>
  );
}

function exploreButton(m, t, dir, label, tip) {
  const ex = curEx(), vis = ex ? exVisible(ex) : new Set();
  const nb = neighbors(m, opts(), t, dir);
  const open = !!(ex && ex.exp.some((x) => x.node === t && x.dir === dir));
  const fresh = nb.filter((x) => !vis.has(x)).length;
  return <button class="btn sm" title={tip} disabled={!nb.length && !open} onClick={() => (open ? collapseRef(t, dir) : expandRef(t, dir))}>{open ? 'Collapse ' : 'Expand '}{label} ({open ? nb.length : fresh})</button>;
}

function ExploreButtons(props) {
  return <>{exploreRow(props.id)}</>;
}
function exploreRow(id) {
  const m = model();
  if (instMode()) return instanceExploreRow(id);
  // at form level the target is the form owning the selected node
  const isGroup = id.startsWith('@form:');
  const t = level() === 'form' ? (m.formsById.has(id) || id === '(unknown)' ? id : (nodeInfo(m, id) || {}).form) : id;
  const fid = isGroup ? id.slice(6) : (nodeInfo(m, id) || {}).form;
  if (!t) return '';
  const btn = (dir, label, tip) => exploreButton(m, t, dir, label, tip);
  return (
    <div class="exrow">
      {isGroup ? '' : <>{btn('up', '◀ back refs', 'Add what this depends on')}{btn('down', 'forward refs ▶', 'Add what depends on this')}</>}
      {level() === 'field' && fid ? <>{isGroup ? '' : <div class="muted small" style="width:100%">Whole form <b>{formLabel(fid)}</b>:</div>}
        {btn('fup', '◀ form back refs', 'Add every field in other forms that this form depends on (with the fields in this form they feed)')}{btn('fdown', 'form forward refs ▶', 'Add every field in other forms that depends on this form (with the fields in this form they use)')}</> : ''}
      {level() === 'form' && t !== id ? <div class="muted small" style="width:100%">applies to its form: {formLabel(t)}</div> : ''}
    </div>
  );
}
// Instances mode: the explore target is an instance node (form@event); a plain field or form id resolves to its only instance
function instanceExploreRow(id) {
  const m = model(), v = view();
  const all = v ? [...v.nodes, ...(v.expandedNodes || [])].filter((n) => !n.field) : [];
  let t = all.some((n) => n.id === id) ? id : null;
  if (!t) {
    const fid = id.startsWith('@form:') ? id.slice(6) : (nodeInfo(m, id) || {}).form;
    const c = all.filter((n) => n.form === fid);
    if (c.length === 1) t = c[0].id;
    else return <div class="muted small" style="margin:6px 0">{c.length ? "Select one of this form's instance nodes to expand its references." : ''}</div>;
  }
  const btn = (dir, label, tip) => exploreButton(m, t, dir, label, tip);
  return (
    <div class="exrow">{btn('up', '◀ back refs', 'Add the instances this one depends on')}{btn('down', 'forward refs ▶', 'Add the instances that depend on this one')}
      {t !== id ? <div class="muted small" style="width:100%">applies to the instance node {t}</div> : ''}</div>
  );
}

// a form box (cluster) clicked in the field-level graph
function groupDetail(fid) {
  const m = model(), fm = m.formsById.get(fid), o = opts();
  const label = fm ? fm.label : fid;
  const linked = new Set();
  m.edges.forEach((e) => { if (o.types.has(e.type) && (o.showMissing || !e.missing)) { linked.add(e.from); linked.add(e.to); } });
  const inForm = fm ? fm.fields.filter((v) => linked.has(v)) : [];
  const seeds = ['@form:' + fid, ...(inForm.length ? inForm : fm ? fm.fields : [])];
  return (
    <div><h3>{label}</h3><div class="muted small">form <code>{fid}</code> · {fm ? fm.fields.length : 0} fields · {inForm.length} with dependencies</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick={() => { setPair(null); setFocus(''); setExplore({ level: 'field', seeds, exp: [] }); }}>Focus on this form</button></p>
      <ExploreButtons id={'@form:' + fid} />
      <p class="muted small">Focus shows this form's linked fields only; then expand back / forward references from the whole form. Select any node to expand it individually.</p></div>
  );
}

function detailContent(id, inst) {
  // an expanded field node of the Instances view is `variable@@instanceId`: show the field, explore its instance
  const at = !inst ? id.indexOf('@@') : -1;
  if (at > 0) return detailContent(id.slice(0, at), id.slice(at + 2));
  if (id.startsWith('@form:')) return groupDetail(id.slice(6));
  const m = model(), A = m.analysis, info = nodeInfo(m, id);
  if (!info && instMode()) { const d = instanceDetail(id); if (d) return d; }
  if (!info) { // form-level node
    if (id === '(unknown)') return <div><h3>Undefined fields</h3><div class="muted small">fields referenced by logic but not defined in the project</div><ExploreButtons id={id} /></div>;
    const ev = (m.parsed.events || []).find((x) => x.id === id);
    if (ev) return eventDetail(ev);
    const fm = m.formsById.get(id); if (!fm) return '';
    const cross = m.edges.filter((e) => !e.missing && e.type !== 'logicsrc' && (nodeInfo(m, e.from).form === id) !== (nodeInfo(m, e.to).form === id));
    return (
      <div><h3>{fm.label}</h3><div class="muted small">form <code>{fm.id}</code> · {fm.fields.length} fields{formIsRepeating(m.parsed, fm) ? ' · repeating' + (repEvents(m.parsed, fm) ? ' in ' + repEvents(m.parsed, fm) : '') : ''}</div>
        {instMode() ? '' : <p style="margin:8px 0"><button class="btn sm primary" onClick={() => toggleExpandForm(id)}>{expanded().has(id) ? 'Collapse back to form' : 'Zoom into fields'}</button></p>}
        <ExploreButtons id={id} />
        <h4>Cross-form dependencies ({cross.length})</h4>
        {cross.length ? cross.map((e) => <div class="small" style="margin-bottom:6px">
          <button class="fieldlink" onClick={() => setSelected(e.from)}>{e.from}</button> → <button class="fieldlink" onClick={() => setSelected(e.to)}>{e.to}</button> <Tag type={e.type} /><pre>{e.expr}</pre></div>) : <span class="muted small">none</span>}</div>
    );
  }
  if (info.formNode) {
    return (
      <div><h3>Form: {info.label}</h3><div class="muted small">form display logic target</div><ExploreButtons id={inst || id} />{info.logic.map((l, i) => <>
        <CodeBlock title="Display condition" text={l} copyable={true} /><div class="muted small" style="margin:-2px 0 8px">Applies in event{(info.logicEvents[i] || []).length === 1 ? '' : 's'}: {(info.logicEvents[i] || []).length ? (info.logicEvents[i]).map((ev) => <><code>{ev}</code> </>) : 'all events'}</div></>)}</div>
    );
  }
  if (info.logicNode) {
    return (
      <div><h3>{info.label}</h3><div class="muted small">logic source · <code>{info.kind}</code></div><ExploreButtons id={inst || id} />
        <CodeBlock title="Logic" text={info.logic} copyable={true} />
        <h4>Reads fields ({A.inn.get(id).length})</h4><Chips items={A.inn.get(id).map((e) => ({ id: e.from, t: e.type }))} /></div>
    );
  }
  if (info.ghost) return <div><h3>{id}</h3><div class="muted small">Referenced but not defined in this project</div><ExploreButtons id={inst || id} /><h4>Used by</h4><Chips items={A.out.get(id).map((e) => ({ id: e.to, t: e.type }))} /></div>;
  const f = info;
  const up = A.inn.get(id).map((e) => ({ id: e.from, t: e.type })), down = A.out.get(id).map((e) => ({ id: e.to, t: e.type }));
  return (
    <div>
      <h3>{f.variable}</h3>
      <div class="muted small">{f.type} · form <b>{formLabel(f.form)}</b>{f.required ? ' · required' : ''}</div>
      {f.label ? <p style="margin:6px 0">{f.label}</p> : ''}
      {f.media && (f.media.inlineImage || f.media.videoUrl) ? <div class="muted small" style="margin:6px 0">Media: {[f.media.inlineImage ? 'inline image ' + f.media.inlineImage : '', f.media.videoUrl ? 'video ' + f.media.videoUrl + (f.media.videoInline ? ' (inline)' : '') : ''].filter(Boolean).join(' · ')}</div> : ''}
      <ExploreButtons id={inst || id} />
      <p style="margin:6px 0"><button class="btn sm" onClick={() => { setLevel('field'); setExplore(null); setFocus(id); }}>Focus graph on this field</button></p>
      <CodeBlock title="Branching logic" text={f.branching} copyable={true} /><CodeBlock title="Calculation" text={f.calc} copyable={true} /><CodeBlock title="Action tags / annotation" text={f.annotation} copyable={true} />
      <CodeBlock title="Section header (piping)" text={f.section} /><CodeBlock title="Field note (piping)" text={f.note} />
      {!f.branching && !f.calc && !f.annotation ? <p class="muted small">No logic code on this field.</p> : ''}
      {f.choices.length ? <div><h4>Choices</h4><pre>{f.choices.map((c) => c.code + ', ' + c.label).join('\n')}</pre></div> : ''}
      <h4>Depends on ({up.length})</h4><Chips items={up} /><h4>Used by ({down.length})</h4><Chips items={down} /></div>
  );
}

// a node of the Instances view: form@event (or a plain form id when the form is in one event)
function instanceDetail(id) {
  const v = view(), m = model(); if (!v || !v.instances) return '';
  const nodes = [...(v.nodes || []), ...(v.expandedNodes || [])].filter((x) => !x.field), n = nodes.find((x) => x.id === id);
  if (!n || !n.form) return '';
  const fm = m.formsById.get(n.form), evs = m.parsed.events || [];
  const evLabel = (eid) => { const e = evs.find((x) => x.id === eid); return e ? e.label : eid || ''; };
  const fm0 = (x) => { const f = m.formsById.get(x.form); return f ? f.label : x.form || x.id; };
  const nlabel = (nid) => { const x = nodes.find((y) => y.id === nid); return x ? (fm0(x) + (x.event ? ' @ ' + evLabel(x.event) : '')) : nid; };
  const others = nodes.filter((x) => x.form === n.form && x.id !== n.id);
  const ie = v.instEdges || v.edges || [], inn = ie.filter((e) => e.to === id && e.from !== id), out = ie.filter((e) => e.from === id && e.to !== id);
  const flags = (e) => ['cross', 'mismatch', 'relative', 'crossArm'].filter((k) => e[k]).map((k) => <><span class="tag" style="background:#6b7280">{k === 'crossArm' ? 'cross-arm' : k}</span> </>);
  const row = (e, other) => <div class="small" style="margin-bottom:4px"><button class="fieldlink" onClick={() => setSelected(other)}>{nlabel(other)}</button> {flags(e)}</div>;
  return (
    <div><h3>{fm ? fm.label : n.form}{n.event ? ' @ ' + evLabel(n.event) : ''}</h3>
      <div class="muted small">form <code>{n.form}</code>{n.event ? <> · event <code>{n.event}</code></> : ''}{fm ? ' · ' + fm.fields.length + ' fields' : ''}{fm && (n.event ? isRepeatingInstance(m.parsed, fm, n.event) : fm.repeating) ? ' · repeating' : ''}</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick={() => toggleExpandForm(id)}>{expanded().has(id) ? 'Collapse back to form' : 'Zoom into fields'}</button></p>
      <ExploreButtons id={id} />
      {others.length ? <><h4>Also collected in ({others.length})</h4><div class="chips">{others.map((x) => <button class="chip" onClick={() => setSelected(x.id)}>{evLabel(x.event)}</button>)}</div></> : ''}
      <h4>Incoming from other instances ({inn.length})</h4>{inn.length ? inn.map((e) => row(e, e.from)) : <span class="muted small">none</span>}
      <h4>Outgoing to other instances ({out.length})</h4>{out.length ? out.map((e) => row(e, e.to)) : <span class="muted small">none</span>}</div>
  );
}

// an event box clicked in the event-level graph
function eventDetail(ev) {
  const m = model();
  const out = m.edges.filter((e) => (e.events || []).includes(ev.id));
  const inn = m.edges.filter((e) => (m.parsed.events.some((x) => x.forms.includes(nodeInfo(m, e.to).form) && x.id === ev.id)) && (e.events || []).some((x) => x !== ev.id));
  const row = (e) => <div class="small" style="margin-bottom:6px"><button class="fieldlink" onClick={() => jumpToField(e.from)}>{e.from}</button> → <button class="fieldlink" onClick={() => jumpToField(e.to)}>{e.to}</button> <Tag type={e.type} /> <span class="muted">{(e.events || []).join(', ')}</span><pre>{e.expr}</pre></div>;
  return (
    <div><h3>{ev.label}</h3><div class="muted small">event <code>{ev.id}</code>{ev.arm ? ' · arm ' + ev.arm + (ev.armName ? ' (' + ev.armName + ')' : '') : ''}{ev.repeating ? ' · repeating' : ''}</div>
      <p class="small" style="margin:6px 0">Forms: {ev.forms.map(formLabel).join(', ') || 'none'}</p>
      {(m.parsed.repeatingInstruments || []).filter((r) => r.event === ev.id).length ? <p class="small" style="margin:6px 0">Repeating instruments: {(m.parsed.repeatingInstruments || []).filter((r) => r.event === ev.id).map((r) => r.label || formLabel(r.form)).join(', ')}</p> : ''}
      <h4>Read from this event ({out.length})</h4>{out.length ? out.map(row) : <span class="muted small">none</span>}
      <h4>Reads other events ({inn.length})</h4>{inn.length ? inn.map(row) : <span class="muted small">none</span>}</div>
  );
}

// form-level edge: the fields that make up the link
function edgeDetail(ed) {
  const m = model(), o = opts();
  const fl = (id) => (id === '(unknown)' ? 'Undefined fields' : formLabel(id));
  const es = m.edges.filter((e) => o.types.has(e.type) && (o.showMissing || !e.missing) && nodeInfo(m, e.from).form === ed.from && nodeInfo(m, e.to).form === ed.to);
  const byDep = new Map();
  es.forEach((e) => { if (!byDep.has(e.to)) byDep.set(e.to, []); byDep.get(e.to).push(e); });
  const srcs = new Set(es.map((e) => e.from));
  return (
    <div>
      <h3>{fl(ed.from)} → {fl(ed.to)}</h3>
      <div class="muted small">{srcs.size} source field{srcs.size === 1 ? '' : 's'} · {byDep.size} dependent field{byDep.size === 1 ? '' : 's'} · {es.length} dependenc{es.length === 1 ? 'y' : 'ies'}</div>
      <p style="margin:8px 0"><button class="btn sm primary" onClick={() => { setLevel('field'); setFocus(''); setPair({ from: ed.from, to: ed.to }); setSelEdge(null); }}>Show these fields in the field graph</button></p>
      {[...byDep.entries()].map(([dep, list]) => <div style="margin-bottom:10px">
        <button class="fieldlink" style="font-weight:600" onClick={() => setSelected(dep)}>{dep}</button>
        <span class="muted small"> depends on </span>
        {list.map((e) => <div class="small" style="margin:3px 0"><Tag type={e.type} /> <button class="fieldlink" onClick={() => setSelected(e.from)}>{e.from}</button><pre>{e.expr}</pre></div>)}
      </div>)}
    </div>
  );
}

export default function Detail() {
  return (
    <Show when={selected() || selEdge()}>
      <aside id="detail">
        <button class="link" style="float:right" onClick={() => { setSelected(null); setSelEdge(null); }}>✕ close</button>
        {selEdge() ? edgeDetail(selEdge()) : selected() ? detailContent(selected()) : ''}
      </aside>
    </Show>
  );
}

export { Tag };
