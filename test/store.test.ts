/* Characterization tests for src/store/: pin current behaviour before the store is refactored.
   The store is a module singleton, so each test starts from a freshly loaded sample (loadText resets navigation). */
import sampleRaw from '../public/sample/sample.xml?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from 'solid-js';
import { download } from '../src/lib/download';
import * as store from '../src/store';
import type { FormPair } from '../src/lib/types';

vi.mock('../src/lib/download', () => ({ download: vi.fn() }));

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

beforeEach(() => {
  vi.clearAllMocks();
  load(sampleXml, 'sample');
  // swimlane is the default renderer and implies instances; these tests exercise the plain Graphviz view
  settle(() => { store.setInstances(false); store.presentation.setRenderer('graphviz'); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clampDepth', () => {
  it('clamps to 1..50 and rounds', () => {
    expect(store.clampDepth(0)).toBe(1);
    expect(store.clampDepth(99)).toBe(50);
    expect(store.clampDepth(3.6)).toBe(4);
    expect(store.clampDepth(7)).toBe(7);
  });

  it('falls back to 1 for non-numeric input', () => {
    expect(store.clampDepth('x')).toBe(1);
    expect(store.clampDepth(undefined)).toBe(1);
    expect(store.clampDepth(NaN)).toBe(1);
  });
});

describe('need', () => {
  it('returns the value when present, including falsy non-nullish values', () => {
    expect(store.need(5)).toBe(5);
    expect(store.need(0)).toBe(0);
    expect(store.need('')).toBe('');
  });

  it('throws when null or undefined', () => {
    expect(() => store.need(null)).toThrow('No project loaded');
    expect(() => store.need(undefined)).toThrow('No project loaded');
  });
});

describe('loadText', () => {
  it('sets the model and derives fileBase from the name', () => {
    expect(store.model()).not.toBeNull();
    expect(store.fileBase()).toBe('sample');
  });

  it('strips .xml case-insensitively and replaces unsafe characters in fileBase', () => {
    load(sampleXml, 'my study (v2).XML');
    expect(store.fileBase()).toBe('my_study_v2_');
  });

  it('resets navigation to the default state', () => {
    settle(() => {
      store.selection.setTab('matrix');
      store.selection.setLevel('field');
      store.focusing.setFocus('age');
      store.selection.setSelected('age');
    });
    load(sampleXml, 'sample');
    expect(store.selection.tab()).toBe('graph');
    expect(store.selection.level()).toBe('form');
    expect(store.focusing.focus()).toBe('');
    expect(store.selection.selected()).toBeNull();
    expect(store.selection.selectedEdge()).toBeNull();
    expect(store.focusing.pair()).toBeNull();
  });

  it('resets the view settings (direction, renderer, instances)', () => {
    settle(() => {
      store.presentation.setDir('TD');
      store.presentation.setRenderer('mermaid');
      store.setInstances(true);
    });
    load(sampleXml, 'sample');
    expect(store.presentation.dir()).toBe('LR');
    expect(store.presentation.renderer()).toBe('swimlane');
    expect(store.instances()).toBe(false);
  });

  it('clears a previous load error on success', () => {
    load('<not xml', 'bad');
    expect(store.loadError()).not.toBe('');
    load(sampleXml, 'sample');
    expect(store.loadError()).toBe('');
  });

  it('on invalid XML sets loadError and leaves the previous model', () => {
    const before = store.model();
    load('<not xml', 'bad');
    expect(store.loadError()).not.toBe('');
    expect(store.model()).toBe(before);
  });
});

describe('setFocusDepth', () => {
  it('clamps values through clampDepth', () => {
    settle(() => store.focusing.setFocusDepth(0));
    expect(store.focusing.focusDepth()).toBe(1);
    settle(() => store.focusing.setFocusDepth(99));
    expect(store.focusing.focusDepth()).toBe(50);
    settle(() => store.focusing.setFocusDepth('x'));
    expect(store.focusing.focusDepth()).toBe(1);
  });
});

describe('selection', () => {
  const edge: FormPair = { from: 'a', to: 'b' } as FormPair;

  it('setSelected(non-null) clears selectedEdge', () => {
    settle(() => store.selection.setSelectedEdge(edge));
    settle(() => store.selection.setSelected('demographics'));
    expect(store.selection.selectedEdge()).toBeNull();
    expect(store.selection.selected()).toBe('demographics');
  });

  it('setSelected(null) does not clear selectedEdge', () => {
    settle(() => store.selection.setSelectedEdge(edge));
    settle(() => store.selection.setSelected(null));
    expect(store.selection.selectedEdge()).toBe(edge);
  });

  it('setSelectedKeepingEdge leaves selectedEdge alone', () => {
    settle(() => store.selection.setSelectedEdge(edge));
    settle(() => store.selection.setSelectedKeepingEdge('demographics'));
    expect(store.selection.selectedEdge()).toBe(edge);
    expect(store.selection.selected()).toBe('demographics');
  });

  it('pickNode selects the node and clears selectedEdge', () => {
    settle(() => store.selection.setSelectedEdge(edge));
    settle(() => store.pickNode('baseline'));
    expect(store.selection.selectedEdge()).toBeNull();
    expect(store.selection.selected()).toBe('baseline');
  });

  it('jumpToField moves to field level on the graph tab with the field selected', () => {
    settle(() => store.selection.setTab('matrix'));
    settle(() => store.jumpToField('age'));
    expect(store.selection.level()).toBe('field');
    expect(store.focusing.focus()).toBe('age');
    expect(store.selection.selected()).toBe('age');
    expect(store.selection.tab()).toBe('graph');
    expect(store.focusing.pair()).toBeNull();
  });
});

describe('derived view state', () => {
  it('view, opts, dotSrc and mermaidSrc are non-null after load', () => {
    expect(store.view()).not.toBeNull();
    expect(store.opts()).not.toBeNull();
    expect(store.dotSrc()).toEqual(expect.stringContaining('digraph'));
    expect(store.mermaidSrc()).not.toBe('');
  });

  it('view and opts are null before any load; the DOT and Mermaid sources are empty strings', async () => {
    vi.resetModules();
    const fresh = await import('../src/store');
    expect(fresh.model()).toBeNull();
    expect(fresh.view()).toBeNull();
    expect(fresh.opts()).toBeNull();
    expect(fresh.dotSrc()).toBe('');
    expect(fresh.mermaidSrc()).toBe('');
  });

  it('starts at form level with a non-empty form view', () => {
    const view = store.view();
    expect(view?.level).toBe('form');
    expect(view?.nodes.length).toBeGreaterThan(0);
  });

  it('turning off all dependency types changes the view', () => {
    const before = store.view();
    settle(() => store.filters.setTypesOn({ branching: false, calc: false, piping: false, action: false, form: false } as never));
    expect(store.view()).not.toBe(before);
    expect(store.view()?.edges.length ?? 0).toBeLessThanOrEqual(before?.edges.length ?? 0);
  });

  it('switching to field level changes the view level', () => {
    settle(() => store.selection.setLevel('field'));
    expect(store.view()?.level).toBe('field');
  });

  it('hiding a form removes it from the form view', () => {
    const formId = store.view()!.nodes[0]!.id;
    settle(() => store.filters.setFormsOn({ [formId]: false }));
    expect(store.view()?.nodes.some((n) => n.id === formId)).toBe(false);
  });

  it('formLabel returns the form label, or the id for unknown forms', () => {
    expect(store.formLabel('demographics')).toBe('Demographics');
    expect(store.formLabel('nope')).toBe('nope');
  });
});

describe('instanceMode', () => {
  it('is false by default', () => {
    expect(store.instanceMode()).toBe(false);
  });

  it('is true only with instances on, form level and events present', () => {
    settle(() => store.setInstances(true));
    expect(store.instanceMode()).toBe(true);
    settle(() => store.selection.setLevel('field'));
    expect(store.instanceMode()).toBe(false);
    settle(() => store.selection.setLevel('form'));
    settle(() => store.setInstances(false));
    expect(store.instanceMode()).toBe(false);
  });

  it('is false with instances on when the project has no events', () => {
    const noEvents = sampleXml.replace(/<StudyEventDef[\s\S]*?<\/StudyEventDef>/g, '');
    load(noEvents, 'noev');
    settle(() => store.setInstances(true));
    expect(store.instanceMode()).toBe(false);
  });
});

describe('expansion of back / forward references', () => {
  it('expandRef adds an explore entry seeded with the node', () => {
    const node = store.view()!.nodes[0]!.id;
    settle(() => store.expandRef(node, 'up'));
    const ex = store.currentExploration();
    expect(ex).not.toBeNull();
    expect(ex!.seeds).toContain(node);
    expect(ex!.exp).toHaveLength(1);
    expect(ex!.exp[0]!.node).toBe(node);
    expect(store.exploreVisible(ex!).has(node)).toBe(true);
  });

  it('collapseRef removes that expansion step', () => {
    const node = store.view()!.nodes[0]!.id;
    settle(() => store.expandRef(node, 'up'));
    settle(() => store.collapseRef(node, 'up'));
    expect(store.currentExploration()?.exp ?? []).toHaveLength(0);
  });

  it('collapseRef does nothing when nothing is being explored', () => {
    store.collapseRef('demographics', 'up');
    flush();
    expect(store.explore()).toBeNull();
  });

  it('changing level clears the explore state', () => {
    settle(() => store.expandRef(store.view()!.nodes[0]!.id, 'down'));
    expect(store.explore()).not.toBeNull();
    settle(() => store.selection.setLevel('field'));
    expect(store.explore()).toBeNull();
  });
});

describe('toggleExpandForm', () => {
  it('toggles a form id in and out of the expanded set', () => {
    expect(store.expanded().has('demographics')).toBe(false);
    settle(() => store.toggleExpandForm('demographics'));
    expect(store.expanded().has('demographics')).toBe(true);
    settle(() => store.toggleExpandForm('demographics'));
    expect(store.expanded().has('demographics')).toBe(false);
  });
});

describe('downloads', () => {
  it('downloadCsv downloads dependencies as CSV named after the file', () => {
    store.downloadCsv();
    expect(download).toHaveBeenCalledTimes(1);
    const [name, body, mime] = vi.mocked(download).mock.calls[0]!;
    expect(name).toBe('sample_dependencies.csv');
    expect(typeof body).toBe('string');
    expect(mime).toBe('text/csv;charset=utf-8');
  });

  it('downloadDot downloads the DOT source with a level suffix', () => {
    store.downloadDot();
    expect(download).toHaveBeenCalledWith('sample_forms.dot', store.dotSrc());
  });

  it('downloadMermaid downloads the Mermaid source with a level suffix', () => {
    store.downloadMermaid();
    expect(download).toHaveBeenCalledWith('sample_forms.mmd', store.mermaidSrc());
  });
});

describe('browser history', () => {
  it('replaces (does not push) the first state after a load', async () => {
    vi.resetModules();
    const fresh = await import('../src/store');
    const push = vi.spyOn(history, 'pushState');
    const replace = vi.spyOn(history, 'replaceState');
    fresh.loadText(sampleXml, 'sample');
    flush();
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('pushes a state when navigation changes after load', () => {
    const push = vi.spyOn(history, 'pushState');
    settle(() => store.selection.setTab('matrix'));
    expect(push).toHaveBeenCalled();
    const [state] = push.mock.calls.at(-1)!;
    expect(state).toEqual(expect.objectContaining({ tab: 'matrix' }));
  });
});

describe('effectiveRenderer', () => {
  it('uses swimlane only for a longitudinal project at form or event level, else Graphviz', () => {
    settle(() => store.presentation.setRenderer('swimlane'));
    settle(() => store.selection.setLevel('field'));
    expect(store.effectiveRenderer()).toBe('graphviz');
    settle(() => store.selection.setLevel('form'));
    expect(store.effectiveRenderer()).toBe('graphviz'); // form instances are off
    settle(() => store.setInstances(true));
    expect(store.effectiveRenderer()).toBe('swimlane');
    settle(() => store.selection.setLevel('event'));
    expect(store.effectiveRenderer()).toBe('swimlane');
    settle(() => store.presentation.setRenderer('mermaid'));
    expect(store.effectiveRenderer()).toBe('mermaid');
    settle(() => store.selection.setLevel('field'));
    settle(() => store.presentation.setRenderer('elk'));
    expect(store.effectiveRenderer()).toBe('elk');
  });
});

describe('switching renderer', () => {
  it('never changes the view, the selection or the exploration, only how the view is drawn', () => {
    settle(() => { store.selection.setLevel('form'); store.setInstances(true); });
    const nodeIds = store.view()!.nodes.map((n) => n.id);
    settle(() => store.selection.setSelected(nodeIds[0]!));
    const before = { selected: store.selection.selected(), nodes: nodeIds, expanded: [...store.expanded()], instances: store.instances() };
    for (const renderer of ['elk', 'swimlane', 'mermaid', 'graphviz'] as const) {
      settle(() => store.presentation.setRenderer(renderer));
      expect(store.selection.selected()).toBe(before.selected);
      expect(store.view()!.nodes.map((n) => n.id)).toEqual(before.nodes);
      expect([...store.expanded()]).toEqual(before.expanded);
      expect(store.instances()).toBe(before.instances);
    }
  });
});
