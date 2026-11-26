/// <reference types="node" />
/**
 * The Python core on Pyodide, the runtime the browser uses (CPython compiled to WebAssembly), driven from Node.
 * It runs the Python unit tests unchanged on that runtime, and checks the TypeScript wrapper the app calls
 * against the TypeScript engine.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { buildModel } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import { createPythonVisibility, loadPythonRuntime } from '../src/lib/pythonEngine';
import { ANY_EVENT, evaluateVisibility, explainLogic } from '../src/lib/whatIf';
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
      'result = unittest.TextTestRunner(stream=stream, verbosity=0).run(unittest.defaultTestLoader.loadTestsFromNames(["tests.test_parity", "tests.test_clock"]))',
      'json.dumps({"ran": result.testsRun, "failures": len(result.failures), "errors": len(result.errors), "output": stream.getvalue()[-3000:]})',
    ].join('\n')))) as { ran: number; failures: number; errors: number; output: string };
    expect(report.output).toContain('OK');
    expect([report.ran, report.failures, report.errors]).toEqual([7, 0, 0]);
  }, SLOW);

  it('gives Python the JavaScript clock\'s local date, whatever time zone Pyodide assumes', async () => {
    const parsed = { ...parseODM(sampleXml) };
    parsed.fields = [
      ...parsed.fields,
      { ...parsed.fields[0]!, variable: 'adult_by_dob', branching: 'datediff([dob_for_clock_test], "today", "y") >= 18' },
    ];
    const engine = await createPythonVisibility(parsed);
    const context: WhatIfContext = { values: { [ANY_EVENT]: { dob_for_clock_test: '2005-06-15' } }, mode: 'form', event: null };
    vi.useFakeTimers({ toFake: ['Date'] }); // after the load, which needs real timers
    try {
      vi.setSystemTime(new Date(2023, 5, 14, 23, 59));
      expect(engine.evaluate(context).get('adult_by_dob')?.state).toBe('hidden');
      vi.setSystemTime(new Date(2023, 5, 17, 0, 1));
      expect(engine.evaluate(context).get('adult_by_dob')?.state).toBe('shown');
      expect(engine.evaluate({ ...context, today: '2023-06-14' }).get('adult_by_dob')?.state).toBe('hidden'); // an injected date wins
    } finally {
      vi.useRealTimers();
    }
    engine.destroy();
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

  it('explains each part of a field\'s logic the same under both engines, including reads of hidden fields as blank', async () => {
    const parsed = parseODM(sampleXml);
    const model = buildModel(parsed);
    const engine = await createPythonVisibility(parsed);
    // consent is hidden at age 17, so it reads blank in pack_years' logic ([smoker] = '1' and [consent] = '1')
    const context: WhatIfContext = { values: { [ANY_EVENT]: { age: '17', smoker: '1', consent: '1' } }, mode: 'form', event: null };
    const expected = evaluateVisibility(model, context);
    const actual = engine.evaluate(context);
    let compared = 0;
    model.byVar.forEach((field) => {
      if (!field.branching) return;
      expect(explainLogic(model, context, actual, field.branching), field.variable).toEqual(explainLogic(model, context, expected, field.branching));
      compared++;
    });
    expect(compared).toBeGreaterThan(5);
    const packYears = explainLogic(model, context, actual, "[smoker] = '1' and [consent] = '1'");
    expect(packYears.map((part) => part.result)).toEqual([true, false]);
    engine.destroy();
  }, SLOW);
});
