/* Serialise a view to Mermaid and Graphviz DOT. */
(function (g) {
  'use strict';
  const RC = (g.RC = g.RC || {});
  const PRIORITY = ['branching', 'calc', 'formlogic', 'actiontag', 'piping'];
  const KIND_FILL = { field: '#dbeafe', calc: '#ffedd5', form: '#e5e7eb', missing: '#fee2e2', status: '#dcfce7' };
  const KIND_STROKE = { field: '#3b82f6', calc: '#f97316', form: '#6b7280', missing: '#dc2626', status: '#16a34a' };

  // line width for form-level edges: 1px for one field, growing logarithmically (cap 10px)
  const widthOf = (e, view) => (view.level === 'form' && !e.fieldLevel ? Math.min(10, 1 + 1.6 * Math.log2(Math.max(1, e.count))) : null);
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const primary = (e) => PRIORITY.find((t) => e.types.includes(t));
  function edgeText(e, o, view) {
    if (view.level === 'form' && !e.fieldLevel) return e.types.map((t) => `${t} ${e.byType[t]}`).join(', ') + ` · ${e.count} field${e.count === 1 ? '' : 's'}`;
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
    view.groups.forEach((gr, i) => {
      L.push(`  subgraph g${i}["${mq(gr.label)}"]`);
      gr.nodes.forEach((v) => { grouped.add(v); L.push('    ' + node(view.nodes.find((n) => n.id === v))); });
      L.push('  end');
    });
    view.nodes.forEach((n) => { if (!grouped.has(n.id)) L.push('  ' + node(n)); });
    const styles = {};
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
      li++;
    });
    Object.keys(styles).forEach((k) => {
      if (k[0] === '#') { const x = styles[k]; L.push(`  linkStyle ${x.idx} stroke:${RC.TYPES[x.p].color},stroke-width:${x.wd.toFixed(1)}px`); }
      else L.push(`  linkStyle ${styles[k].join(',')} stroke:${RC.TYPES[k].color},stroke-width:1.5px`);
    });
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
    view.groups.forEach((gr, i) => {
      L.push(`  subgraph cluster_${i} {`, `    label=${dq(gr.label)}; style="rounded"; color="#9ca3af"; fontcolor="#374151";`);
      gr.nodes.forEach((v) => { grouped.add(v); L.push(node(view.nodes.find((n) => n.id === v), '    ')); });
      L.push('  }');
    });
    view.nodes.forEach((n) => { if (!grouped.has(n.id)) L.push(node(n, '  ')); });
    view.edges.forEach((e) => {
      if (!id.has(e.from) || !id.has(e.to)) return;
      const p = primary(e);
      const t = edgeText(e, o, view);
      const style = p === 'calc' ? 'bold' : p === 'branching' ? 'solid' : 'dashed';
      const wd = widthOf(e, view);
      L.push(`  ${id.get(e.from)} -> ${id.get(e.to)} [color="${RC.TYPES[p].color}", style=${style}${wd ? ', penwidth=' + wd.toFixed(1) : ''}${t ? ', label=' + dq(t) : ''}];`);
    });
    L.push('}');
    return L.join('\n') + '\n';
  }

  function toCsv(model, edges) {
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const rows = [['source_field', 'source_form', 'dependent_field', 'dependent_form', 'dependency_type', 'expression']];
    edges.forEach((e) => rows.push([e.from, RC.nodeInfo(model, e.from).form, e.to, RC.nodeInfo(model, e.to).form, e.type, e.expr]));
    return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  }

  RC.toMermaid = toMermaid;
  RC.toDot = toDot;
  RC.toCsv = toCsv;
})(window);
