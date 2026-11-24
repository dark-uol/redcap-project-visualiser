import type { Element as SolidElement } from 'solid-js';
import { need, model, jumpToField } from '../store';
import { Tag } from './Detail';

const FieldLink = (props: { v: string }) => <button class="fieldlink" onClick={() => jumpToField(props.v)}>{props.v}</button>;

function List<T>(props: { items: T[]; children: (x: T) => SolidElement }) {
  return (
    <>
      {props.items.length
        ? <ul>{props.items.map((x) => <li>{props.children(x)}</li>)}</ul>
        : <p class="muted">None 🎉</p>}
    </>
  );
}

// A card with a `target` section id scrolls to that section when clicked (or activated from the keyboard).
const goToSection = (id: string): void => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function Card(props: { n: number; label: string; warn?: number | boolean; target?: string }) {
  const clickable = !!props.target;
  return (
    <div
      class={'card' + (props.warn ? ' warn' : '') + (clickable ? ' clickable' : '')}
      role={clickable ? 'button' : undefined}
      tabindex={clickable ? 0 : undefined}
      title={clickable ? 'Go to section' : undefined}
      onClick={() => { if (props.target) goToSection(props.target); }}
      onKeyDown={(e) => {
        if (props.target && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          goToSection(props.target);
        }
      }}
    ><b>{props.n}</b>{props.label}</div>
  );
}

export default function AnalysisTab() {
  const m = () => need(model());
  const A = () => m().analysis;
  return (
    <div class="an">
      <div class="cards">
        <Card n={m().parsed.fields.length} label="fields" /><Card n={m().edges.length} label="dependencies" /><Card n={A().maxChain} label="longest logic chain" />
        <Card n={A().isolated.length} label="isolated fields" /><Card n={A().cycles.length} label="circular groups" warn={A().cycles.length} target="an-cycles" />
        <Card n={A().missing.length} label="undefined refs" warn={A().missing.length} target="an-missing" /><Card n={A().forward.length} label="forward branching refs" target="an-forward" />
      </div>
      <h3 id="an-cycles">Circular dependencies <span class="muted small">(branching / calc / action-tag logic)</span></h3>
      <List items={A().cycles}>{(c) => c.map((v, i) => <span>{i ? ' ⇄ ' : ''}<FieldLink v={v} /></span>)}</List>
      <h3 id="an-missing">References to undefined fields</h3>
      <List items={A().missing}>{(e) => <span><FieldLink v={e.to} /> → <code>[{e.from}]</code> in <Tag type={e.type} /></span>}</List>
      <h3 id="an-forward">Branching on a field that appears later in the project</h3>
      <List items={A().forward}>{(e) => <span><FieldLink v={e.to} /> is shown depending on <FieldLink v={e.from} />, which is asked later</span>}</List>
      <h3>Most influential fields (most dependants)</h3>
      <List items={A().hubs}>{([v, n]) => <span><FieldLink v={v} /> — {n}</span>}</List>
      <h3>Most dependent fields (most inputs)</h3>
      <List items={A().heavy}>{([v, n]) => <span><FieldLink v={v} /> — {n}</span>}</List>
      <h3>Cross-form dependencies</h3>
      <p>{A().crossForm.length} of {m().edges.length} dependencies link different forms. Use the “Forms” level to see them aggregated.</p>
      {m().selfRefs.length ? <div><h3>Self-references ignored</h3><List items={m().selfRefs}>{(r) => <span><FieldLink v={r.field} /> ({r.type})</span>}</List></div> : ''}
    </div>
  );
}
