/* Serialise a view to Mermaid and Graphviz DOT. */
import { TYPES, nodeInfo } from './graph.js';

const PRIORITY = ['branching', 'calc', 'formlogic', 'actiontag', 'piping', 'logicsrc'];
const KIND_FILL = { field: '#dbeafe', calc: '#ffedd5', form: '#e5e7eb', missing: '#fee2e2', status: '#dcfce7', logic: '#fce7f3' };
const KIND_STROKE = { field: '#3b82f6', calc: '#f97316', form: '#6b7280', missing: '#dc2626', status: '#16a34a', logic: '#be185d' };

// line width for form-level edges: 1px for one field, growing logarithmically (cap 10px)
const widthOf = (e, view) => ((view.level === 'form' || view.level === 'event') && !e.fieldLevel ? Math.min(10, 1 + 1.6 * Math.log2(Math.max(1, e.count))) : null);
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const primary = (e) => PRIORITY.find((t) => e.types.includes(t));
function edgeText(e, o, view) {
  if ((view.level === 'form' || view.level === 'event') && !e.fieldLevel) return e.types.map((t) => `${t} ${e.byType[t]}`).join(', ') + ` · ${e.count} field${e.count === 1 ? '' : 's'}`;
  return o.edgeLabels ? e.types.join('+') : '';
}
function nodeLines(n, o, wrap) {
  const lines = [n.label];
  if (n.extra) lines.push(...n.extra);
  if (view_sub(n, o)) lines.push(trunc(n.sub, 36));
  return lines;
}
function view_sub(n, o) { return o.labelMode === 'label' && n.sub; }

// ---------- Mermaid ----------
const mq = (s) => String(s).replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
function toMermaid(view, o) {
  const id = new Map(view.nodes.map((n, i) => [n.id, 'n' + i]));
  const L = [`flowchart ${o.dir}`];
  const node = (n) => `${id.get(n.id)}["${nodeLines(n, o).map(mq).join('<br/>')}"]:::${n.kind}`;
  const grouped = new Set();
  const emitG = (gr, ind) => { // groups may nest through `parent` (instance clusters inside event bands)
    const i = view.groups.indexOf(gr);
    L.push(`${ind}subgraph g${i}["${mq(gr.label)}"]`);
    gr.nodes.forEach((v) => { grouped.add(v); L.push(ind + '  ' + node(view.nodes.find((n) => n.id === v))); });
    view.groups.filter((c) => c.parent != null && c.parent === gr.id).forEach((c) => emitG(c, ind + '  '));
    L.push(ind + 'end');
  };
  view.groups.filter((gr) => gr.parent == null).forEach((gr) => emitG(gr, '  '));
  view.nodes.forEach((n) => { if (!grouped.has(n.id)) L.push('  ' + node(n)); });
  const styles = {};
  const extraLs = [];
  let li = 0;
  view.edges.forEach((e) => {
    if (!id.has(e.from) || !id.has(e.to)) return;
    const p = primary(e);
    const arrow = p === 'calc' ? '==>' : p === 'branching' ? '-->' : '-.->';
    const t = edgeText(e, o, view);
    L.push(`  ${id.get(e.from)} ${arrow}${t ? `|"${mq(t)}"|` : ''} ${id.get(e.to)}`);
    const wd = widthOf(e, view);
    if (wd) styles['#' + li] = { idx: li, p, wd };
    else (styles[p] = styles[p] || []).push(li);
    if (view.instances) {
      if (e.crossArm) extraLs.push(`  linkStyle ${li} stroke:#dc2626`);
      if (e.mismatch || e.relative) extraLs.push(`  linkStyle ${li} stroke-dasharray:${e.mismatch ? '6 4' : '2 3'}`);
    }
    li++;
  });
  Object.keys(styles).forEach((k) => {
    if (k[0] === '#') { const x = styles[k]; L.push(`  linkStyle ${x.idx} stroke:${TYPES[x.p].color},stroke-width:${x.wd.toFixed(1)}px`); }
    else L.push(`  linkStyle ${styles[k].join(',')} stroke:${TYPES[k].color},stroke-width:1.5px`);
  });
  L.push(...extraLs);
  Object.keys(KIND_FILL).forEach((k) => L.push(`  classDef ${k} fill:${KIND_FILL[k]},stroke:${KIND_STROKE[k]},color:#111${k === 'missing' ? ',stroke-dasharray:4 3' : ''}`));
  const focus = view.nodes.find((n) => n.focus);
  if (focus) L.push(`  style ${id.get(focus.id)} stroke-width:4px`);
  return L.join('\n') + '\n';
}

