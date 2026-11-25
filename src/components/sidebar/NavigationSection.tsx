/* One place for everything that narrows or zooms the graph: focus, exploring, form-link focus and expanded forms / events.
   The detail panel's buttons (Zoom, Show chain, Add to graph) act on the selected node; whatever they switch on is listed and cleared here. */
import { createMemo } from 'solid-js';
import { focusKind } from '../../lib/graph';
import { need, model, focusing, formLabel, expanded, expandedEvents, currentExploration, exploreVisible, setExplore, toggleExpandForm, toggleExpandEvent } from '../../store';
import FocusControls from '../FocusControls';
import { NavigationSectionView } from './NavigationSectionView';
import type { NamedOption, PairLabels } from './NavigationSectionView';

const { focus, setFocus, pair, setPair } = focusing;

/** Connector: the focus, exploration, form-link focus and expansions from the store, with the clears and resets wired back to it. */
export default function NavigationSection() {
  const fields = () => need(model()).parsed.fields;
  const events = () => need(model()).parsed.events || [];
  const formOptions = createMemo((): NamedOption[] => need(model()).parsed.forms.map((form) => ({ id: form.id, label: form.label })));
  const eventOptions = createMemo((): NamedOption[] => events().map((event) => ({ id: event.id, label: event.label })));
  const eventLabelOf = (eventId: string): string => events().find((event) => event.id === eventId)?.label ?? eventId;
  /** `form` or `form@event` expansion id as a readable name. */
  const expansionLabel = (id: string): string => {
    const [formId, eventId] = id.split('@');
    return formLabel(formId) + (eventId ? ' @ ' + eventLabelOf(eventId) : '');
  };
  /** The focus as a readable name, with what kind of thing it is. */
  const focusLabel = (): string => {
    const kind = focusKind(need(model()), focus());
    return kind === 'form' ? formLabel(focus()) + ' (form)' : kind === 'event' ? eventLabelOf(focus()) + ' (event)' : focus();
  };
  const zoomedForms = createMemo((): NamedOption[] => [...expanded()].map((id) => ({ id, label: expansionLabel(id) })));
  const zoomedEvents = createMemo((): NamedOption[] => [...expandedEvents()].map((id) => ({ id, label: eventLabelOf(id) })));
  const pairLabels = createMemo((): PairLabels | null => {
    const current = pair();
    return current ? { fromLabel: formLabel(current.from), toLabel: formLabel(current.to) } : null;
  });
  const exploringCount = (): number | null => {
    const exploration = currentExploration();
    return exploration ? exploreVisible(exploration).size : null;
  };

  /** Accepts a typed field name only if it exists in the model. Returns false for an unknown name, so the view restores the focus. */
  const onFocusPick = function onFocusPick(raw: string): boolean {
    const value = raw.trim();
    if (!value) { setFocus(''); return true; }
    if (focusKind(need(model()), value) === null) return false;
    setExplore(null);
    setPair(null);
    setFocus(value);
    return true;
  };
  const onClearFocus = function onClearFocus(): void { setFocus(''); };
  const onExitExploring = function onExitExploring(): void { setExplore(null); };
  const onClearPair = function onClearPair(): void { setPair(null); };
  const onResetAll = function onResetAll(): void {
    setFocus('');
    setPair(null);
    setExplore(null);
    [...expanded()].forEach(toggleExpandForm);
    [...expandedEvents()].forEach(toggleExpandEvent);
  };
  const onCollapseForm = function onCollapseForm(formId: string): void { toggleExpandForm(formId); };
  const onCollapseEvent = function onCollapseEvent(eventId: string): void { toggleExpandEvent(eventId); };

  return (
    <NavigationSectionView
      focus={focus()}
      focusLabel={focusLabel()}
      exploring={exploringCount()}
      pair={pairLabels()}
      zoomedForms={zoomedForms()}
      zoomedEvents={zoomedEvents()}
      fields={fields()}
      forms={formOptions()}
      events={eventOptions()}
      onFocusPick={onFocusPick}
      onClearFocus={onClearFocus}
      onExitExploring={onExitExploring}
      onClearPair={onClearPair}
      onResetAll={onResetAll}
      onCollapseForm={onCollapseForm}
      onCollapseEvent={onCollapseEvent}
    >
      <FocusControls />
    </NavigationSectionView>
  );
}
