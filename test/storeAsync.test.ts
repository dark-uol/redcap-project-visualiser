/* Characterization tests for the async and side-effecting parts of src/store/: graph rendering, status messages,
   sample and file loading, SVG download, browser history, anchor capture and selection reset.
   Complements test/store.test.ts. The store is a module singleton, so every test starts from a freshly loaded sample. */
import sampleRaw from '../public/sample/sample.xml?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from 'solid-js';
import { download } from '../src/lib/download';
import { renderDot, renderMermaid } from '../src/lib/renderers';
import { instanceIdFor } from '../src/lib/selection';
import * as store from '../src/store';

vi.mock('../src/lib/download', () => ({ download: vi.fn() }));
vi.mock('../src/lib/renderers', () => ({ renderDot: vi.fn(), renderMermaid: vi.fn() }));

const sampleXml: string = sampleRaw;

/** Loads text as the app does and settles Solid's batched updates. */
const load = (text: string, name?: string): void => {
  store.loadText(text, name);
  flush();
};

/** Shorthand for a write followed by a flush, so reads see the new value. */
const settle = (write: () => void): void => {
  write();
  flush();
};

/** A fake rendered SVG element, shaped like what the real renderers return. */
const makeSvg = (label: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('data-label', label);
  svg.appendChild(group);
  return svg;
};

/** A promise whose resolution the test controls. */
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

const allFormsOff = (): Record<string, boolean> =>
  Object.fromEntries(store.model()!.parsed.forms.map((f) => [f.id, false]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renderDot).mockImplementation(async () => makeSvg('dot'));
  vi.mocked(renderMermaid).mockImplementation(async () => makeSvg('mermaid'));
  load(sampleXml, 'sample');
  settle(() => {
    store.setInstances(false);
    store.presentation.setRenderer('graphviz');
    store.presentation.setDir('LR'); // loadText does not reset direction, so an earlier test could leave it changed
    store.filters.setFormsOn({});
    store.setForcedFor('');
    store.setAnchorCapture(null);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('graph rendering', () => {
  it('after a load, publishes the SVG, the view it came from, and clears busy and the message', async () => {
    await vi.waitFor(() => expect(store.svgEl()).not.toBeNull());
    expect(store.svgEl()?.querySelector('g')?.getAttribute('data-label')).toBe('dot');
    expect(renderDot).toHaveBeenCalled();
    expect(store.svgView()).toBe(store.view());
    expect(store.busy()).toBe(false);
    expect(store.renderMsg()).toBe('');
  });

  it('uses renderMermaid when the renderer is switched to mermaid', async () => {
    vi.clearAllMocks();
    settle(() => store.presentation.setRenderer('mermaid'));
    await vi.waitFor(() => expect(renderMermaid).toHaveBeenCalled());
    expect(renderDot).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(store.svgEl()?.querySelector('g')?.getAttribute('data-label')).toBe('mermaid'));
  });

  it('a rejected render sets a message prefixed "Could not render graph:" and clears the SVG', async () => {
    vi.mocked(renderDot).mockRejectedValueOnce(new Error('boom'));
    settle(() => store.presentation.setDir('TD'));
    await vi.waitFor(() => expect(store.renderMsg()).toMatch(/^Could not render graph:/));
    expect(store.renderMsg()).toContain('boom');
    expect(store.svgEl()).toBeNull();
    expect(store.svgView()).toBeNull();
    expect(store.busy()).toBe(false);
  });

  it('discards a stale render that resolves after a newer one', async () => {
    const first = deferred<SVGSVGElement>();
    const firstSvg = makeSvg('first');
    const secondSvg = makeSvg('second');
    let renderCount = 0;
    // the first render started by this test stays pending; every later one resolves at once
    vi.mocked(renderDot).mockImplementation(() => {
      renderCount++;
      return renderCount === 1 ? first.promise : Promise.resolve(secondSvg);
    });

    settle(() => store.presentation.setDir('TD'));
    settle(() => store.presentation.setDir('LR'));
    await vi.waitFor(() => expect(store.svgEl()).toBe(secondSvg));

    first.resolve(firstSvg);
    await new Promise((res) => setTimeout(res, 0));
    expect(store.svgEl()).toBe(secondSvg);
    expect(store.renderMsg()).toBe('');
  });
});

describe('status messages', () => {
  it('reports "Nothing to show" and no SVG when every form is hidden', () => {
    settle(() => store.filters.setFormsOn(allFormsOff()));
    expect(store.renderMsg()).toBe('Nothing to show with the current filters.');
    expect(store.svgEl()).toBeNull();
  });

  // Skipped: no event-level filter combination of the sample is known to leave an event view with no edges
  // without also leaving no nodes, and the graph status memo checks nodes first.
});

describe('tooBig and forcedFor', () => {
  it('exports MAX_AUTO_EDGES as 700 and reports tooBig false for the sample', () => {
    expect(store.MAX_AUTO_EDGES).toBe(700);
    expect(store.tooBig()).toBe(false);
  });

  it('forcedFor round-trips through setForcedFor', () => {
    settle(() => store.setForcedFor('some dot source'));
    expect(store.forcedFor()).toBe('some dot source');
    settle(() => store.setForcedFor(''));
    expect(store.forcedFor()).toBe('');
  });
});

describe('loadSample', () => {
  it('fetches the sample from the base URL and loads it as "sample"', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => sampleXml }));
    vi.stubGlobal('fetch', fetchMock);
    await store.loadSample();
    expect(fetchMock).toHaveBeenCalledWith('/sample/sample.xml');
    expect(store.fileBase()).toBe('sample');
    expect(store.model()).not.toBeNull();
    expect(store.loadError()).toBe('');
  });

  it('sets loadError with the HTTP status when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })));
    await store.loadSample();
    expect(store.loadError()).toContain('Could not load sample');
    expect(store.loadError()).toContain('HTTP 404');
  });

  it('sets loadError when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await store.loadSample();
    expect(store.loadError()).toMatch(/^Could not load sample/);
    expect(store.loadError()).toContain('Failed to fetch');
  });
});

