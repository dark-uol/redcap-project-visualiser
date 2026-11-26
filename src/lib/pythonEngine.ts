/* The Python evaluation core (python/redcap_display) running in the browser through Pyodide. Pure: no Solid, no DOM. */
import type { ParsedODM } from './types';
import { rememberBlankFields } from './whatIf';
import type { VisibilityInfo, WhatIfContext } from './whatIf';

/**
 * The Python sources, read straight from python/ so the browser runs exactly the files the Python tests cover.
 * Vite inlines them as text; nothing here is a copy.
 */
const sources = import.meta.glob('../../python/redcap_display/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The part of a parsed project the Python engine reads: the TypeScript parser stays the only XML parser. */
export function pythonMetadata(parsed: ParsedODM): unknown {
  return {
    forms: parsed.forms.map((form) => ({ id: form.id })),
    fields: parsed.fields.map((item) => ({
      variable: item.variable, type: item.type, form: item.form, branching: item.branching, annotation: item.annotation,
      ...(item.synthetic ? { synthetic: true } : {}),
    })),
    formLogic: parsed.formLogic,
    events: parsed.events.map((event) => ({ id: event.id, label: event.label, arm: event.arm, armName: event.armName, forms: event.forms })),
  };
}

export interface PythonVisibilityEngine {
  /** One call across the bridge per evaluation; the result has the shape `evaluateVisibility` returns. */
  evaluate(context: WhatIfContext): Map<string, VisibilityInfo>;
  /** The Python version the core runs on, e.g. "3.14.2". */
  readonly pythonVersion: string;
  destroy(): void;
}

/** The local date as `YYYY-MM-DD`, from the JavaScript clock, so "today" matches the TypeScript engine whatever time zone Pyodide assumes. */
function localIsoDate(): string {
  const now = new Date();
  return String(now.getFullYear()).padStart(4, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

/** The slice of the Pyodide API used here, so the module needs no Pyodide types at import time. */
interface PyodideRuntime {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void };
  runPython(code: string): unknown;
  pyimport(name: string): { Engine: (metadata: string) => PythonEngineProxy };
}
interface PythonEngineProxy {
  evaluate_json(context: string): string;
  destroy(): void;
}

export interface PythonRuntimeOptions {
  /** Directory the Pyodide files are served from (browser). Left out under Node, where the package supplies them. */
  indexURL?: string;
}

const PACKAGE_ROOT = '/redcap_display_package';

let runtimePromise: Promise<PyodideRuntime> | null = null;

/** Load Pyodide once and put the Python package on its path. A failed load is not remembered, so the next call retries. */
export function loadPythonRuntime(options: PythonRuntimeOptions = {}): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async function load(): Promise<PyodideRuntime> {
      const { loadPyodide } = await import('pyodide');
      const runtime = (await loadPyodide(options.indexURL ? { indexURL: options.indexURL } : {})) as unknown as PyodideRuntime;
      runtime.FS.mkdirTree(PACKAGE_ROOT + '/redcap_display');
      Object.entries(sources).forEach(function writeSource([path, text]) {
        runtime.FS.writeFile(PACKAGE_ROOT + '/redcap_display/' + path.slice(path.lastIndexOf('/') + 1), text);
      });
      runtime.runPython('import sys\nsys.path.insert(0, "' + PACKAGE_ROOT + '")');
      return runtime;
    })();
    runtimePromise.catch(function forget() { runtimePromise = null; });
  }
  return runtimePromise;
}

/** Build an engine for one project. Evaluation is synchronous once the runtime is loaded. */
export async function createPythonVisibility(parsed: ParsedODM, options: PythonRuntimeOptions = {}): Promise<PythonVisibilityEngine> {
  const runtime = await loadPythonRuntime(options);
  const proxy = runtime.pyimport('redcap_display').Engine(JSON.stringify(pythonMetadata(parsed)));
  const pythonVersion = String(runtime.runPython('import sys\n".".join(map(str, sys.version_info[:3]))'));
  return {
    pythonVersion,
    evaluate: function evaluate(context: WhatIfContext): Map<string, VisibilityInfo> {
      const outcome = JSON.parse(proxy.evaluate_json(JSON.stringify({ ...context, today: context.today ?? localIsoDate() }))) as { results: Record<string, VisibilityInfo>; blank: string[] };
      const results = new Map(Object.entries(outcome.results));
      rememberBlankFields(results, outcome.blank);
      return results;
    },
    destroy: function destroy(): void { proxy.destroy(); },
  };
}
