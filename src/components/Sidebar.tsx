import { Show } from 'solid-js';
import { need, model, curEx, pair } from '../store';
import ViewSection from './sidebar/ViewSection';
import DependencyTypesSection from './sidebar/DependencyTypesSection';
import ExploringSection from './sidebar/ExploringSection';
import FormLinkFocusSection from './sidebar/FormLinkFocusSection';
import FocusSection from './sidebar/FocusSection';
import EventsSection from './sidebar/EventsSection';
import FormsSection from './sidebar/FormsSection';

export default function Sidebar() {
  return (
    <aside id="side">
      <ViewSection />
      <DependencyTypesSection />
      <Show when={curEx()}>
        <ExploringSection />
      </Show>
      <Show when={pair()}>
        <FormLinkFocusSection />
      </Show>
      <FocusSection />
      <Show when={(need(model()).parsed.events || []).length}>
        <EventsSection />
      </Show>
      <FormsSection />
    </aside>
  );
}
