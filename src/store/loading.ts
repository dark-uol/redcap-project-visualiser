/* Loading a project: from pasted or dropped text, the bundled sample, or a File. */
import { allTypesOn, DEFAULT_DIRECTION, DEFAULT_LINE_WIDTHS, DEFAULT_RENDERER, errorMessage } from './common';
import type { createNavigation } from './navigation';
import type { State } from './state';
import { parseODM } from '../lib/parser';
import { buildModel } from '../lib/graph';

export function createLoading(state: State, navigation: ReturnType<typeof createNavigation>) {
  const {
    setModel, setFileBase, setLoadError, setExplore, setExpanded, nextModelSequence,
  } = state;
  const { setFormQ, setFormsOn, setEventsOn, setCrossOnly, setInstanceOnly, setTypesOn } = state.rawFilters;
  const { setDir, setRenderer, setLineWidths } = state.presentation;
  const { rawSetInstances: setInstances } = state;
  const { resetNav } = navigation;
  const { clearValues, setMode, setEvent, setField } = state.whatIf;

  function loadText(text: string, name?: string): void {
    try {
      const parsed = parseODM(text);
      const builtModel = buildModel(parsed);
      nextModelSequence();
      setLoadError('');
      setFileBase((name || parsed.projectName).replace(/\.xml$/i, '').replace(/[^\w.-]+/g, '_') || 'redcap');
      resetNav(); setFormQ(''); setFormsOn({}); setEventsOn({}); setCrossOnly(false); setInstanceOnly(false);
      setExplore(null); setExpanded(new Set<string>());
      setTypesOn(allTypesOn());
      // View settings reset with a new project too, so they do not leak from one file to the next.
      setDir(DEFAULT_DIRECTION); setRenderer(DEFAULT_RENDERER); setInstances(false);
      setLineWidths(DEFAULT_LINE_WIDTHS);
      clearValues(); setMode('form'); setEvent(null); setField(null);
      setModel(builtModel);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }
  async function loadSample(): Promise<void> {
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'sample/sample.xml');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      loadText(await res.text(), 'sample');
    } catch (e) {
      setLoadError('Could not load sample/sample.xml (' + errorMessage(e) + ').');
    }
  }
  function readFile(f: File): void {
    const r = new FileReader();
    r.onload = () => loadText(String(r.result), f.name);
    r.onerror = () => setLoadError('Could not read file');
    r.readAsText(f);
  }

  return { loadText, loadSample, readFile };
}
