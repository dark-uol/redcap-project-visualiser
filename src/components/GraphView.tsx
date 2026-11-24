/* Graph tab: pan / zoom stage showing the rendered SVG, link highlighting and click selection. */
import { Show, createEffect, onSettled } from 'solid-js';
import type { View, ViewNode } from '../lib/types';
import {
  model, view, tab, selected, setSelected, setSelectedRaw, setSelEdge, svgEl, svgView, busy, renderMsg, tooBig,
  setForcedFor, dotSrc, viewAnchor, type Anchor,
} from '../store';
import Detail from './Detail';
import Legend from './Legend';

type Pan = { x: number; y: number; k: number };

/** Nearest ancestor-or-self of an event target matching `sel` (targets may be non-elements, e.g. text). */
const closestEl = (t: EventTarget | null, sel: string): Element | null => (t instanceof Element ? t.closest(sel) : null);

// node / edge identification inside the rendered svg (Graphviz titles or Mermaid ids)
const nodeKey = (g: Element): string | null => {
  const t = g.querySelector('title');
  if (t && /^n\d+$/.test(t.textContent ?? '')) return t.textContent;
  const m = /-(n\d+)-/.exec(g.id || '');
  return m ? m[1] : null;
};
const edgeKey = (g: Element): [string, string] | null => {
  const t = g.querySelector('title');
  let m: RegExpExecArray | null = t ? /^(n\d+)->(n\d+)$/.exec(t.textContent ?? '') : null;
  if (m) return [m[1], m[2]];
  m = /L[_-](n\d+)[_-](n\d+)/.exec(g.id || '');
  return m ? [m[1], m[2]] : null;
};

const isFormLike = (n: ViewNode | undefined, formIds: (id: string) => boolean): n is ViewNode =>
  !!n && n.kind !== 'field' && n.kind !== 'calc' && n.kind !== 'status' && (formIds(n.form || n.id) || n.id === '(unknown)');

