# Plan: automated proof of layout-engine parity and focus-preserving switching

## Context
Four renderers (graphviz, mermaid, elk, swimlane) draw through one stage (`GraphViewView`). Parity has been checked by hand through browser subagents. Goal: "all existing functionality in every engine, and switching engines never loses focus", proven by tests that run in CI-like conditions.

## Probed facts (they shape the plan)
- `@viz-js/viz` runs fine in Vitest/jsdom (`renderDot` returned a real SVG with `g.node` elements). So **graphviz, elk and swimlane can all be exercised for real in jsdom**, with no mocks.
- **Mermaid cannot render in jsdom** (`getBBox is not a function`). Mermaid is the only engine that needs a real browser (layer C) or hand-built fixtures (`test/fixtures.ts` already has Mermaid-shaped SVG). Anything in layers A and B that involves Mermaid therefore uses the fixture (or a stubbed renderer returning it), never the real engine.
- Full suite is about 2.8 s today. Layers A and B should add about 10 s at most (see the runtime estimate for the caveats).
- No Playwright is installed.
- `GraphViewView` takes the svg, the drawn view, the selection and callbacks as plain props, so it is testable with any engine's SVG.
- jsdom has no layout, so `getBoundingClientRect` and `getBBox` return zeros. The anchor and screen-position logic needs faked rects (layer B, maths only) or a real browser (layer C, the real proof).

## Bigger test data (user request: base it on `real-projects/`)
`public/sample/sample.xml` is small (5 events, 4 forms, 69 fields, 33 KB), so layouts are trivial. I took **aggregate shape statistics only** from the two `real-projects/` exports (counts and ratios from a throwaway script; no names, labels, logic text or ids were read out or kept). The new data is fully synthetic, generated to those shapes, so nothing private is committed.

