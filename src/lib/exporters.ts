/* Serialise a view to Mermaid and Graphviz DOT, and the dependency list to CSV. */
import { TYPES, nodeInfo } from './graph';
import type { DepType, Edge, Model, NodeKind, View, ViewEdge, ViewNode, ViewOptions } from './types';

const PRIORITY: DepType[] = ['branching', 'calc', 'formlogic', 'actiontag', 'piping', 'embedding', 'logicsrc'];
export const KIND_FILL: Record<NodeKind, string> = { field: '#dbeafe', calc: '#ffedd5', form: '#e5e7eb', missing: '#fee2e2', status: '#dcfce7', logic: '#fce7f3' };
export const KIND_STROKE: Record<NodeKind, string> = { field: '#3b82f6', calc: '#f97316', form: '#6b7280', missing: '#dc2626', status: '#16a34a', logic: '#be185d' };

const isAggregated = (view: View): boolean => view.level === 'form' || view.level === 'event';

/** Whether the view rolls fields up into form or event edges, so line widths and counts apply. */
export const isAggregatedView = isAggregated;

/** Line width for aggregated edges: 1px for one field, growing logarithmically (cap 10px). Null when the lineWidths option is off. */
export const widthOf = (e: ViewEdge, view: View, o: Pick<ViewOptions, 'lineWidths'>): number | null =>
  (o.lineWidths && isAggregated(view) && !e.fieldLevel ? Math.min(10, 1 + 1.6 * Math.log2(Math.max(1, e.count))) : null);

const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const primary = (e: ViewEdge): DepType => PRIORITY.find((t) => e.types.includes(t)) ?? e.types[0];

/** Edge label, the same in every renderer: empty when edge labels are off; otherwise the counts for an aggregated edge, or the dependency types joined by '+'. */
export function edgeText(e: ViewEdge, o: Pick<ViewOptions, 'edgeLabels'>, view: View): string {
  if (!o.edgeLabels) return '';
  if (isAggregated(view) && !e.fieldLevel) {
    return e.types.map((t) => `${t} ${e.byType[t]}`).join(', ') + ` · ${e.count} field${e.count === 1 ? '' : 's'}`;
  }
  return e.types.join('+');
}

/**
 * Colour, dash style, line width and label of one view edge, shared by the DOT and SVG outputs.
 * Colour alone carries the dependency type; the line is solid unless an instance-view cue applies
 * (mismatch is dashed, relative is dotted). `'bold'` is no longer produced; it stays in the type only
 * until the SVG layout renderer stops testing for it.
 */
export function edgeAppearance(view: View, edge: ViewEdge, options: Pick<ViewOptions, 'edgeLabels' | 'lineWidths'>): { color: string; dash: 'solid' | 'bold' | 'dashed' | 'dotted'; width: number | null; label: string } {
  const p = primary(edge);
  let dash: 'solid' | 'bold' | 'dashed' | 'dotted' = 'solid';
  let color: string = TYPES[p].color;
  if (view.instances) {
    if (edge.crossArm) color = '#dc2626';
    if (edge.mismatch) dash = 'dashed'; else if (edge.relative) dash = 'dotted';
  }
  return { color, dash, width: widthOf(edge, view, options), label: edgeText(edge, options, view) };
}

export function nodeLines(n: ViewNode, o: Pick<Partial<ViewOptions>, 'labelMode'>): string[] {
  const lines = [n.label];
  if (n.extra) lines.push(...n.extra);
  if (o.labelMode === 'label' && n.sub) lines.push(trunc(n.sub, 36));
  return lines;
}

// ---------- Mermaid ----------

const mq = (s: string): string => String(s).replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');

/** Link styling collected while the edges are emitted (keys keep first-seen order). */
type LinkStyle =
  | { kind: 'width'; idx: number; p: DepType; wd: number }
  | { kind: 'type'; p: DepType; lines: number[] };

