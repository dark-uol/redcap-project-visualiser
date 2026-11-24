/* Main workspace: sidebar plus the tabbed content area. */
import { For, Show } from 'solid-js';
import { tab, setTab } from '../store.js';
import Sidebar from './Sidebar.jsx';
import DownloadMenu from './DownloadMenu.jsx';
import GraphView from './GraphView.jsx';
import MatrixTab from './MatrixTab.jsx';
import AnalysisTab from './AnalysisTab.jsx';
import DepsTab from './DepsTab.jsx';
import FieldsTab from './FieldsTab.jsx';

const TABS = [['graph', 'Graph'], ['matrix', 'Matrix'], ['analysis', 'Analysis'], ['deps', 'Dependencies'], ['fields', 'Fields']];

export default function Workspace() {
  return (
    <main id="app">
      <Sidebar />
      <div id="content">
        <nav id="tabs">
          <For each={TABS}>{([k, l]) => <button data-tab={k} class={{ active: tab() === k }} onClick={() => setTab(k)}>{l}</button>}</For>
          <span class="grow"></span>
          <DownloadMenu />
        </nav>
        <div class={{ tab: true, active: tab() === 'graph' }} id="tab-graph"><GraphView /></div>
        <Show when={tab() === 'matrix'}><div class="tab active"><MatrixTab /></div></Show>
        <Show when={tab() === 'analysis'}><div class="tab active" id="tab-analysis"><AnalysisTab /></div></Show>
        <Show when={tab() === 'deps'}><div class="tab active" id="tab-deps"><DepsTab /></div></Show>
        <Show when={tab() === 'fields'}><div class="tab active" id="tab-fields"><FieldsTab /></div></Show>
      </div>
    </main>
  );
}
