/* Graph tab: pan / zoom stage showing the rendered SVG, link highlighting and click selection. */
import { Show, createEffect, onSettled } from 'solid-js';
import {
  model, view, tab, selected, setSelected, setSelectedRaw, setSelEdge, svgEl, svgView, busy, renderMsg, tooBig,
  setForcedFor, dotSrc, viewAnchor,
} from '../store.js';
import Detail from './Detail.jsx';
import Legend from './Legend.jsx';

export default function GraphView() {
  let stage, canvas, pz = { x: 0, y: 0, k: 1 };
  // latest committed svg / view / selection, mirrored by the effects below so helpers and listeners need no signal reads
  let curSvg = null, curView = null, curSel = null;
  const apply = () => { canvas.style.transform = `translate(${pz.x}px,${pz.y}px) scale(${pz.k})`; };
  const fit = () => {
    const s = curSvg; if (!s || !stage.clientWidth) return;
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

  // ---- node / edge identification inside the rendered svg (Graphviz titles or Mermaid ids) ----
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

  // ---- keep zoom and the acted-on node in place across expand/collapse ----
  const elFor = (t) => {
    const s = curSvg, v = curView; if (!s || !v) return null;
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
    if (!curSvg) { viewAnchor.pending = null; return; }
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

  // ---- highlight a node's direct links (hover, or the selected node) ----
  let hover = null;
  const applyHl = () => {
    const s = curSvg; if (!s) return;
    let key = hover;
    if (!key && curSel && curView) { const sn = curView.nodes; let i = sn.findIndex((n) => n.id === curSel); if (i < 0) i = sn.findIndex((n) => n.field && n.field === curSel); if (i >= 0) key = 'n' + i; }
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
  // new svg: mount it, restore / fit the view, widen form-level edge hit areas, re-apply highlighting
  createEffect(() => [svgEl(), svgView()], ([s, sv]) => {
    curSvg = s; curView = sv;
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
    // widen the clickable area of form-level edges (thin lines are hard to hit)
    if (sv && sv.level === 'form') {
      s.querySelectorAll('g.edge').forEach((g) => {
        const p = g.querySelector('path'); if (!p) return;
        const hp = p.cloneNode(); hp.removeAttribute('marker-end'); hp.setAttribute('stroke', 'transparent'); hp.setAttribute('stroke-width', '14'); hp.setAttribute('fill', 'none'); hp.style.pointerEvents = 'stroke'; hp.style.cursor = 'pointer';
        g.appendChild(hp);
      });
    }
    applyHl();
  });
  createEffect(selected, (sel) => { curSel = sel; applyHl(); });

  createEffect(busy, (b) => { stage.classList.toggle('busy', b); });
  // refit only when returning to the tab; opening the detail panel must not change the view
  createEffect(tab, () => { requestAnimationFrame(fit); }, { defer: true });

  onSettled(() => {
    let drag = null, moved = 0;
    const onWheel = (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
    const onDown = (e) => { drag = { x: e.clientX - pz.x, y: e.clientY - pz.y }; moved = 0; stage.classList.add('drag'); };
    const onMove = (e) => { if (!drag) return; moved++; pz.x = e.clientX - drag.x; pz.y = e.clientY - drag.y; apply(); };
    const onUp = () => { drag = null; stage.classList.remove('drag'); };
    const onOver = (e) => {
      const g = e.target.closest && e.target.closest('g.node');
      const k = g ? nodeKey(g) : null;
      if (k !== hover) { hover = k; applyHl(); }
    };
    const onLeave = () => { if (hover) { hover = null; applyHl(); } };
    const onClick = (e) => {
      if (moved > 4) return;
      const eg = e.target.closest && e.target.closest('g.edge, path.flowchart-link');
      const sv = curView; if (!sv) return;
      if (eg && sv.level === 'form') {
        const k = edgeKey(eg);
        const a = k && sv.nodes[+k[0].slice(1)], b = k && sv.nodes[+k[1].slice(1)];
        const isForm = (n) => n && n.kind !== 'field' && n.kind !== 'calc' && n.kind !== 'status' && (model().formsById.has(n.form || n.id) || n.id === '(unknown)');
        if (isForm(a) && isForm(b)) { setSelectedRaw(null); setSelEdge({ from: a.form || a.id, to: b.form || b.id }); return; }
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
          setSelected(null); setSelEdge(null);
        }
        return;
      }
      let id = null;
      const t = node.querySelector('title');
      if (t && /^n\d+$/.test(t.textContent)) id = t.textContent;
      else { const m = /-(n\d+)-/.exec(node.id || ''); if (m) id = m[1]; }
      const n = id && sv.nodes[+id.slice(1)];
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
        <span class="muted">{view() ? `${view().nodes.length} nodes · ${view().edges.length} edges` : ''}</span><span class="grow"></span>
        <button class="btn sm" title="Zoom in" onClick={() => zoomAt(1.3)}>+</button>
        <button class="btn sm" title="Zoom out" onClick={() => zoomAt(1 / 1.3)}>−</button>
        <button class="btn sm" onClick={fit}>Fit</button>
      </div>
      <div id="graphwrap">
        <div id="stage" ref={(el) => (stage = el)}>
          <Show when={renderMsg() || tooBig()}>
            <div id="msg">
              <Show when={tooBig()} fallback={<div>{renderMsg()}</div>}>
                <div>Large graph ({view().edges.length} edges). Rendering may be slow.<br /><br />
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
