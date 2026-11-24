/* Dependency structure matrix: rows depend on the columns where they have a coloured cell. */
import { Show, createMemo, createSignal, createEffect } from 'solid-js';
import { TYPES } from '../lib/graph';
import type { DepType, Form, ViewEdge, ViewGroup, ViewNode } from '../lib/types';
import { need, model, view, groupBy, mxCell, setMxCell, setSelected } from '../store';
import Detail from './Detail';

const L = 230, T = 130, MAXN = 6000, MAXPX = 14000;
const PRIORITY: DepType[] = ['branching', 'calc', 'formlogic', 'actiontag', 'piping', 'logicsrc'];
const prim = (e: ViewEdge): DepType => PRIORITY.find((t) => e.types.includes(t)) ?? e.types[0];

/** A view node placed in the matrix, with its band (form or event / arm group). */
interface MxNode extends ViewNode {
  i: number;
  gi: number;
  gLabel?: string;
}

interface MxData {
  nodes: MxNode[];
  N: number;
  cells: Map<number, ViewEdge>;
  cell: number;
  auto: number;
  formsById: Map<string, Form>;
}

interface Tip {
  x: number;
  y: number;
  row: string;
  col: string;
  e: ViewEdge | undefined;
}

export default function MatrixTab() {
  let cv!: HTMLCanvasElement;
  const [tip, setTip] = createSignal<Tip | null>(null);
  const data = createMemo<MxData>(() => {
    const v = need(view()), m = need(model());
    const formIdx = new Map(m.parsed.forms.map((f, i) => [f.id, i] as const));
    // "Group fields by" event / arm re-bands the matrix by that group instead of by form
    const useGroups = (v.level === 'field' && (groupBy() === 'event' || groupBy() === 'arm')) || !!v.instances;
    const gs: ViewGroup[] = useGroups ? (v.groups || []) : [];
    const gOf = new Map<string, { gi: number; g: ViewGroup }>();
    gs.forEach((g, gi) => (g.nodes || []).forEach((id) => gOf.set(id, { gi, g })));
    const nodes: MxNode[] = v.nodes
      .map((n, i): MxNode => {
        const o = gOf.get(n.id);
        return o ? { ...n, i, form: o.g.id, gLabel: o.g.label, gi: o.gi } : { ...n, i, gi: 999 };
      })
      .sort((a, b) => (gs.length ? a.gi - b.gi : (formIdx.get(a.form) ?? 999) - (formIdx.get(b.form) ?? 999)) || a.i - b.i);
    const pos = new Map(nodes.map((n, k) => [n.id, k] as const));
    const N = nodes.length;
    const cells = new Map<number, ViewEdge>();
    v.edges.forEach((e) => {
      const r = pos.get(e.to), c = pos.get(e.from);
      if (r != null && c != null) cells.set(r * N + c, e);
    });
    const auto = N <= 60 ? 18 : N <= 150 ? 14 : N <= 300 ? 10 : N <= 600 ? 7 : N <= 1200 ? 4 : N <= 2400 ? 3 : 2;
    const cell = Math.max(1, Math.min(mxCell() || auto, Math.floor(MAXPX / Math.max(N, 1))));
    return { nodes, N, cells, cell, auto, formsById: m.formsById };
  });
  let hov: { r: number; c: number } | null = null;
  const draw = (d: MxData = data()): void => {
    const { nodes, N, cells, cell, formsById } = d;
    if (!cv || !N || N > MAXN) return;
    const W = L + N * cell + 12, H = T + N * cell + 12;
    let dpr = window.devicePixelRatio || 1;
    if (W * H * dpr * dpr > 1.2e8) dpr = 1;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    const x = cv.getContext('2d');
    if (!x) return;
    x.scale(dpr, dpr);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, W, H);
    const fs = Math.min(11, cell - 2), labels = cell >= 9;
    const formIdxOdd = (i: number): boolean => {
      let c = 0;
      for (let k = 1; k <= i; k++) if (nodes[k].form !== nodes[k - 1].form) c++;
      return c % 2 === 1;
    };
    // form bands
    let start = 0;
    for (let k = 1; k <= N; k++) {
      if (k === N || nodes[k].form !== nodes[start].form) {
        const band = (k - start);
        if (nodes[start].form && formIdxOdd(start)) {
          x.fillStyle = '#f3f4f6';
          x.fillRect(L, T + start * cell, N * cell, band * cell);
          x.fillRect(L + start * cell, T, band * cell, N * cell);
        }
        x.fillStyle = '#374151';
        x.font = 'bold 10px system-ui,sans-serif';
        x.textAlign = 'left';
        x.textBaseline = 'middle';
        const fm = formsById.get(nodes[start].form);
        const lab = (nodes[start].gLabel || (nodes[start].kind === 'missing' ? '(unknown)' : fm ? fm.label : nodes[start].form));
        x.fillText(lab.length > 26 ? lab.slice(0, 25) + '…' : lab, 4, T + (start + Math.min(band, 2) / 2) * cell);
        x.strokeStyle = '#9ca3af';
        x.lineWidth = 1;
        x.beginPath();
        x.moveTo(0, T + start * cell + .5);
        x.lineTo(L + N * cell, T + start * cell + .5);
        x.moveTo(L + start * cell + .5, 0);
        x.lineTo(L + start * cell + .5, T + N * cell);
        x.stroke();
        start = k;
      }
    }
    // hover crosshair
    if (hov) {
      x.fillStyle = 'rgba(37,99,235,.10)';
      x.fillRect(L, T + hov.r * cell, N * cell, cell);
      x.fillRect(L + hov.c * cell, T, cell, N * cell);
    }
    // light grid when zoomed in enough, diagonal
    for (let k = 0; k < N; k++) {
      x.fillStyle = '#e5e7eb';
      x.fillRect(L + k * cell, T + k * cell, cell, cell);
    }
    cells.forEach((e, key) => {
      const r = Math.floor(key / N), c = key % N;
      x.fillStyle = TYPES[prim(e)].color;
      x.fillRect(L + c * cell + 1, T + r * cell + 1, cell - 1, cell - 1);
      if (cells.has(c * N + r)) {
        x.strokeStyle = '#dc2626';
        x.lineWidth = 1.5;
        x.strokeRect(L + c * cell + 1.5, T + r * cell + 1.5, cell - 2, cell - 2);
      }
    });
    if (labels) {
      x.fillStyle = '#111';
      x.font = fs + 'px ui-monospace,Menlo,monospace';
      x.textBaseline = 'middle';
      nodes.forEach((n, k) => {
        const t = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label;
        x.textAlign = 'right';
        x.fillText(t, L - 4, T + k * cell + cell / 2);
        x.save();
        x.translate(L + k * cell + cell / 2, T - 4);
        x.rotate(-Math.PI / 2);
        x.textAlign = 'left';
        x.fillText(t, 0, 0);
        x.restore();
      });
    }
  };
  createEffect(data, (d) => draw(d));
  const locate = (e: MouseEvent) => {
    const { cell, N } = data();
    const r0 = cv.getBoundingClientRect();
    const px = e.clientX - r0.left, py = e.clientY - r0.top;
    return { px, py, r: Math.floor((py - T) / cell), c: Math.floor((px - L) / cell), N };
  };
  const onMove = (e: MouseEvent) => {
    const { nodes, N, cells } = data();
    const p = locate(e);
    const inR = p.r >= 0 && p.r < N, inC = p.c >= 0 && p.c < N;
    const nh = inR && inC ? { r: p.r, c: p.c } : null;
    if ((nh && (!hov || hov.r !== nh.r || hov.c !== nh.c)) || (!nh && hov)) {
      hov = nh;
      draw();
    }
    if (nh) {
      const ed = cells.get(nh.r * N + nh.c);
      const nm = (n: MxNode): string => (n.field ? n.field + ' @ ' + (n.event || n.form) : n.id);
      setTip({ x: e.clientX + 14, y: e.clientY + 14, row: nm(nodes[nh.r]), col: nm(nodes[nh.c]), e: ed });
    } else {
      setTip(null);
    }
  };
  const onClick = (e: MouseEvent) => {
    const { nodes, N, cells } = data();
    const p = locate(e);
    if (p.r >= 0 && p.r < N && p.c >= 0 && p.c < N) {
      const ed = cells.get(p.r * N + p.c);
      setSelected(ed ? ed.to : nodes[p.r].id);
    } else if (p.r >= 0 && p.r < N && p.px < L) setSelected(nodes[p.r].id);
    else if (p.c >= 0 && p.c < N && p.py < T) setSelected(nodes[p.c].id);
  };

  return (
    <div>
      <div class="mxnote small"><label>Cell size <input type="range" min="1" max={Math.min(20, Math.max(1, Math.floor(MAXPX / Math.max(1, data().N))))} value={data().cell} onInput={(e) => setMxCell(+e.currentTarget.value)} style="vertical-align:middle;width:160px" /></label>
        <span class="muted">{data().cell}px · {data().N} {view() && view()?.level === 'field' ? 'fields' : 'nodes'}</span> <button class="link" onClick={() => setMxCell(0)}>auto</button>
        <span class="muted"> — labels appear at 9px or more; at small sizes hover for names.</span></div>
      <p class="muted small mxnote">Each <b>row</b> depends on the <b>columns</b> where it has a coloured cell (reads: row ← column). Colour = dependency type; a <span style="color:#dc2626;font-weight:600">red outline</span> means the pair depend on each other (circular). Fields are grouped by form (alternating bands), or by event / arm when chosen under Group fields by. Uses the same filters as the graph.</p>
      <Show when={data().N > MAXN} fallback={
        <div class="mxwrap">
          <div class="mxscroll">
            <Show when={data().N} fallback={<p style="padding:16px;color:#555">Nothing to show with the current filters.</p>}>
              <canvas ref={(el) => (cv = el)} onMouseMove={onMove} onMouseLeave={() => { hov = null; setTip(null); draw(); }} onClick={onClick}></canvas>
            </Show>
          </div>
          <Detail />
        </div>
      }>
        <p style="padding:16px">{data().N} nodes is too many for the matrix. Narrow the view with the Forms list or Focus.</p>
      </Show>
      <Show when={tip()}>
        {(t) => (
          <div class="mxtip" style={`left:${t().x}px;top:${t().y}px`}><b>{t().row}</b> ← <b>{t().col}</b>{t().e ? <div>{t().e?.types.join(' + ')}</div> : ''}</div>
        )}
      </Show>
    </div>
  );
}
