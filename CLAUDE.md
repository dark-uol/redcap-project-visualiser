# REDCap dependency graph

Client-only SolidJS 2 + Vite app. Loads a REDCap CDISC ODM metadata XML and draws field/form/event dependencies (branching logic, calcs, piping, action tags, form display logic). See README.md for user-facing usage.

## Commands
- `npm run dev` – dev server, http://localhost:5173 (HMR; use the `dev` entry in `.claude/launch.json` with preview tools).
- `npm run build` – production build to `dist/`. Vite does not type-check, so also run `npm run typecheck` (`tsc --noEmit`). There is **no linter**. `npm test` runs Vitest (jsdom) over `test/`, covering the pan/zoom maths, SVG helpers and click resolution of the graph view. Solid components and `src/lib/` are not covered yet. Run typecheck, build and tests after changes, then verify UI changes in the browser (click "Load sample").
- `file://` does not work; always serve over http.

## Layout
- The source is TypeScript (`strict`, `verbatimModuleSyntax`); JSX is Solid's (`jsxImportSource: @solidjs/web`).
- `src/store/` – all app state, created once in `index.ts` under one `createRoot`; components import from `src/store`. `state.ts` holds the signals, `derived.ts` the memos, `exploration.ts` and `rendering.ts` the expansion and graph-render effects, `navigation.ts` the history, `loading.ts` and `downloads.ts` the actions, `common.ts` the shared constants and helpers. Add new UI state to `state.ts`. Related signals are grouped as `filters`, `focusing`, `presentation`, `selection` (read them as e.g. `filters.typesOn()`).
- `src/lib/` – framework-free modules, no Solid imports: `types.ts` (shared domain types: parsed metadata, model, view), `parser.ts` (XML → fields/forms/events), `graph.ts` (model, cycle/depth/hub analysis, `buildView`), `exporters.ts` (Mermaid/DOT/CSV), `renderers.ts` (lazy-loads viz + mermaid), `download.ts`.
- `src/components/*.tsx` – one component per tab/panel; `App.tsx` composes them. `src/main.tsx` is the entry point.
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
