/// <reference types="node" />
/**
 * The Python core on Pyodide, the runtime the browser uses (CPython compiled to WebAssembly), driven from Node.
 * It runs the Python unit tests unchanged on that runtime, and checks the TypeScript wrapper the app calls
 * against the TypeScript engine.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import { createPythonVisibility, loadPythonRuntime } from '../src/lib/pythonEngine';
import { ANY_EVENT, evaluateVisibility } from '../src/lib/whatIf';
import type { WhatIfContext } from '../src/lib/whatIf';

const TEST_DIRECTORY = join(process.cwd(), 'python', 'tests');
const SLOW = 120_000; // loading the Pyodide runtime takes a few seconds

describe('Python core on Pyodide', () => {
  it('passes the Python parity tests on the Pyodide runtime', async () => {
    const runtime = await loadPythonRuntime();
    runtime.FS.mkdirTree('/redcap_display_package/tests');
    readdirSync(TEST_DIRECTORY)
      .filter((name) => name.endsWith('.py') || name === 'vectors.json')
      .forEach((name) => runtime.FS.writeFile('/redcap_display_package/tests/' + name, readFileSync(join(TEST_DIRECTORY, name), 'utf8')));
    const report = JSON.parse(String(runtime.runPython([
      'import io, json, unittest',
      'stream = io.StringIO()',
      'result = unittest.TextTestRunner(stream=stream, verbosity=0).run(unittest.defaultTestLoader.loadTestsFromName("tests.test_parity"))',
      'json.dumps({"ran": result.testsRun, "failures": len(result.failures), "errors": len(result.errors), "output": stream.getvalue()[-3000:]})',
    ].join('\n')))) as { ran: number; failures: number; errors: number; output: string };
    expect(report.output).toContain('OK');
    expect([report.ran, report.failures, report.errors]).toEqual([2, 0, 0]);
  }, SLOW);

  it('agrees with the TypeScript engine on the sample project, through the wrapper the app uses', async () => {
    const parsed = parseODM(sampleXml);
    const model = buildModel(parsed);
    const engine = await createPythonVisibility(parsed);
    expect(engine.pythonVersion).toMatch(/^3\.\d+\.\d+$/);
    const contexts: WhatIfContext[] = [
      { values: { [ANY_EVENT]: {} }, mode: 'form', event: null },
      { values: { [ANY_EVENT]: { age: '17', sex: '2' } }, mode: 'form', event: null },
      { values: { [ANY_EVENT]: { age: '30', sex: '2', smoker: '1', consent: '1', symptoms: ['99'] } }, mode: 'survey', event: null },
      { values: { [ANY_EVENT]: { age: '70' } }, mode: 'survey', event: parsed.events[0]?.id ?? null },
    ];
    contexts.forEach((context) => {
      const expected = evaluateVisibility(model, context);
      const actual = engine.evaluate(context);
      expect([...actual.keys()]).toEqual([...expected.keys()]);
      expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
    });
    engine.destroy();
  }, SLOW);
});
