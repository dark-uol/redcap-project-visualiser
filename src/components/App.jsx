import { Show } from 'solid-js';
import { model, loadError } from '../store.js';
import Toolbar from './Toolbar.jsx';
import FileDrop, { useFileDrop } from './FileDrop.jsx';
import Workspace from './Workspace.jsx';

export default function App() {
  useFileDrop();
  return (
    <div style="display:contents">
      <Toolbar />
      <Show when={loadError()}><p style="color:var(--danger);padding:8px 16px;margin:0">{loadError()}</p></Show>
      <Show when={!model()}><FileDrop /></Show>
      <Show when={model()}><Workspace /></Show>
    </div>
  );
}
