import { For, Show } from 'solid-js';
import type { Element as SolidElement } from 'solid-js';
import { createHint, HintToggle, HintText, Labeled } from '../controls';

/** A chain-of-things row: an id and its already-formatted label. */
export type NamedOption = { id: string; label: string };

/** A field as the field-name suggestions show it: the variable to type, and its label. */
export type FieldOption = { variable: string; label: string };

/** The form-link focus, with both form names already formatted. */
export type PairLabels = { fromLabel: string; toLabel: string };

export type NavigationSectionViewProps = {
  /** The focused field, form or event id, or '' when nothing is focused. */
  focus: string;
  /** The focus as a readable name, with what kind of thing it is. */
  focusLabel: string;
  /** How many nodes the exploration shows, or null when not exploring. */
  exploring: number | null;
  pair: PairLabels | null;
  zoomedForms: NamedOption[];
  zoomedEvents: NamedOption[];
  fields: FieldOption[];
  forms: NamedOption[];
  events: NamedOption[];
  /** Takes the typed focus name. Returns false when it is not in the model, so the input is restored to the current focus. */
  onFocusPick: (raw: string) => boolean;
  onClearFocus: () => void;
  onExitExploring: () => void;
  onClearPair: () => void;
  onResetAll: () => void;
  onCollapseForm: (formId: string) => void;
  onCollapseEvent: (eventId: string) => void;
  /** The focus controls (direction and depth), rendered after the focus field. */
  children: SolidElement;
};

/** Presentational: the focus and zoom panel, with the list of active narrowings and the focus field. Owns only the hint's open/closed state. */
export function NavigationSectionView(props: NavigationSectionViewProps) {
  const help = createHint();
  const anyActive = (): boolean => props.focus !== '' || props.exploring !== null || props.pair !== null || props.zoomedForms.length > 0 || props.zoomedEvents.length > 0;

  const onFieldChange = function onFieldChange(event: Event & { currentTarget: HTMLInputElement }): void {
    const input = event.currentTarget;
    if (!props.onFocusPick(input.value)) input.value = props.focus;
  };
  const collapseFormHandler = (id: string) => function onCollapseForm(): void { props.onCollapseForm(id); };
  const collapseEventHandler = (id: string) => function onCollapseEvent(): void { props.onCollapseEvent(id); };

  return (
    <details class="sec" open>
      <summary><h2>Focus &amp; zoom <HintToggle help={help} title="Focus and zoom" /></h2></summary>
      <HintText help={help}>Everything that narrows or zooms the graph is listed here, with a way to undo it. Select a node, then use its panel on the right to zoom into it, show its chain or add its links.</HintText>

      <Show when={anyActive()}>
        <ul class="navstate">
          <Show when={props.focus !== ''}>
            <li><span>Chain of <b>{props.focusLabel}</b></span><button class="link" onClick={props.onClearFocus}>✕ clear</button></li>
          </Show>
          <Show when={props.exploring !== null}>
            <li><span>Exploring: {props.exploring} nodes</span><button class="link" onClick={props.onExitExploring}>✕ exit</button></li>
          </Show>
          <Show when={props.pair !== null}>
            <li><span>Links <b>{props.pair?.fromLabel}</b> → <b>{props.pair?.toLabel}</b></span><button class="link" onClick={props.onClearPair}>✕ clear</button></li>
          </Show>
          <For each={props.zoomedForms}>{(row) => <li><span>Zoomed into <b>{row.label}</b></span><button class="link" onClick={collapseFormHandler(row.id)}>✕ back to form</button></li>}</For>
          <For each={props.zoomedEvents}>{(row) => <li><span>Zoomed into <b>{row.label}</b></span><button class="link" onClick={collapseEventHandler(row.id)}>✕ back to event</button></li>}</For>
        </ul>
        <p style="margin:0 0 8px"><button class="btn sm" onClick={props.onResetAll}>Reset to full graph</button></p>
      </Show>

      <Labeled label="Focus on" hint="Type a field, form or event and press Enter. The graph then shows only the chain of dependencies running through it (for a form or event, through any of its fields), at the level you are on.">
        <span class="row2"><input type="search" list="fieldlist" placeholder="Field, form or event…" autocomplete="off" value={props.focus} onChange={onFieldChange} />
          <button class="btn sm" title="Clear focus" onClick={props.onClearFocus}>✕</button></span>
        <datalist id="fieldlist"><For each={props.fields}>{(field) => <option value={field.variable}>{field.label.slice(0, 70)}</option>}</For>
          <For each={props.forms}>{(form) => <option value={form.id}>Form: {form.label}</option>}</For>
          <For each={props.events}>{(event) => <option value={event.id}>Event: {event.label}</option>}</For></datalist>
      </Labeled>
      {props.children}
    </details>
  );
}
