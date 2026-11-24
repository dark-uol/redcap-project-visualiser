/* One place for everything that narrows or zooms the graph: focus, exploring, form-link focus and expanded forms / events.
   The detail panel's buttons (Zoom, Show chain, Add to graph) act on the selected node; whatever they switch on is listed and cleared here. */
import { For, Show } from 'solid-js';
import { focusKind } from '../../lib/graph';
import { need, model, focusing, formLabel, expanded, expandedEvents, currentExploration, exploreVisible, setExplore, toggleExpandForm, toggleExpandEvent } from '../../store';
import FocusControls from '../FocusControls';
import { Labeled, createHint, HintToggle, HintText } from '../controls';

const { focus, setFocus, pair, setPair } = focusing;

export default function NavigationSection() {
  const help = createHint();
  const fields = () => need(model()).parsed.fields;
  const eventLabelOf = (eventId: string): string => (need(model()).parsed.events || []).find((event) => event.id === eventId)?.label ?? eventId;
  /** `form` or `form@event` expansion id as a readable name. */
  const expansionLabel = (id: string): string => {
    const [formId, eventId] = id.split('@');
    return formLabel(formId) + (eventId ? ' @ ' + eventLabelOf(eventId) : '');
  };
  const events = () => need(model()).parsed.events || [];
  /** The focus as a readable name, with what kind of thing it is. */
  const focusLabel = (): string => {
    const kind = focusKind(need(model()), focus());
    return kind === 'form' ? formLabel(focus()) + ' (form)' : kind === 'event' ? eventLabelOf(focus()) + ' (event)' : focus();
  };
  const zoomedForms = (): string[] => [...expanded()];
  const zoomedEvents = (): string[] => [...expandedEvents()];
  const anyActive = (): boolean => focus() !== '' || !!currentExploration() || !!pair() || expanded().size > 0 || expandedEvents().size > 0;

  /** Accepts a typed field name only if it exists in the model; otherwise restores the current focus. */
  const pickField = (input: HTMLInputElement): void => {
    const value = input.value.trim();
    if (!value) { setFocus(''); return; }
    if (focusKind(need(model()), value) !== null) { setExplore(null); setPair(null); setFocus(value); }
    else input.value = focus();
  };
  const onFieldChange = function onFieldChange(event: Event & { currentTarget: HTMLInputElement }): void {
    pickField(event.currentTarget);
  };
  const onClearFocus = function onClearFocus(): void { setFocus(''); };
  const onExitExploring = function onExitExploring(): void { setExplore(null); };
  const onClearPair = function onClearPair(): void { setPair(null); };
  const onResetAll = function onResetAll(): void {
    setFocus('');
    setPair(null);
    setExplore(null);
    zoomedForms().forEach(toggleExpandForm);
    zoomedEvents().forEach(toggleExpandEvent);
  };
  const collapseFormHandler = (id: string) => function onCollapseForm(): void { toggleExpandForm(id); };
  const collapseEventHandler = (id: string) => function onCollapseEvent(): void { toggleExpandEvent(id); };

  return (
    <details class="sec" open>
      <summary><h2>Focus &amp; zoom <HintToggle help={help} title="Focus and zoom" /></h2></summary>
      <HintText help={help}>Everything that narrows or zooms the graph is listed here, with a way to undo it. Select a node, then use its panel on the right to zoom into it, show its chain or add its links.</HintText>

      <Show when={anyActive()}>
        <ul class="navstate">
          <Show when={focus() !== ''}>
            <li><span>Chain of <b>{focusLabel()}</b></span><button class="link" onClick={onClearFocus}>✕ clear</button></li>
          </Show>
          <Show when={currentExploration()}>
            <li><span>Exploring: {exploreVisible(need(currentExploration())).size} nodes</span><button class="link" onClick={onExitExploring}>✕ exit</button></li>
          </Show>
          <Show when={pair()}>
            <li><span>Links <b>{formLabel(need(pair()).from)}</b> → <b>{formLabel(need(pair()).to)}</b></span><button class="link" onClick={onClearPair}>✕ clear</button></li>
          </Show>
          <For each={zoomedForms()}>{(id) => <li><span>Zoomed into <b>{expansionLabel(id)}</b></span><button class="link" onClick={collapseFormHandler(id)}>✕ back to form</button></li>}</For>
          <For each={zoomedEvents()}>{(id) => <li><span>Zoomed into <b>{eventLabelOf(id)}</b></span><button class="link" onClick={collapseEventHandler(id)}>✕ back to event</button></li>}</For>
        </ul>
        <p style="margin:0 0 8px"><button class="btn sm" onClick={onResetAll}>Reset to full graph</button></p>
      </Show>

      <Labeled label="Focus on" hint="Type a field, form or event and press Enter. The graph then shows only the chain of dependencies running through it (for a form or event, through any of its fields), at the level you are on.">
        <span class="row2"><input type="search" list="fieldlist" placeholder="Field, form or event…" autocomplete="off" value={focus()} onChange={onFieldChange} />
          <button class="btn sm" title="Clear focus" onClick={onClearFocus}>✕</button></span>
        <datalist id="fieldlist"><For each={fields()}>{(field) => <option value={field.variable}>{field.label.slice(0, 70)}</option>}</For>
          <For each={need(model()).parsed.forms}>{(form) => <option value={form.id}>Form: {form.label}</option>}</For>
          <For each={events()}>{(event) => <option value={event.id}>Event: {event.label}</option>}</For></datalist>
      </Labeled>
      <FocusControls />
    </details>
  );
}
