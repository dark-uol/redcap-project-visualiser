# REDCap dependency graph

Client-only SolidJS 2 + Vite app. Loads a REDCap CDISC ODM metadata XML and draws field/form/event dependencies (branching logic, calcs, piping, action tags, form display logic). See README.md for user-facing usage.

## Commands
- `npm run dev` – dev server, http://localhost:5173 (HMR; use the `dev` entry in `.claude/launch.json` with preview tools).
- `npm run build` – production build to `dist/`. Vite does not type-check, so also run `npm run typecheck` (`tsc --noEmit`). There is **no linter**. `npm test` runs Vitest (jsdom) over `test/`: the pan/zoom maths, SVG helpers and click resolution of the graph view, the store, and the pure component views (`*.test.tsx`, rendered with `test/renderComponent.ts`). Connectors and `src/lib/` are only partly covered. Run typecheck, build and tests after changes, then verify UI changes in the browser (click "Load sample").
- `file://` does not work; always serve over http.
- Python core tests: `cd python && python3 -m unittest discover -s tests -t .` (standard library only, Python 3.9+). `npm test` also runs the same suite on Pyodide's Python (`test/pythonEngine.test.ts`).

## Layout
- The source is TypeScript (`strict`, `verbatimModuleSyntax`); JSX is Solid's (`jsxImportSource: @solidjs/web`).
- `src/store/` – all app state, created once in `index.ts` under one `createRoot`; components import from `src/store`. `state.ts` holds the signals, `derived.ts` the memos, `exploration.ts` and `rendering.ts` the expansion and graph-render effects, `navigation.ts` the history, `loading.ts` and `downloads.ts` the actions, `common.ts` the shared constants and helpers. Add new UI state to `state.ts`. Related signals are grouped as `filters`, `focusing`, `presentation`, `selection` (read them as e.g. `filters.typesOn()`).
- `src/lib/` – framework-free modules, no Solid imports: `types.ts` (shared domain types: parsed metadata, model, view), `parser.ts` (XML → fields/forms/events), `graph.ts` (model, cycle/depth/hub analysis, `buildView`), `exporters.ts` (Mermaid/DOT/CSV), `renderers.ts` (lazy-loads viz + mermaid), `download.ts`.
- `python/redcap_display/` – a pure-standard-library Python port of the What if evaluator (`logic.py` ← `src/lib/logic.ts`, `visibility.py` ← `evaluateVisibility` in `src/lib/whatIf.ts` plus the model parts of `graph.ts`, `engine.py` a JSON facade). The same files run under CPython (pipelines) and in the browser through Pyodide: `src/lib/pythonEngine.ts` lazy-loads Pyodide (self-hosted at `/pyodide/` by the plugin in `vite.config.ts`) and bundles the sources with `import.meta.glob(..., '?raw')`, so nothing is copied. The What if tab's **Engine** selector switches between the two; the store asks Python from a microtask (a signal write while a view reads is not allowed) and shows nothing until the result arrives. The TypeScript parser stays the only XML parser: Python gets `pythonMetadata(parsed)` as JSON. The Logic column's per-part highlighting (`explainLogic`) still runs in TypeScript, fed by the blank-field set Python returns and `rememberBlankFields` records against the result map; without it, reads of hidden fields would not come out blank there.
- **Clock.** What `"today"` means in logic is injected: `WhatIfContext.today` / `Context(today=…)` / `"today"` in the engine's JSON context, as `YYYY-MM-DD` (year 1000–9999; anything else throws, never silently falls back). Left out, both engines use the system clock's local date, so a result then depends on when it is computed: pipelines must always pass it. The browser's Python wrapper passes the JavaScript local date itself, so Pyodide's time zone never matters.
- **Python parity.** The TypeScript engine is the reference. `test/pythonParity.test.ts` runs it over fixed conditions and what-if contexts and compares with the committed `python/tests/vectors.json`, which `python/tests/test_parity.py` replays against the port. After changing `logic.ts`, `whatIf.ts` or the model, regenerate with `EXPORT_PYTHON_VECTORS=1 npm test -- pythonParity` and fix the port until the Python tests pass. The port reproduces JavaScript behaviour on purpose (number-to-text, `Math.round`, `\s`, division by zero, `Date.UTC` roll-over); keep it that way.
- `src/components/*.tsx` – one component per tab/panel; `App.tsx` composes them. `src/main.tsx` is the entry point.
- **Pure views and connectors.** A component that needs app state is split in two: `XView.tsx` is a pure view (plain props, exported `XViewProps` type, callbacks named `onThing`, **no `../store` import**, local UI state only) and `X.tsx` is a thin connector that reads the store and renders `<XView …/>`. Parents import the connector. Connected widgets a view embeds (explore buttons, trace controls, a what-if badge) come in as `children` or render-prop slots, never as imports. A file holding several views of one component is named `XViews.tsx` (`DetailViews.tsx`, `WhatIfTabViews.tsx`); `GraphViewView.tsx` is the view of the `GraphView.tsx` connector. `test/viewsAreStoreFree.test.ts` fails if any view file reaches `src/store`, directly or through its imports. Test the view with plain props. Keep store reads and wiring in the connector, but put any derivation worth testing (filters, edge and row lookups) in `src/lib` as a pure function with a plain-node test: `detail.ts` (detail panel lookups), `tableFilters.ts` (Fields and Dependencies search), `whatIfRows.ts` (What if rows, chooser and filters). `App`, `Workspace` and `Sidebar` only compose, so they stay connected. Never destructure `props` (it breaks reactivity), and pass row accessors (not `row()`) to render-props so an update does not rebuild an input and drop its focus.
- GraphView helpers (no store, no Solid): `svgDom.ts` (reads the rendered SVG: node/edge keys, highlighting), `panzoom.ts` (pure pan/zoom maths), `hitTest.ts` (`resolveClick`: click target → selection action).
- `test/` – Vitest specs (`*.test.ts`) plus `fixtures.ts` (hand-written Graphviz/Mermaid-shaped SVG and View builders). Config is `vitest.config.ts`, separate from `vite.config.ts` so tests skip the Solid plugin; test files are type-checked by `npm run typecheck`.
- `public/sample/sample.xml` – sample project; `css/style.css` – all styles.

