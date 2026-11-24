import { For, Show, createMemo } from 'solid-js';
import { TYPES } from '../lib/graph';
import type { Arm, DepType, Direction, EventDef, FocusDir, GroupBy, LabelMode, Level, Renderer, TypeMeta } from '../lib/types';
import { Select, Check } from './controls';
import {
  need, model, level, setLevel, renderer, setRenderer, dir, setDir, labelMode, setLabelMode, groupBy, setGroupBy,
  instances, setInstances, edgeLabels, setEdgeLabels, hideIsoNodes, setHideIsoNodes, hideIso, setHideIso,
  showMissing, setShowMissing, typesOn, setTypesOn, curEx, exVisible, setExplore, pair, setPair, formLabel,
  focus, setFocus, focusDir, setFocusDir, focusDepth, setFocusDepth, clampDepth,
  crossOnly, setCrossOnly, instOnly, setInstOnly, eventsOn, setEventsOn, formQ, setFormQ, formsOn, setFormsOn,
} from '../store';

const stop = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn(); };

export default function Sidebar() {
  const m = () => need(model());
  const shownForms = createMemo(() => {
    const q = formQ().toLowerCase().trim();
    return m().parsed.forms.filter((f) => !q || (f.label + ' ' + f.id).toLowerCase().includes(q));
  });
  // all / none apply to the forms currently listed (so you can search, then select the matches)
  const setForms = (val: boolean) =>
    setFormsOn({ ...formsOn(), ...Object.fromEntries(shownForms().map((f) => [f.id, val] as const)) });
  const armEvents = (a: Arm): EventDef[] => m().parsed.events.filter((e) => !a.num || e.arm === a.num);
  const setEvents = (val: boolean) =>
    setEventsOn(Object.fromEntries(m().parsed.events.map((e) => [e.id, val] as const)));
  const setArm = (a: Arm, val: boolean) =>
    setEventsOn({ ...eventsOn(), ...Object.fromEntries(armEvents(a).map((e) => [e.id, val] as const)) });
  const pickField = (el: HTMLInputElement): void => {
    const v = el.value.trim();
    if (!v) { setFocus(''); return; }
    if (m().byVar.has(v)) { setLevel('field'); setExplore(null); setPair(null); setFocus(v); }
    else el.value = focus();
  };
  const hasEvents = (): boolean => (m().parsed.events || []).length > 0;
  const typeEntries = Object.entries(TYPES) as [DepType, TypeMeta][];

  return (
    <aside id="side">
      <details class="sec" open>
        <summary><h2>View</h2></summary>
        <label>Level <Select<Level> value={level()} onChange={setLevel} options={[['field', 'Fields'], ['form', 'Forms (aggregated)'], ['event', 'Events (cross-event links)']]} /></label>
        <label>Renderer <Select<Renderer> value={renderer()} onChange={setRenderer} options={[['graphviz', 'Graphviz'], ['mermaid', 'Mermaid']]} /></label>
        <label>Direction <Select<Direction> value={dir()} onChange={setDir} options={[['LR', 'Left → right'], ['TD', 'Top → down']]} /></label>
        <label>Node text <Select<LabelMode> value={labelMode()} onChange={setLabelMode} options={[['var', 'Variable name'], ['label', 'Name + field label']]} /></label>
        <label>Group fields by <Select<GroupBy> value={groupBy()} onChange={setGroupBy} options={[['form', 'Form'], ['event', 'Event (longitudinal)'], ['arm', 'Arm (longitudinal)'], ['none', 'No grouping']]} /></label>
        <Show when={level() === 'form' && hasEvents()}>
          <Check checked={instances()} onChange={setInstances} label="Instances (one node per form per event)" />
          <Show when={instances()}>
            <p class="muted small" style="margin:0 0 6px">A form collected in several events gets one node per event, banded by event (or by arm via Group by). Select a node to expand its back / forward references or zoom into its fields.</p>
          </Show>
        </Show>
        <Check checked={edgeLabels()} onChange={setEdgeLabels} label="Edge labels" />
        <Show when={level() !== 'field'}>
          <Check checked={hideIsoNodes()} onChange={setHideIsoNodes} label={(level() === 'event' ? 'Hide events' : 'Hide forms') + ' with no dependencies'} />
        </Show>
        <Show when={level() !== 'event'}>
          <Check checked={hideIso()} onChange={setHideIso} label="Hide fields with no dependencies" />
        </Show>
        <Check checked={showMissing()} onChange={setShowMissing} label="Show undefined references" />
      </details>
      <details class="sec">
        <summary><h2>Dependency types</h2></summary>
        <For each={typeEntries}>
          {([k, t]) => (
            <label class="typerow"><input type="checkbox" checked={typesOn()[k]} onChange={(e) => setTypesOn({ ...typesOn(), [k]: e.currentTarget.checked })} />
              <span class="sw" style={`border-color:${t.color};border-top-style:${k === 'branching' ? 'solid' : k === 'calc' ? 'double' : 'dashed'}`}></span>{t.label}</label>
          )}
        </For>
      </details>
      <Show when={curEx()}>
        <details class="sec" open>
          <summary><h2>Exploring</h2></summary>
          <p class="small" style="margin:0 0 6px">{exVisible(need(curEx())).size} nodes shown. Select a node and use <b>Expand / Collapse</b> in its panel.</p>
          <button class="btn sm" onClick={() => setExplore(null)}>✕ Exit exploring</button>
        </details>
      </Show>
      <Show when={pair()}>
        <details class="sec" open>
          <summary><h2>Form link focus</h2></summary>
          <p class="small" style="margin:0 0 6px">Showing only the fields linking <b>{formLabel(need(pair()).from)}</b> → <b>{formLabel(need(pair()).to)}</b></p>
          <button class="btn sm" onClick={() => setPair(null)}>✕ Clear</button>
        </details>
      </Show>
      <details class="sec">
        <summary><h2>Focus on a field</h2></summary>
        <label>Field (search)
          <span class="row2"><input type="search" list="fieldlist" placeholder="Type to search fields…" autocomplete="off" value={focus()} onChange={(e) => pickField(e.currentTarget)} />
            <button class="btn sm" title="Clear focus" onClick={() => setFocus('')}>✕</button></span>
          <datalist id="fieldlist"><For each={m().parsed.fields}>{(f) => <option value={f.variable}>{f.label.slice(0, 70)}</option>}</For></datalist>
        </label>
        <label>Show <Select<FocusDir> value={focusDir()} onChange={setFocusDir} options={[['both', 'Upstream + downstream'], ['up', 'Upstream (what it depends on)'], ['down', 'Downstream (what depends on it)']]} /></label>
        <label>Max depth
          <span class="stepper"><button class="btn sm" onClick={() => setFocusDepth(focusDepth() - 1)}>−</button>
            <input type="number" inputmode="numeric" min="1" max="50" step="1" value={focusDepth()} onChange={(e) => {
              setFocusDepth(e.currentTarget.value);
              e.currentTarget.value = String(clampDepth(e.currentTarget.value));
            }} />
            <button class="btn sm" onClick={() => setFocusDepth(focusDepth() + 1)}>+</button></span></label>
        <p class="muted small">Choosing a field switches to the field-level view. Tip: click a node to see its logic code.</p>
      </details>
      <Show when={(m().parsed.events || []).length}>
        <details class="sec">
          <summary><h2>Events &amp; arms <button class="link" onClick={stop(() => setEvents(true))}>all</button> <button class="link" onClick={stop(() => setEvents(false))}>none</button></h2></summary>
          <Check checked={crossOnly()} onChange={setCrossOnly} label="Only cross-event references" />
          <Check checked={instOnly()} onChange={setInstOnly} label="Only repeating-instance logic" />
          <div id="events">
            <For each={m().parsed.arms.length ? m().parsed.arms : [{ num: '', name: '' }]}>
              {(a) => (
                <div class="armrow">
                  <Show when={a.num}>
                    <label class="chk"><input type="checkbox" checked={armEvents(a).every((e) => eventsOn()[e.id] !== false)} onChange={(e) => setArm(a, e.currentTarget.checked)} /> <b>{a.name}</b> <span class="muted small">arm {a.num}</span></label>
                  </Show>
                  <For each={armEvents(a)}>
                    {(ev) => (
                      <label class="chk" style="margin-left:14px"><input type="checkbox" checked={eventsOn()[ev.id] !== false} onChange={(e) => setEventsOn({ ...eventsOn(), [ev.id]: e.currentTarget.checked })} /> {ev.label}{ev.repeating ? ' ↻' : ''} <span class="muted small">({ev.forms.length})</span></label>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
          <p class="muted small">Keeps forms collected in the ticked events (↻ = repeating). Combines with the Forms list.</p>
        </details>
      </Show>
      <details class="sec">
        <summary><h2>Forms <button class="link" onClick={stop(() => setForms(true))}>all</button> <button class="link" onClick={stop(() => setForms(false))}>none</button></h2></summary>
        <input type="search" class="formsearch" placeholder="Search forms…" value={formQ()} onInput={(e) => setFormQ(e.currentTarget.value)} />
        <div id="forms">
          <For each={shownForms()}>
            {(f) => (
              <label class="chk"><input type="checkbox" checked={formsOn()[f.id] !== false} onChange={(e) => setFormsOn({ ...formsOn(), [f.id]: e.currentTarget.checked })} /> {f.label} <span class="muted small">({f.fields.length})</span></label>
            )}
          </For>
        </div>
      </details>
    </aside>
  );
}
