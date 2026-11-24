# REDCap dependency graph

Client-only SolidJS 2 + Vite app. Loads a REDCap CDISC ODM metadata XML and draws field/form/event dependencies (branching logic, calcs, piping, action tags, form display logic). See README.md for user-facing usage.

## Commands
- `npm run dev` – dev server, http://localhost:5173 (HMR; use the `dev` entry in `.claude/launch.json` with preview tools).
- `npm run build` – production build to `dist/`. This is the only automated check: there are **no tests and no linter**, so run it after changes, then verify UI changes in the browser (click "Load sample").
- `file://` does not work; always serve over http.

## Layout
- `src/store.js` – all app state (signals/memos, graph-render effect, actions) in one `createRoot`; components import from it. Add new UI state here.
- `src/lib/` – framework-free modules, no Solid imports: `parser.js` (XML → fields/forms/events), `graph.js` (model, cycle/depth/hub analysis, `buildView`), `exporters.js` (Mermaid/DOT/CSV), `renderers.js` (lazy-loads viz + mermaid), `download.js`.
- `src/components/*.jsx` – one component per tab/panel; `App.jsx` composes them.
- `public/sample/sample.xml` – sample project; `css/style.css` – all styles.

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
