# REDCap dependency graph

A SolidJS 2 + Vite app that draws the field, form and event dependencies of a REDCap project.

```
npm install
npm run dev      # dev server with hot reload (http://localhost:5173)
npm run build    # production build into dist/
```

One-time setup per clone: `git config core.hooksPath .githooks`. The pre-commit hook runs the typecheck (plus actionlint and zizmor when workflow files are staged); pre-push runs the tests, a build and an online zizmor audit. Needs `actionlint` (`brew install actionlint`) and `uvx` (`brew install uv`) for the workflow checks.

Opening `index.html` directly via `file://` is no longer supported: the app is built with Vite and needs to be served over http (`npm run dev`, or `npm run preview` / any static server pointed at `dist/`).

1. Export from REDCap: *Project Setup → Other Functionality → Download metadata only (XML)* (CDISC ODM).
2. Open/drop the XML (or click **Load sample**).
3. Explore the graph (Graphviz or Mermaid renderer), Matrix, Analysis, Dependencies and Fields tabs.
4. Download Mermaid (`.mmd`), Graphviz (`.dot`), SVG or a CSV of dependencies.

Dependencies detected: branching logic, calculated fields, piping in labels/notes/headers, action tags (`@CALCTEXT`, `@DEFAULT`, `@IF`…).

## Project layout
- `src/main.tsx` – entry point; `src/store/` – app state (signals, memos, graph-render effect, actions), entry `index.ts`.
- `src/components/` – Solid components (Toolbar, FileDrop, Sidebar, Workspace, GraphView, Detail, MatrixTab, AnalysisTab, DepsTab, FieldsTab, Legend, DownloadMenu).
- `src/lib/` – framework-free TypeScript modules: `parser.ts`, `graph.ts`, `exporters.ts`, plus `renderers.ts` (lazy-loads `@viz-js/viz` and `mermaid`).
- `public/sample/sample.xml` – the sample project; `css/style.css` – styles.
- `solid-js` is pinned to 2.0.3 and compiled with `@solidjs/vite-plugin` (the Solid 2 successor of `vite-plugin-solid`, which only supports Solid 1.x).