export default function GraphView() {
  let stage!: HTMLDivElement;
  let canvas!: HTMLDivElement;
  let pz: Pan = { x: 0, y: 0, k: 1 };
  // latest committed svg / view / selection, mirrored by the effects below so helpers and listeners need no signal reads
  let curSvg: SVGSVGElement | null = null;
  let curView: View | null = null;
  let curSel: string | null = null;
  let hover: string | null = null;

  const apply = (): void => { canvas.style.transform = `translate(${pz.x}px,${pz.y}px) scale(${pz.k})`; };
  const fit = (): void => {
    const s = curSvg;
    if (!s || !stage.clientWidth) return;
    const w = +(s.dataset.w || 0), h = +(s.dataset.h || 0);
    const k = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1.5) * 0.96;
    pz = { k, x: (stage.clientWidth - w * k) / 2, y: (stage.clientHeight - h * k) / 2 };
    apply();
  };
  const zoomAt = (f: number, cx?: number, cy?: number): void => {
    const r = stage.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const k = Math.min(10, Math.max(0.02, pz.k * f));
    pz.x = px - (px - pz.x) * (k / pz.k);
    pz.y = py - (py - pz.y) * (k / pz.k);
    pz.k = k;
    apply();
  };

  // ---- keep zoom and the acted-on node in place across expand/collapse ----
  const clusterFor = (s: SVGSVGElement, gi: number): Element | null =>
    [...s.querySelectorAll('g.cluster')].find((c) => {
      const ti = c.querySelector('title');
      return !!ti && ti.textContent === 'cluster_' + gi;
    }) || null;
  const elFor = (t: string): Element | null => {
    const s = curSvg, v = curView;
    if (!s || !v) return null;
    if (t.startsWith('@form:')) {
      const gi = v.groups.findIndex((g) => g.id === t.slice(6));
      return gi < 0 ? null : clusterFor(s, gi);
    }
    const ni = v.nodes.findIndex((n) => n.id === t);
    if (ni < 0) { // a form that is now drawn as a box of fields
      const gi = v.groups.findIndex((g) => g.id === t);
      return gi < 0 ? null : clusterFor(s, gi);
    }
    return [...s.querySelectorAll('g.node')].find((n) => nodeKey(n) === 'n' + ni) || null;
  };
  viewAnchor.capture = (t, opt = {}) => {
    if (!curSvg) { viewAnchor.pending = null; return; }
    const el = elFor(t), sr = stage.getBoundingClientRect();
    const a: Anchor = { t, k: pz.k, time: Date.now(), zoom: !!opt.zoom };
    if (opt.zoom) viewAnchor.zoomBack.set(t, pz.k);
    if (opt.back && viewAnchor.zoomBack.has(t)) {
      a.k = viewAnchor.zoomBack.get(t) as number;
      viewAnchor.zoomBack.delete(t);
    }
    if (el) {
      const r = el.getBoundingClientRect();
      a.sx = r.left + r.width / 2 - sr.left;
      a.sy = r.top + r.height / 2 - sr.top;
    }
    viewAnchor.pending = a;
  };
  const restoreOrFit = (): void => {
    const a = viewAnchor.pending;
    viewAnchor.pending = null;
    if (!a || Date.now() - a.time > 15000) { fit(); return; }
    pz = { k: a.k, x: 0, y: 0 };
    apply();
    const el = elFor(a.t);
    if (!el || a.sx == null || a.sy == null) { fit(); return; }
    const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    pz.x = a.sx - (r.left + r.width / 2 - sr.left);
    pz.y = a.sy - (r.top + r.height / 2 - sr.top);
    apply();
    if (a.zoom) { // animate: zoom the expanded form's box to fill most of the stage, neighbours stay visible around it
      const cl = elFor('@form:' + a.t);
      if (!cl) return;
      const cr = cl.getBoundingClientRect();
      const cx = cr.left + cr.width / 2 - sr.left, cy = cr.top + cr.height / 2 - sr.top;
      const nk = Math.min(6, Math.max(0.02, pz.k * Math.min(stage.clientWidth * 0.7 / cr.width, stage.clientHeight * 0.7 / cr.height)));
      const f = nk / pz.k;
      const tx = stage.clientWidth / 2 - (cx - pz.x) * f, ty = stage.clientHeight / 2 - (cy - pz.y) * f;
      canvas.style.transition = 'transform .45s ease';
      void canvas.offsetWidth;
      pz = { k: nk, x: tx, y: ty };
      apply();
      setTimeout(() => { canvas.style.transition = ''; }, 500);
    }
  };

  // ---- highlight a node's direct links (hover, or the selected node) ----
  const applyHl = (): void => {
    const s = curSvg;
    if (!s) return;
    let key = hover;
    if (!key && curSel && curView) {
      const sn = curView.nodes;
      let i = sn.findIndex((n) => n.id === curSel);
      if (i < 0) i = sn.findIndex((n) => n.field && n.field === curSel);
      if (i >= 0) key = 'n' + i;
    }
    const nodes = s.querySelectorAll('g.node'), edges = s.querySelectorAll('g.edge, path.flowchart-link');
    if (!key || nodes.length > 2500) {
      s.classList.remove('hl');
      nodes.forEach((n) => n.classList.remove('on'));
      edges.forEach((n) => n.classList.remove('on'));
      return;
    }
    const keep = new Set<string>([key]);
    edges.forEach((el) => {
      const k = edgeKey(el), on = !!k && (k[0] === key || k[1] === key);
      el.classList.toggle('on', on);
      if (on && k) { keep.add(k[0]); keep.add(k[1]); }
    });
    nodes.forEach((n) => {
      const nk = nodeKey(n);
      n.classList.toggle('on', nk !== null && keep.has(nk));
    });
    s.classList.add('hl');
  };

  // new svg: mount it, restore / fit the view, widen form-level edge hit areas, re-apply highlighting
  createEffect(
    () => [svgEl(), svgView()] as const,
    ([s, sv]) => {
      curSvg = s;
      curView = sv;
      canvas.innerHTML = '';
      if (!s) return;
      s.removeAttribute('style');
      const vb = s.viewBox.baseVal;
      const w = vb && vb.width ? vb.width : parseFloat(s.getAttribute('width') ?? '') || 800;
      const h = vb && vb.height ? vb.height : parseFloat(s.getAttribute('height') ?? '') || 600;
      if (!vb || !vb.width) s.setAttribute('viewBox', `0 0 ${w} ${h}`);
      s.setAttribute('width', String(w));
      s.setAttribute('height', String(h));
      s.dataset.w = String(w);
      s.dataset.h = String(h);
      canvas.appendChild(s);
      restoreOrFit();
      // widen the clickable area of form-level edges (thin lines are hard to hit)
      if (sv && sv.level === 'form') {
        s.querySelectorAll('g.edge').forEach((g) => {
          const p = g.querySelector('path');
          if (!p) return;
          const hp = p.cloneNode() as SVGPathElement;
          hp.removeAttribute('marker-end');
          hp.setAttribute('stroke', 'transparent');
          hp.setAttribute('stroke-width', '14');
          hp.setAttribute('fill', 'none');
          hp.style.pointerEvents = 'stroke';
          hp.style.cursor = 'pointer';
          g.appendChild(hp);
        });
      }
      applyHl();
    },
  );
  createEffect(selected, (sel) => { curSel = sel; applyHl(); });

  createEffect(busy, (b) => { stage.classList.toggle('busy', b); });
  // refit only when returning to the tab; opening the detail panel must not change the view
  createEffect(tab, () => { requestAnimationFrame(fit); }, { defer: true });

  onSettled(() => {
    let drag: { x: number; y: number } | null = null;
    let moved = 0;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
    const onDown = (e: MouseEvent) => { drag = { x: e.clientX - pz.x, y: e.clientY - pz.y }; moved = 0; stage.classList.add('drag'); };
    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      moved++;
      pz.x = e.clientX - drag.x;
      pz.y = e.clientY - drag.y;
      apply();
    };
    const onUp = () => { drag = null; stage.classList.remove('drag'); };
    const onOver = (e: MouseEvent) => {
      const g = closestEl(e.target, 'g.node');
      const k = g ? nodeKey(g) : null;
      if (k !== hover) { hover = k; applyHl(); }
    };
    const onLeave = () => { if (hover) { hover = null; applyHl(); } };
    const onClick = (e: MouseEvent) => {
      if (moved > 4) return;
      const eg = closestEl(e.target, 'g.edge, path.flowchart-link');
      const sv = curView;
      if (!sv) return;
      if (eg && sv.level === 'form') {
        const k = edgeKey(eg);
        const a = k ? sv.nodes[+k[0].slice(1)] : undefined;
        const b = k ? sv.nodes[+k[1].slice(1)] : undefined;
        const formIds = (id: string) => !!model()?.formsById.has(id);
        if (isFormLike(a, formIds) && isFormLike(b, formIds)) {
          setSelectedRaw(null);
          setSelEdge({ from: a.form || a.id, to: b.form || b.id });
          return;
        }
      }
      const node = closestEl(e.target, 'g.node');
      if (!node) {
        const cl = closestEl(e.target, 'g.cluster');
        if (cl && (sv.level === 'field' || sv.mixed)) {
          const t = cl.querySelector('title');
          const m = (t && /^cluster_(\d+)$/.exec(t.textContent ?? '')) || /(?:^|[-_])g(\d+)$/.exec(cl.id || '');
          const gr = m ? sv.groups[+m[1]] : undefined;
          if (gr && !gr.noSelect) setSelected(sv.mixed ? gr.id : '@form:' + gr.id);
        } else if (!closestEl(e.target, 'g.edge, path.flowchart-link, .edgeLabel')) {
          // click on the empty diagram background: close the detail pane
          setSelected(null);
          setSelEdge(null);
        }
        return;
      }
      let id: string | null = null;
      const t = node.querySelector('title');
      if (t && /^n\d+$/.test(t.textContent ?? '')) id = t.textContent;
      else {
        const m = /-(n\d+)-/.exec(node.id || '');
        if (m) id = m[1];
      }
      const n = id ? sv.nodes[+id.slice(1)] : undefined;
      if (n) setSelected(n.id); // full node id (variable@@instance) so the right copy is highlighted
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', fit);
    stage.addEventListener('mouseover', onOver);
    stage.addEventListener('mouseleave', onLeave);
    stage.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', fit);
    };
  });

  return (
    <div>
      <div class="graphbar">
        <span class="muted">{view() ? `${view()?.nodes.length} nodes · ${view()?.edges.length} edges` : ''}</span><span class="grow"></span>
        <button class="btn sm" title="Zoom in" onClick={() => zoomAt(1.3)}>+</button>
        <button class="btn sm" title="Zoom out" onClick={() => zoomAt(1 / 1.3)}>−</button>
        <button class="btn sm" onClick={fit}>Fit</button>
      </div>
      <div id="graphwrap">
        <div id="stage" ref={(el) => (stage = el)}>
          <Show when={renderMsg() || tooBig()}>
            <div id="msg">
              <Show when={tooBig()} fallback={<div>{renderMsg()}</div>}>
                <div>Large graph ({view()?.edges.length} edges). Rendering may be slow.<br /><br />
                  <button class="btn primary" onClick={() => setForcedFor(dotSrc())}>Render anyway</button><br /><br />
                  <span class="muted small">Or narrow it with the filters / focus, or just download the .mmd / .dot files.</span></div>
              </Show>
            </div>
          </Show>
          <div id="canvas" ref={(el) => (canvas = el)}></div>
        </div>
        <Detail />
      </div>
      <Legend />
    </div>
  );
}
