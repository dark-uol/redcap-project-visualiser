import type { Element as SolidElement } from 'solid-js';
import type { Model } from '../lib/types';
import { Tag } from './Tag';

const FieldLink = (props: { v: string; onJump: (variable: string) => void }) => <button class="fieldlink" onClick={() => props.onJump(props.v)}>{props.v}</button>;

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

export type AnalysisTabViewProps = { model: Model; onJumpToField: (variable: string) => void };

/** Presentational: summary cards and dependency analysis for the loaded model. Field links call `onJumpToField`. */
export function AnalysisTabView(props: AnalysisTabViewProps) {
  const analysis = () => props.model.analysis;
  return (
    <div class="an">
      <div class="cards">
        <Card n={props.model.parsed.fields.length} label="fields" /><Card n={props.model.edges.length} label="dependencies" /><Card n={analysis().maxChain} label="longest logic chain" target="an-chain" />
        <Card n={analysis().isolated.length} label="isolated fields" /><Card n={analysis().cycles.length} label="circular groups" warn={analysis().cycles.length} target="an-cycles" />
        <Card n={analysis().missing.length} label="undefined refs" warn={analysis().missing.length} target="an-missing" /><Card n={analysis().forward.length} label="forward branching refs" target="an-forward" />
      </div>
      <h3 id="an-cycles">Circular dependencies <span class="muted small">(branching / calc / action-tag logic)</span></h3>
      <List items={analysis().cycles}>{(c) => c.map((v, i) => <span>{i ? ' ⇄ ' : ''}<FieldLink v={v} onJump={props.onJumpToField} /></span>)}</List>
      <h3 id="an-missing">References to undefined fields</h3>
      <List items={analysis().missing}>{(e) => e.type === 'embedding'
        ? <span><FieldLink v={e.from} onJump={props.onJumpToField} /> embeds undefined field <code>{'{' + e.to + '}'}</code></span>
        : <span><FieldLink v={e.to} onJump={props.onJumpToField} /> → <code>[{e.from}]</code> in <Tag type={e.type} /></span>}</List>
      <h3 id="an-forward">Branching on a field that appears later in the project</h3>
      <List items={analysis().forward}>{(e) => <span><FieldLink v={e.to} onJump={props.onJumpToField} /> is shown depending on <FieldLink v={e.from} onJump={props.onJumpToField} />, which is asked later</span>}</List>
      <h3 id="an-chain">Longest logic chain <span class="muted small">(branching / calc / action-tag logic, first dependency to last dependant)</span></h3>
      {analysis().longestChain.length
        ? <ol class="chain">{analysis().longestChain.map((step) => <li>{step.map((v, i) => <span>{i ? ' ⇄ ' : ''}<FieldLink v={v} onJump={props.onJumpToField} /></span>)}</li>)}</ol>
        : <p class="muted">No chains: no field depends on another.</p>}
      <h3>Most influential fields (most dependants)</h3>
      <List items={analysis().hubs}>{([v, n]) => <span><FieldLink v={v} onJump={props.onJumpToField} /> — {n}</span>}</List>
      <h3>Most dependent fields (most inputs)</h3>
      <List items={analysis().heavy}>{([v, n]) => <span><FieldLink v={v} onJump={props.onJumpToField} /> — {n}</span>}</List>
      <h3>Cross-form dependencies</h3>
      <p>{analysis().crossForm.length} of {props.model.edges.length} dependencies link different forms. Use the “Forms” level to see them aggregated.</p>
      {props.model.selfRefs.length ? <div><h3>Self-references ignored</h3><List items={props.model.selfRefs}>{(r) => <span><FieldLink v={r.field} onJump={props.onJumpToField} /> ({r.type})</span>}</List></div> : ''}
    </div>
  );
}
