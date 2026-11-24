import { Show } from 'solid-js';
import { need, model } from '../store';
import ViewSection from './sidebar/ViewSection';
import DependencyTypesSection from './sidebar/DependencyTypesSection';
import NavigationSection from './sidebar/NavigationSection';
import EventsSection from './sidebar/EventsSection';
import FormsSection from './sidebar/FormsSection';

export default function Sidebar() {
  return (
    <aside id="side">
      <ViewSection />
      <DependencyTypesSection />
      <NavigationSection />
      <Show when={(need(model()).parsed.events || []).length}>
        <EventsSection />
      </Show>
      <FormsSection />
    </aside>
  );
}
