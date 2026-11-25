import { For } from 'solid-js';
import { TYPES } from '../../lib/graph';
import type { DepType, TypeMeta } from '../../lib/types';
import { createHint, HintToggle, HintText } from '../controls';

/** CSS border-top-style used for each dependency type's legend swatch. */
const DEPENDENCY_BORDER_STYLE: Record<DepType, string> = {
  branching: 'solid',
  calc: 'double',
  piping: 'dashed',
  embedding: 'dotted',
  actiontag: 'dashed',
  formlogic: 'dashed',
  logicsrc: 'dashed',
};

const typeEntries = Object.entries(TYPES) as [DepType, TypeMeta][];

export type DependencyTypesSectionViewProps = {
  /** Whether each dependency type is drawn, keyed by type. */
  typesOn: Record<DepType, boolean>;
  onTypeChange: (kind: DepType, checked: boolean) => void;
};

/** Presentational: the dependency-type checklist with its hint. Owns only the hint's open/closed state. */
export function DependencyTypesSectionView(props: DependencyTypesSectionViewProps) {
  const help = createHint();
  return (
    <details class="sec">
      <summary><h2>Dependency types <HintToggle help={help} title="Dependency types" /></h2></summary>
      <HintText help={help}>Which kinds of link are drawn. Untick a type to hide those edges everywhere; the line style shows which type is which.</HintText>
      <For each={typeEntries}>
        {([kind, meta]) => <TypeRow kind={kind} meta={meta} checked={props.typesOn[kind]} onTypeChange={props.onTypeChange} />}
      </For>
    </details>
  );
}

function TypeRow(props: { kind: DepType; meta: TypeMeta; checked: boolean; onTypeChange: (kind: DepType, checked: boolean) => void }) {
  const onTypeChange = function onTypeChange(event: Event & { currentTarget: HTMLInputElement }): void {
    props.onTypeChange(props.kind, event.currentTarget.checked);
  };

  return (
    <label class="typerow"><input type="checkbox" checked={props.checked} onChange={onTypeChange} />
      <span class="sw" style={`border-color:${props.meta.color};border-top-style:${DEPENDENCY_BORDER_STYLE[props.kind]}`}></span>{props.meta.label}</label>
  );
}