export function toMermaid(view: View, o: ViewOptions): string {
  const id = new Map(view.nodes.map((n, i) => [n.id, 'n' + i] as const));
  const L = [`flowchart ${o.dir}`];
  const node = (n: ViewNode): string => `${id.get(n.id)}["${nodeLines(n, o).map(mq).join('<br/>')}"]:::${n.kind}`;
  const grouped = new Set<string>();
  const emitG = (gr: (typeof view.groups)[number], ind: string): void => { // groups may nest through `parent`
    const i = view.groups.indexOf(gr);
    L.push(`${ind}subgraph g${i}["${mq(gr.label)}"]`);
    gr.nodes.forEach((v) => {
      grouped.add(v);
      const vn = view.nodes.find((n) => n.id === v);
      if (vn) L.push(ind + '  ' + node(vn));
    });
    view.groups.filter((c) => c.parent != null && c.parent === gr.id).forEach((c) => emitG(c, ind + '  '));
    L.push(ind + 'end');
  };
  view.groups.filter((gr) => gr.parent == null).forEach((gr) => emitG(gr, '  '));
  view.nodes.forEach((n) => { if (!grouped.has(n.id)) L.push('  ' + node(n)); });

  const styles = new Map<string, LinkStyle>();
  const extraLs: string[] = [];
  let li = 0;
  view.edges.forEach((e) => {
    if (!id.has(e.from) || !id.has(e.to)) return;
    const p = primary(e);
    const t = edgeText(e, o, view);
    L.push(`  ${id.get(e.from)} -->${t ? `|"${mq(t)}"|` : ''} ${id.get(e.to)}`);
    const wd = widthOf(e, view, o);
    if (wd) {
      styles.set('#' + li, { kind: 'width', idx: li, p, wd });
    } else {
      const s = styles.get(p);
      if (s && s.kind === 'type') s.lines.push(li);
      else styles.set(p, { kind: 'type', p, lines: [li] });
    }
    if (view.instances) {
      if (e.crossArm) extraLs.push(`  linkStyle ${li} stroke:#dc2626`);
      if (e.mismatch || e.relative) extraLs.push(`  linkStyle ${li} stroke-dasharray:${e.mismatch ? '6 4' : '2 3'}`);
    }
    li++;
  });
  styles.forEach((s) => {
    if (s.kind === 'width') L.push(`  linkStyle ${s.idx} stroke:${TYPES[s.p].color},stroke-width:${s.wd.toFixed(1)}px`);
    else L.push(`  linkStyle ${s.lines.join(',')} stroke:${TYPES[s.p].color},stroke-width:1.5px`);
  });
  L.push(...extraLs);
  (Object.keys(KIND_FILL) as NodeKind[]).forEach((k) =>
    L.push(`  classDef ${k} fill:${KIND_FILL[k]},stroke:${KIND_STROKE[k]},color:#111${k === 'missing' ? ',stroke-dasharray:4 3' : ''}`));
  const focus = view.nodes.find((n) => n.focus);
  if (focus) L.push(`  style ${id.get(focus.id)} stroke-width:4px`);
  return L.join('\n') + '\n';
}

// ---------- Graphviz DOT ----------

const dq = (s: string): string => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

export function toDot(view: View, o: ViewOptions): string {
  const id = new Map(view.nodes.map((n, i) => [n.id, 'n' + i] as const));
  const L = [
    'digraph REDCapDependencies {',
    `  rankdir=${o.dir === 'TD' ? 'TB' : 'LR'};`,
    '  graph [fontname="Helvetica", fontsize=11, compound=true, nodesep=0.25, ranksep=0.6];',
    '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10, margin="0.12,0.06"];',
    '  edge [fontname="Helvetica", fontsize=8, arrowsize=0.7];',
  ];
  const node = (n: ViewNode, ind: string): string => {
    const lab = nodeLines(n, o).join('\n');
    const extra = n.kind === 'missing' ? ', style="rounded,filled,dashed"' : '';
    const pw = n.focus ? ', penwidth=3' : '';
    return `${ind}${id.get(n.id)} [label=${dq(lab)}, fillcolor="${KIND_FILL[n.kind]}", color="${KIND_STROKE[n.kind]}"${extra}${pw}];`;
  };
  const grouped = new Set<string>();
  const emitG = (gr: (typeof view.groups)[number], ind: string): void => {
    const i = view.groups.indexOf(gr);
    L.push(`${ind}subgraph cluster_${i} {`, `${ind}  label=${dq(gr.label)}; style="rounded"; color="#9ca3af"; fontcolor="#374151";`);
    gr.nodes.forEach((v) => {
      grouped.add(v);
      const vn = view.nodes.find((n) => n.id === v);
      if (vn) L.push(node(vn, ind + '  '));
    });
    view.groups.filter((c) => c.parent != null && c.parent === gr.id).forEach((c) => emitG(c, ind + '  '));
    L.push(ind + '}');
  };
  view.groups.filter((gr) => gr.parent == null).forEach((gr) => emitG(gr, '  '));
  view.nodes.forEach((n) => { if (!grouped.has(n.id)) L.push(node(n, '  ')); });
  view.edges.forEach((e) => {
    if (!id.has(e.from) || !id.has(e.to)) return;
    const look = edgeAppearance(view, e, o);
    const wd = look.width;
    L.push(`  ${id.get(e.from)} -> ${id.get(e.to)} [color="${look.color}", style=${look.dash}${wd ? ', penwidth=' + wd.toFixed(1) : ''}${look.label ? ', label=' + dq(look.label) : ''}];`);
  });
  L.push('}');
  return L.join('\n') + '\n';
}

// ---------- CSV ----------

export function toCsv(model: Model, edges: Edge[]): string {
  const q = (s: string | number | null | undefined): string => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows: string[][] = [['source_field', 'source_form', 'dependent_field', 'dependent_form', 'dependency_type', 'expression']];
  edges.forEach((e) => {
    const t = nodeInfo(model, e.to);
    const logic = 'logicNode' in t ? t : null;
    rows.push([
      e.from, nodeInfo(model, e.from).form,
      logic ? logic.label || e.to : e.to, logic ? '' : t.form,
      logic ? 'logic source' + (logic.kind ? ': ' + logic.kind : '') : e.type, e.expr,
    ]);
  });
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
