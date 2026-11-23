# REDCap dependency graph

Serve the folder with any static web server (no build step), e.g. `python3 -m http.server`, then open `index.html`.
Opening the file directly via file:// is no longer a supported requirement (it may still work, except “Load sample”, which fetches `sample/sample.xml`).

1. Export from REDCap: *Project Setup → Other Functionality → Download metadata only (XML)* (CDISC ODM).
2. Open/drop the XML (or click **Load sample**).
3. Explore the graph (Graphviz or Mermaid renderer), Analysis, Dependencies and Fields tabs.
4. Download Mermaid (`.mmd`), Graphviz (`.dot`), SVG or a CSV of dependencies.

Dependencies detected: branching logic, calculated fields, piping in labels/notes/headers, action tags (`@CALCTEXT`, `@DEFAULT`, `@IF`…).
Libraries load from jsDelivr, then unpkg, then the local `vendor/` copies. Mermaid/DOT downloads work even if no renderer loads.

## Implementation notes
- UI is SolidJS using `solid-js/html` tagged templates (no JSX, no build step needed to run).
- Solid loads from esm.sh via dynamic `import()` (works from file://); if that fails, `vendor/solid.iife.js` is used.
  That bundle is built from `build/solid-entry.js`:
  `npx esbuild build/solid-entry.js --bundle --format=iife --global-name=SolidBundle --minify --conditions=browser,production --define:process.env.NODE_ENV='"production"' --outfile=vendor/solid.iife.js` (with `solid-js@1.9.3` installed).
- `js/parser.js`, `graph.js`, `exporters.js` are framework-free; `js/app.js` is the Solid UI.