Shape targets (ratios taken from the real exports; the sample's are listed for comparison):

| Feature | Sample | Real A (large) | Real B (medium) | Synthetic "medium" target | Synthetic "large" target |
|---|---|---|---|---|---|
| Events / arms | 5 / 2 | 21 / 3 | 9 / 1 | 12 / 3 | 21 / 3 |
| Repeating events | 1 | 1 | 7 of 9 | 4 of 12 | 4 |
| Forms | 4 | 148 | 21 | 20 | 60 |
| Fields | 69 | 6563 | 446 | about 300 | about 1500 |
| Fields per form | median 10 | median 1, max 262 | median 1, max 34 | skewed: many 1-3 field forms, a few 30-60 | as medium, max about 120 |
| With branching logic | 23% | 36% | 26% | about 30% | about 30% |
| Cross-event refs | 2 | 1354 | 227 | about 60 | about 400 |
| Calc fields | 9 | 108 | 16 | about 15 | about 40 |
| Action tags | 30 | 1869 | 363 | about 60 | about 300 |
| Smart variables | 2 | 452 | 20 | about 15 | about 60 |
| Form display logic | 4 | 11 | 7 | 6 | 10 |
| Field types | mixed | radio, text, checkbox, descriptive, select dominate | text, descriptive, yesno dominate | the same mix as the real exports | same |

Deliverables:
- `test/fixtures/syntheticProject.ts`: a seeded, deterministic `buildSyntheticOdm({ events, arms, forms, fields, ... })` that writes ODM XML with generic names (`form_07`, `visit_03_arm_2`, `field_0142`). It exercises every dependency kind: branching, calcs, piping, action tags, smart variables, cross-event references, repeating events and forms, and form display logic. Same approach as `largeGraphGuard.test.ts`'s `buildProject`, which should be folded into it (as its own small commit, since it touches an existing passing test).
- `public/sample/sample-large.xml`: the "medium" project written out once by the generator (committed, roughly 300 KB, generated rather than hand-written, with a header comment naming the generator and seed). Used by Playwright and by the "Load sample" dropdown if wanted. The "large" variant is generated in memory only, for the guard and for an engine stress test.
- A guard test, `syntheticShape.test.ts`: the generator's output stays within about ±15% of the target ratios, and the medium project stays under `MAX_AUTO_EDGES` at form level but still exercises field-level views on filtered or focused sub-views (the whole field graph is expected to exceed the guard, which is itself realistic).
- Layer A's `CONFIGS` always run on the old sample (fast, small). They run on the synthetic medium project for a **subset** of configs only (one per level kind), to keep `npm test` fast. Per-engine layout time on the medium project is recorded and checked against a generous budget (for example 15 s, set via an explicit `testTimeout`) or reported without gating, because shared CI runners make tight timing assertions flaky. The large variant is used only for the guard and a single stress layout.

Privacy: never paste `real-projects/` content into tests, notes or messages. The stats script lived only in the scratchpad and printed counts.

## Design: one engine-neutral harness
New `test/engines/harness.ts`. It is built **after** the `renderEngine` extraction (M1, below), so the harness and the store share one render path instead of duplicating the engine ternary.

- `loadProjectIntoStore(source)`: loads `sample.xml` or the synthetic medium project via `?raw`/the generator, as `store.test.ts` does.
- `drawWithEngine(engine, view, options, events, dotSource)` returns `Promise<SVGSVGElement>` by calling `renderEngine`:
  - graphviz, elk and swimlane: real rendering in jsdom.
  - mermaid: not drawable here. Layers A and B use the fixture SVG; C covers the real thing.
- `CONFIGS`: the level matrix, built by driving the real store setters and reading `store.view()` and `store.opts()`.
  - field × groupBy (form, event, arm, none)
  - form
  - form + Instances
  - event
  - event "into forms"
  - form instance "into fields"
  - a selected-and-focused variant of each
- `elementsByKey(svg)`: `{nodes: Map<key, Element>, edges: Map, clusters: Map}` built with the real `svgDom` readers.
- `KNOWN_DIFFERENCES`: a named, reviewed table of the expected differences between engines (see below).

Code-style note: no abbreviations, and name the closures.

### `KNOWN_DIFFERENCES` mechanism
Parity tests do **not** assert "identical in every engine". They compare each engine against a **reference engine (elk)** and subtract the entries in `KNOWN_DIFFERENCES`:
- Each entry names the engine, the config (or `*`), the behaviour (for example "edge label element absent", "cluster for X not drawn") and a one-line reason.
- An observed difference that is not listed fails the test. A listed difference that no longer occurs also fails, so the table cannot go stale.
- Graphviz and Mermaid (the external engines) are expected to have entries; elk and swimlane are expected to have few or none.
- The initial list is **not guessed**: it is written at the end of M1, from the real gaps the contract and click tests surface. Each gap is either fixed or listed.
- Mermaid entries can only be checked in layer C, so the stale-entry check for Mermaid lives there. Until layer C is a required CI check, Mermaid entries are provisional and flagged as such in the table.

## Layer A: pure engine-contract tests (Vitest, `test/engines/*.test.ts`)
Run each config on graphviz, elk and swimlane (swimlane only where `effectiveRenderer` says it applies; otherwise assert it falls back to elk).

| File | Asserts (per config × engine) |
|---|---|
| `contract.test.ts` | Every `view.nodes[i]` has exactly one `g.node` with `nodeKey === 'n'+i`. Every view edge has exactly one element with `edgeKey` equal to its pair. Every `view.groups[i]` has exactly one `g.cluster` with `clusterIndex === i`. No extra keyed elements. `normalizeSvg` yields positive `data-w` and `data-h`. Edge label text is present when `edgeLabels` is on and absent when off. Node text follows `labelMode`. Differences from the reference engine are subtracted via `KNOWN_DIFFERENCES`. |
| `clickParity.test.ts` | For every node, edge and cluster, `resolveClick(element, view, isForm)` returns the same `ClickAction` as the reference engine (modulo `KNOWN_DIFFERENCES`). Background maps to `clear` and edge labels to `none`. |
| `highlightParity.test.ts` | `highlightLinks(svg, key)` marks the same set of edge keys `on`, and the node `hl`, as the reference engine. `highlightCluster` marks the same cluster for the same selection. |
| `directionParity.test.ts` | LR and TD produce a valid contract. Swimlane and ELK are measurably wider or taller, as expected. |
| `engineSwitch.store.test.ts` | Extends `store.test.ts`. After `await` of the render effect for each **jsdom-renderable engine** (graphviz, elk, swimlane), `svgView()` equals `view()`. For every focus kind (field, form, event, instance, expanded event, expanded instance) cycling those engines keeps `selection`, the Detail target, the view node-id set, `instances`, level and `expanded*` unchanged. Mermaid is included by **stubbing the Mermaid renderer to return the fixture SVG**, so the state-preservation half of the switch is covered for Mermaid pairs too; the on-screen position half is layer C only. `effectiveRenderer` falls back correctly. Console is spied and must see zero errors/warnings (filtering known jsdom noise explicitly, not by loosening the check). |
| `downloads.test.ts` | `downloadSvg` with the real `svgEl` per jsdom-renderable engine gives a non-empty string that reparses as an SVG with the contract nodes. CSV, DOT and Mermaid downloads are non-empty and independent of the engine. The `download` module is mocked as `store.test.ts` does. |

Mermaid in A: no real SVG. `mermaidSrc()` is asserted to declare every `n<i>` and edge of the view. This is a **stopgap only**, not Mermaid contract coverage: it checks the source text, not what Mermaid draws. The SVG shape is covered by the fixture in B and the real thing in C.

Estimated runtime: about 4-6 s on the sample (viz WASM init once, elk about 1 s per config × about 12 configs), plus a subset of configs on the medium project (see the runtime estimate).

## Layer B: component and controller tests (jsdom, `test/engines/*.test.tsx`)
Mount `GraphViewView` with each engine's real SVG from the harness (Mermaid: the fixture), using `renderComponent`/`tick`.

- Hover a node: `hl` on it and `on` on its links. Leave the node: cleared (every engine, plus the Mermaid fixture).
- Click node, edge or cluster calls `onClickAction` with the `resolveClick` action. Selection prop change re-applies the `on`/`hl` classes, including the expanded box getting `on`.
- Drag guard: mousedown, five moves, then click means no `onClickAction`. A click with no moves does fire.
- Zoom +/−/Fit and wheel change the canvas `transform`. Fit centres using the svg `data-w` and `data-h` (rects faked via `stage.clientWidth` stubs).
- `anchor` controller: extend `anchor.test.ts` with a table of engines. For each, `capture(selectedKey)` then swap in a new SVG whose target node is at a different position. **The faked `getBoundingClientRect` must be derived from the canvas transform and the node's position in the SVG**, not hard-coded, otherwise the test only restates the maths it exercises. `restoreOrFit` must put the node's screen centre within 1 px of the capture. This proves the *maths* works with the swimlane and ELK key structure; it does **not** prove real on-screen behaviour, which is layer C's job.
- Legend, counts bar and "Render anyway": extend the existing views tests with a per-engine loop only where the view reads engine-specific data. Otherwise they are engine-independent and need no new work.

Estimated runtime: about 2-3 s.

## Layer C: real-browser smoke (the only way to get Mermaid and true geometry)
**Playwright (`@playwright/test`) as a devDependency, approved**, with its own script, not part of `npm test`. Vitest browser mode was considered and rejected as having the same install cost with less cross-browser tooling.

- Cost: one devDependency (about 5 MB) plus browser downloads (see "Cross-browser testing"), and a `webServer` config entry. Sequential per browser, about 40-60 s on chromium.
- Separate from `npm test`: `npm run test:e2e`, with `playwright.config.ts` and `e2e/` outside the Vitest `include` (already limited to `test/`).
- **Roll out chromium first.** Firefox and WebKit are added once the chromium specs are stable, so their tolerances and reduced subset are decided with real flake data.

Specs (`e2e/switch.spec.ts`, `e2e/mermaid.spec.ts`, `e2e/pointer.spec.ts`):
1. For each engine × config: no `console.error`, nodes visible, node count equals the view's count shown in the counts bar.
2. Focus-preserving switch: select a node (and, in a second pass, an expanded form), record its bounding-box centre, switch through all 12 ordered engine pairs, and assert the centre is within 2 px, the `.on` class is still set, Detail text is unchanged, and Instances/Level controls are unchanged.
3. Mermaid: contract plus click and hover parity (Mermaid ids `flowchart-n3-12`, `L-n1-n2`), then the same screen-position check. **Includes a check that the real Mermaid DOM's id patterns match what `svgDom` and the layer A/B fixture assume**, so a Mermaid upgrade that changes ids (or a drifting fixture) fails here.
4. Real pointer: wheel zoom, drag-pan, and a click directly after a drag selects nothing.
5. Downloads: `page.waitForEvent('download')` for SVG, CSV, DOT and Mermaid; the file is non-empty and, for SVG, reparses with the contract.
6. Other tabs (Fields, Dependencies, Matrix, What if, Analysis) render after switching engine, and returning to Graph refits.
7. Large-graph guard in one engine (synthetic project loaded from a file), then "Render anyway" (the rest stays in `largeGraphGuard.test.ts`).
8. `KNOWN_DIFFERENCES` Mermaid entries asserted both ways (unlisted difference fails, vanished entry fails).

## Production-code refactors needed
- **Extract `renderGraph`'s engine switch into `renderers.ts` as `renderEngine(name, input)`** (approved, done first in M1, before the harness). Pure move, so the harness and the store share one code path rather than duplicating the ternary. Risk: low, covered by `largeGraphGuard` and store tests.
- Playwright reads classes and DOM only; no test hook (`?e2e`) is added. `data-testid`s are added only if class selectors prove brittle (not expected).

## Milestones
Ordered by value: the cheapest, highest-value proof comes first. Estimates are rough and M1 is likely to surface parity gaps that become fix tasks.
1. **M1** `renderEngine` extraction, harness, `KNOWN_DIFFERENCES` skeleton, `contract.test.ts` and `clickParity.test.ts` (A, graphviz/elk/swimlane, on `sample.xml`). Ends with the first real `KNOWN_DIFFERENCES` entries (fix or list each gap). About 1-2 days.
2. **M2** highlight, direction, store-switch (with the stubbed Mermaid renderer) and downloads tests (A).
3. **M3** layer B (component tests plus the anchor table with transform-derived rects).
4. **M4** Playwright setup, **chromium only**: switch spec, then Mermaid (including the id-pattern check and the Mermaid `KNOWN_DIFFERENCES` assertions), pointer and downloads specs.
5. **M0** (moved here) synthetic project generator, `sample-large.xml` and the shape test, then the medium-project subset in layer A, the timing budget, and the large-graph Playwright spec. About half a day, plus the separate commit folding `largeGraphGuard`'s `buildProject` in.
6. **M4b** add Firefox and WebKit to Playwright with the reduced subset and documented per-browser tolerances; `ci.yml` (unit job plus the three-browser e2e matrix), non-blocking first.
7. **M5** coverage matrix doc `test/engines/PARITY.md`, plus a small test that parses it and fails if any referenced test file or test title does not exist (so the hand-kept table cannot go stale).

## Coverage matrix (checklist item → layer; G=graphviz, M=mermaid, E=elk, S=swimlane)
| # | Behaviour | G, E, S | M |
|---|---|---|---|
| 1 | Renders, no console errors | A (store/console spy) + C | A (stubbed, state only) + C |
| 2 | Node click/hover, `on`/`hl` | A (click, highlight) + B | B (fixture) + C |
| 3 | Edge and cluster click | A clickParity | A (fixture) + C |
| 4 | Detail actions, expanded box `on` | A (store switch) + B | C |
| 5 | Downloads | A (SVG, CSV, DOT) + C | C |
| 6 | Pan/zoom/Fit/drag guard | B (logic) + C (real pointer) | C |
| 7 | Switch keeps state | A (state) + B (anchor maths) + C (on-screen position) | A (stubbed state) + C |
| 8 | Legend, counts, labels, text mode, direction | A + B | C |
| 9 | Other tabs after switching | C | C |
| 10 | Large-graph guard | existing `largeGraphGuard.test.ts` | same |

All levels (field × 4 groupings, form, Instances, event, event into forms, instance into fields) are included in A; C runs a representative subset (field/form grouping, form+Instances, event into forms) for speed.

## Runtime estimate
- A about 5 s on the sample, B about 3 s. The medium-project subset adds a few more seconds; the large stress layout is the outlier. `npm test` should stay in the region of 15-20 s, and the long tests carry an explicit `testTimeout`.
- C about 1 min on chromium and about 2 min each on firefox and webkit, plus a cached browser install; the three run in parallel in CI.

## Remains manual
- Visual quality (overlapping labels, aesthetics, edge routing looking right). Tests check structure, keys and positions, not taste.
- Performance on large real projects (`real-projects/` is off-limits to tests).
- Real Safari on macOS/iOS (WebKit in Playwright is only a proxy), and mobile/touch.

## Acceptance criteria: "parity proven"
1. For every config in `CONFIGS`, every jsdom-renderable engine exposes exactly one element per view node, edge and group with the right key (zero missing, zero extras), modulo `KNOWN_DIFFERENCES`. Mermaid is proven the same way in layer C.
2. `resolveClick` yields identical actions for the same logical element across engines, and the same edges/clusters are highlighted for the same hover and selection (reference engine: elk; modulo `KNOWN_DIFFERENCES`).
3. Cycling engine pairs for each focus kind leaves selection, Detail target, node-id set, Instances, level and expansions unchanged, with no console errors. In jsdom this covers all pairs among graphviz, elk and swimlane, plus Mermaid pairs via the stubbed renderer (state only). The real Mermaid renderer is covered by criterion 4.
4. In the real browser (chromium first; firefox and webkit once added), the selected node's screen centre moves by at most the browser's tolerance (2 px; at most 4 px if documented) across all 12 ordered engine pairs, including to and from Mermaid.
5. SVG, CSV, DOT and Mermaid downloads are non-empty for every engine; the SVG download reparses.
6. Drag-then-click selects nothing, and wheel zoom, button zoom and Fit work, in every engine.
7. Every expected difference of the external engines is listed in `KNOWN_DIFFERENCES` and asserted both ways (an unlisted difference fails, and a listed one that disappears fails).
8. Any parity gap found is either fixed or listed as a known, documented difference that the test explicitly asserts.
9. `npm run typecheck`, `npm test` and `npm run test:e2e` are all green, and `PARITY.md` maps every checklist item to a passing test (checked by a test).
10. The new `ci.yml` runs the unit job and the e2e matrix on PRs and `main`. On the introducing PR the unit job is green and the e2e job runs in report-only mode (it becomes required after it has proved stable).

## Decisions from the user (settled)
- A committed generated `public/sample/sample-large.xml` is fine.
- Playwright as a devDependency is fine.
- A small layout tolerance is fine (start at 2 px; Firefox and WebKit may need a documented per-browser value of at most 4 px).
- Engine differences: for the external engines (graphviz and mermaid), assert the expected differences explicitly rather than treat them as failures, via the named `KNOWN_DIFFERENCES` table in the harness (mechanism above).
- Extract `renderEngine` in `renderers.ts` (now in scope, M1).
- CI is GitHub Actions deploying to GitHub Pages (`.github/workflows/deploy-pages.yml` exists: type-check, `npm test`, build, deploy on push to `main`).

## Known engine differences

Listed in `KNOWN_DIFFERENCES` (`test/engines/harness.ts`); the contract test fails on an unlisted difference and on a stale entry.

- **Event and arm groups have no `g.cluster` in the Swimlane engine** (`contract: missing cluster`: field level grouped by event or arm, form level with Instances, form instance into fields). Swimlane draws an event as a column and an arm as a lane (`g.region`), where Graphviz, Mermaid and ELK draw a cluster box.
  Acceptable because these groups are `noSelect`: nothing clicks or highlights them, so no behaviour (click resolution, `highlightCluster`, anchor/zoom to a cluster) is lost, and the column or lane is the visible grouping.
  Stops being acceptable if such a group becomes selectable, highlightable or an anchor/zoom target (its `noSelect` removed), or if code starts to look up its `g.cluster`. Then it needs a keyed element (an expanded event's column already is a keyed `g.cluster`) and the entry must go.
- Fixed, no longer a difference: a form whose fields sit in several event columns is one `g.cluster` (first box) plus `g.cluster-part` boxes, so there is one `g.cluster` per group; `highlightCluster` and `resolveClick` treat all parts as the group.

## Cross-browser testing (user request)
Playwright projects: **chromium, firefox, webkit** (WebKit approximates Safari; no real Safari on Linux runners). Mermaid and the graph geometry (`getBBox`, pointer events, wheel, downloads) differ across engines, so layer C runs in all three. Chromium lands first (M4); the other two follow in M4b.

- Config: `playwright.config.ts` with the projects, a shared `webServer` (`npm run build && npm run preview`, so tests hit the production bundle that Pages will serve, with the Pages `BASE_PATH` honoured via an env var, rather than the dev server), `workers: 1` in CI, `retries: 1` in CI, traces on first retry.
- Per-browser handling: the position tolerance and any browser-specific timing live in one `browserProfile` helper. WebKit and Firefox download and wheel semantics are normalised by the helpers, not scattered in specs.
- Scope per browser: the full switch matrix on chromium; firefox and webkit run the same specs but on the representative subset (field/form grouping, form+Instances, event into forms) to keep time down. Mermaid parity and the pointer and download specs run in all three.
- Runtime: about 1 min on chromium, about 2 min each on firefox and webkit; the projects run as parallel matrix jobs in CI, so wall-clock is about 3 min.
- Cost: `npx playwright install --with-deps <browser>` on `ubuntu-latest` (about 400 MB total across the three), cached by Playwright version.
- Layer A/B (jsdom) still tests engine-independent logic once; what differs per browser is only rendering geometry and events, which is exactly what C covers.
- Mobile/touch emulation: out of scope for now (`pan` is mouse-only today); can add the `Mobile Safari` device profile later.

## CI integration (GitHub Actions)
A new workflow `.github/workflows/ci.yml`, kept separate from `deploy-pages.yml` so deployment does not wait on browser jobs unless wanted:
- Triggers: `pull_request` and `push` to `main`, plus `workflow_dispatch`.
- Job `unit`: `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run build` (Vitest layers A and B). Same pinned action SHAs and `permissions: contents: read` style as the existing workflows.
- Job `e2e` with a matrix `browser: [chromium, firefox, webkit]`: install that browser only, run `npx playwright test --project=${{ matrix.browser }}`, upload the Playwright report and traces as an artifact on failure. `npm ci --ignore-scripts` is kept; Playwright's browser install is an explicit step, so no lifecycle scripts are needed.
- Gating the deploy: `deploy-pages.yml` already runs typecheck and tests, so the e2e job stays non-blocking at first and is made required once it has proved stable for a couple of weeks.
- The `lint.yml` actionlint job already covers workflow edits, so the new workflow is linted automatically.
- Pin all new actions by commit SHA with a version comment, as the existing files do; `actions/cache` for the Playwright browsers.

## Working assumptions (provisional, confirm or change)
These were open questions; the plan proceeds on the recommended answers.
1. The Playwright e2e job starts **non-blocking** and becomes required after it has proved stable. Confirm.
2. **WebKit as the Safari proxy** is acceptable, with real Safari checked by hand before releases. Confirm.
3. **Firefox and WebKit run the reduced config subset**, with the full matrix on chromium only. Confirm.

## Verification of this plan once implemented
`npm run typecheck && npm test && npm run build`, then `npm run test:e2e`. Then run a repeatable **mutation check**, once per layer, confirming each layer goes red on its own:
- Layer A: drop a `data-key` in `layoutToSvg.ts` (breaks swimlane and elk contract).
- Layer B: break the anchor restore (for example skip the capture) and confirm the anchor table fails.
- Layer C: change a Mermaid id pattern the parser relies on, or drop the key in one engine, and confirm the browser specs fail.
- `KNOWN_DIFFERENCES`: remove one listed entry (unlisted difference fails) and add a bogus one (stale entry fails).