// ---------- Graphviz DOT ----------
const dq = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
function toDot(view, o) {
  const id = new Map(view.nodes.map((n, i) => [n.id, 'n' + i]));
  const L = [
    'digraph REDCapDependencies {',
    `  rankdir=${o.dir === 'TD' ? 'TB' : 'LR'};`,
    '  graph [fontname="Helvetica", fontsize=11, compound=true, nodesep=0.25, ranksep=0.6];',
    '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10, margin="0.12,0.06"];',
    '  edge [fontname="Helvetica", fontsize=8, arrowsize=0.7];',
  ];
  const node = (n, ind) => {
    const lab = nodeLines(n, o).join('\n');
    const extra = n.kind === 'missing' ? ', style="rounded,filled,dashed"' : '';
    const pw = n.focus ? ', penwidth=3' : '';
    return `${ind}${id.get(n.id)} [label=${dq(lab)}, fillcolor="${KIND_FILL[n.kind]}", color="${KIND_STROKE[n.kind]}"${extra}${pw}];`;
  };
  const grouped = new Set();
  const emitG = (gr, ind) => {
    const i = view.groups.indexOf(gr);
    L.push(`${ind}subgraph cluster_${i} {`, `${ind}  label=${dq(gr.label)}; style="rounded"; color="#9ca3af"; fontcolor="#374151";`);
    gr.nodes.forEach((v) => { grouped.add(v); L.push(node(view.nodes.find((n) => n.id === v), ind + '  ')); });
    view.groups.filter((c) => c.parent != null && c.parent === gr.id).forEach((c) => emitG(c, ind + '  '));
    L.push(ind + '}');
  };
  view.groups.filter((gr) => gr.parent == null).forEach((gr) => emitG(gr, '  '));
  view.nodes.forEach((n) => { if (!grouped.has(n.id)) L.push(node(n, '  ')); });
  view.edges.forEach((e) => {
    if (!id.has(e.from) || !id.has(e.to)) return;
    const p = primary(e);
    const t = edgeText(e, o, view);
    let style = p === 'calc' ? 'bold' : p === 'branching' ? 'solid' : 'dashed';
    let col = TYPES[p].color;
    if (view.instances) {
      if (e.crossArm) col = '#dc2626';
      if (e.mismatch) style = 'dashed'; else if (e.relative) style = 'dotted';
    }
    const wd = widthOf(e, view);
    L.push(`  ${id.get(e.from)} -> ${id.get(e.to)} [color="${col}", style=${style}${wd ? ', penwidth=' + wd.toFixed(1) : ''}${t ? ', label=' + dq(t) : ''}];`);
  });
  L.push('}');
  return L.join('\n') + '\n';
}

function toCsv(model, edges) {
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['source_field', 'source_form', 'dependent_field', 'dependent_form', 'dependency_type', 'expression']];
  edges.forEach((e) => {
    const t = nodeInfo(model, e.to);
    const logic = t && t.logicNode;
    rows.push([
      e.from, nodeInfo(model, e.from).form,
      logic ? t.label || e.to : e.to, logic ? '' : t.form,
      logic ? 'logic source' + (t.kind ? ': ' + t.kind : '') : e.type, e.expr,
    ]);
  });
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
export { toMermaid, toDot, toCsv };
