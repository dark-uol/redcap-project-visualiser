import { For } from 'solid-js';
import { TYPES } from '../../lib/graph';
import { withFlags } from '../../lib/flags';
import type { DepType, TypeMeta } from '../../lib/types';
import { filters } from '../../store';
import { createHint, HintToggle, HintText } from '../controls';

const { typesOn, setTypesOn } = filters;

/** CSS border-top-style used for each dependency type's legend swatch. */
const DEPENDENCY_BORDER_STYLE: Record<DepType, string> = {
  branching: 'solid',
  calc: 'double',
  piping: 'dashed',
  actiontag: 'dashed',
  formlogic: 'dashed',
  logicsrc: 'dashed',
};

const typeEntries = Object.entries(TYPES) as [DepType, TypeMeta][];

export default function DependencyTypesSection() {
  const help = createHint();
  return (
    <details class="sec">
      <summary><h2>Dependency types <HintToggle help={help} title="Dependency types" /></h2></summary>
      <HintText help={help}>Which kinds of link are drawn. Untick a type to hide those edges everywhere; the line style shows which type is which.</HintText>
      <For each={typeEntries}>
        {([kind, meta]) => <TypeRow kind={kind} meta={meta} />}
      </For>
    </details>
  );
}

function TypeRow(props: { kind: DepType; meta: TypeMeta }) {
  const onTypeChange = function onTypeChange(event: Event & { currentTarget: HTMLInputElement }): void {
    setTypesOn(withFlags(typesOn(), [props.kind], event.currentTarget.checked));
  };

  return (
    <label class="typerow"><input type="checkbox" checked={typesOn()[props.kind]} onChange={onTypeChange} />
      <span class="sw" style={`border-color:${props.meta.color};border-top-style:${DEPENDENCY_BORDER_STYLE[props.kind]}`}></span>{props.meta.label}</label>
  );
}