describe('readFile', () => {
  it('loads the file contents and derives fileBase from its name', async () => {
    store.readFile(new File([sampleXml], 'study.xml'));
    await vi.waitFor(() => expect(store.fileBase()).toBe('study'));
    expect(store.model()).not.toBeNull();
    expect(store.loadError()).toBe('');
  });

  it('sets loadError when the reader fails', () => {
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });
    store.readFile(new File([sampleXml], 'broken.xml'));
    flush();
    expect(store.loadError()).toBe('Could not read file');
  });
});

describe('downloadSvg', () => {
  it('downloads the rendered SVG with a level suffix and XML declaration', async () => {
    await vi.waitFor(() => expect(store.svgEl()).not.toBeNull());
    vi.mocked(download).mockClear();
    store.downloadSvg();
    expect(download).toHaveBeenCalledTimes(1);
    const [name, body, mime] = vi.mocked(download).mock.calls[0]!;
    expect(name).toBe('sample_forms.svg');
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(body).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(mime).toBe('image/svg+xml;charset=utf-8');
  });

  it('alerts and does not download when no SVG is rendered', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    settle(() => store.filters.setFormsOn(allFormsOff()));
    vi.mocked(download).mockClear();
    store.downloadSvg();
    expect(alertSpy).toHaveBeenCalledWith('Render the graph first.');
    expect(download).not.toHaveBeenCalled();
  });
});

describe('popstate', () => {
  it('returns to an earlier navigation state from the same file', () => {
    const push = vi.spyOn(history, 'pushState');
    settle(() => store.selection.setTab('matrix'));
    const matrixState = push.mock.calls.at(-1)![0] as { m: number };
    settle(() => store.selection.setTab('deps'));
    expect(store.selection.tab()).toBe('deps');

    window.dispatchEvent(new PopStateEvent('popstate', { state: matrixState }));
    flush();
    expect(store.selection.tab()).toBe('matrix');
  });

  it('ignores a state from a different file sequence', () => {
    const push = vi.spyOn(history, 'pushState');
    settle(() => store.selection.setTab('matrix'));
    const matrixState = push.mock.calls.at(-1)![0] as { m: number };
    settle(() => store.selection.setTab('deps'));

    window.dispatchEvent(new PopStateEvent('popstate', { state: { ...matrixState, m: matrixState.m + 1000 } }));
    flush();
    expect(store.selection.tab()).toBe('deps');
  });

  it('ignores a null state', () => {
    settle(() => store.selection.setTab('matrix'));
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    flush();
    expect(store.selection.tab()).toBe('matrix');
  });
});

describe('anchor capture', () => {
  it('reports zoom when a form is expanded and back when it is collapsed', () => {
    const capture = vi.fn();
    store.setAnchorCapture(capture);
    settle(() => store.toggleExpandForm('demographics'));
    expect(capture).toHaveBeenLastCalledWith('demographics', { zoom: true });
    settle(() => store.toggleExpandForm('demographics'));
    expect(capture).toHaveBeenLastCalledWith('demographics', { back: true });
  });

  it('reports the node id for expandRef', () => {
    const capture = vi.fn();
    store.setAnchorCapture(capture);
    const formId = store.model()!.parsed.forms[0]!.id;
    settle(() => store.expandRef(formId, 'down'));
    expect(capture.mock.calls.at(-1)![0]).toBe(formId);
  });

  it('stops reporting after setAnchorCapture(null) without throwing', () => {
    const capture = vi.fn();
    store.setAnchorCapture(capture);
    store.setAnchorCapture(null);
    const callsBefore = capture.mock.calls.length;
    expect(() => store.toggleExpandForm('demographics')).not.toThrow();
    expect(() => store.captureAnchor('demographics')).not.toThrow();
    expect(capture.mock.calls.length).toBe(callsBefore);
  });
});

describe('selection reset when instance mode flips', () => {
  it('clears an instance-scoped selection when instances turn on', () => {
    settle(() => store.selection.setSelected(instanceIdFor('Form.demographics', 'Event.baseline_arm_1')));
    settle(() => store.setInstances(true));
    expect(store.instanceMode()).toBe(true);
    expect(store.selection.selected()).toBeNull();
  });

  it('keeps a plain selection when instances turn on', () => {
    settle(() => store.selection.setSelected('Form.demographics'));
    settle(() => store.setInstances(true));
    expect(store.instanceMode()).toBe(true);
    expect(store.selection.selected()).toBe('Form.demographics');
  });
});