## Code style
- No abbreviations in function/method names (`applyHighlight`, not `applyHl`; `elementFor`, not `elFor`). Prefer full words for variables too; single-letter names are fine only for short-lived locals (`s`, `e`, `w`/`h`).
- Name anonymous functions and closures where it helps debugging (stack traces, profiler, Solid effects): assign to a named `const`, or use a named function expression, rather than inlining an arrow in a long-lived callback or listener.

## Gotchas
- **Solid 2.0.3**, not Solid 1: APIs differ from most training data and online examples (compiled with `@solidjs/vite-plugin`, not `vite-plugin-solid`; `@solidjs/web` for DOM). Check `node_modules/solid-js` / `@solidjs/web` types before assuming an API exists.
- Don't pull Solid into `src/lib/`; keep parsing/graph logic pure so it can be run with plain node.
- REDCap variable names never contain hyphens, so `[event-name]`-style smart variables are deliberately skipped by the reference extractor.
- Graph is rendered to SVG asynchronously (Graphviz via `@viz-js/viz`, or Mermaid); `svgView` records which view the current SVG came from, since `view()` can be newer. Large graphs are guarded by `MAX_AUTO_EDGES`.

## Data / privacy
- `real-projects/` holds real REDCap exports. It is gitignored: never commit, quote or copy its contents elsewhere. Use `public/sample/sample.xml` for examples and fixtures.
- `.claude/` and `dist/` are also gitignored.

## Git
- Work on feature branches off `main`; small, descriptive commit messages in the imperative (see `git log`).
