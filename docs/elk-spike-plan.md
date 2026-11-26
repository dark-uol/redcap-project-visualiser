# ELK layout spike: plan

Goal: produce the same `Layout` (`src/lib/layout.ts`) from elkjs, so `LayoutSvgView` can draw it and we can compare it with the custom swimlane layout on the sample project. Success = an `elk` renderer option that draws the form-level graph (instances or not) with id-keyed SVG, selection and pan/zoom working, no SVG scraping.

## Decisions to settle first (spike, then decide)

1. **Edge geometry.** ELK returns orthogonal or polyline routes (`startPoint`, `bendPoints`, `endPoint`), not cubic Beziers. `LayoutEdge.curve` is a fixed 4-point Bezier. Plan: add an optional `points: Point[]` polyline to `LayoutEdge` (keep `curve` for the swimlane layout) and have `LayoutSvgView` draw `points` with `M … L …` (optionally rounded corners). Make `curve` and `points` a discriminated union rather than two optionals if it stays clean.
2. **Swimlanes in ELK.** ELK has no lane concept. Use `elk.algorithm: layered`, `elk.direction: RIGHT`, and `elk.partitioning.activate: true` with `elk.partitioning.partition` = the rank of the event's distinct day offset (equal days share a partition, as they share a column in the custom layout; fall back to event order within an arm when offsets are missing; "(no event)" nodes get an explicit partition). Event order alone would break the time axis across arms. Arm lanes are drawn afterwards as `regions` from the placed nodes' bounding boxes (y-extent per arm), not constrained by ELK. If lanes come out interleaved, fall back to one ELK run per arm stacked vertically.
3. **Non-instance views.** Form/field-level views have no events, so a plain layered layout with ELK groups (`ViewGroup` -> compound nodes) is the interesting case, and the one where ELK would replace Graphviz. Do the instance view first (shares the lane/column regions), then plain.
4. **Async.** `elk.layout()` returns a Promise. Check Solid 2.0.3 in `node_modules/solid-js` for the async memo / `createResource`-style API before writing the connector; do not assume the Solid 1 API. Keep `layoutElk` itself a pure async function in `src/lib/` (no Solid imports).
5. **Bundle.** Load `elkjs` with a dynamic `import()` (as `renderers.ts` does for viz and mermaid) so the main bundle does not grow. Prefer `elkjs/lib/elk.bundled.js` (runs in-thread, no worker URL config); consider the worker build only if layout blocks the UI.

## Steps

1. `npm i elkjs` (dependency, not dev). Confirm its bundled types cover `ElkNode`, `ElkExtendedEdge`.
2. `src/lib/layoutElk.ts`: `export async function layoutElk(view: View, events: EventDef[]): Promise<Layout>`.
   - Build the ELK graph: one child per `ViewNode` (fixed 120x28 as in the swimlane layout, so the two are comparable), one edge per `ViewEdge`, partition ids from event order.
   - Map the result back to `Layout`: nodes from child x/y, edges from sections, regions from bounding boxes.
   - Edge direction relative to time: set `backward` when the target's partition is earlier than the source's.
3. Extend `layout.ts` + `LayoutSvgView.tsx` for polyline edges (see decision 1); add view tests for the polyline path.
4. Add `'elk'` to `Renderer` (`types.ts`), the Renderer dropdown (`ViewSectionView.tsx`), and the early-return in `rendering.ts` / `derived.ts` (same pattern as `'swimlane'`).
5. Connector `ElkGraph.tsx` (or generalise `SwimlaneGraph.tsx` to take a layout accessor, which is probably better: one connector, `layout = swimlane | elk`). Reuse `PanZoomStageView`.
6. Tests: `layoutElk` runs in plain node (elkjs works there), so test mapping on a small view: every node placed, no overlaps, edges start and end on their nodes, backward flag set, partitions ordered left to right.
7. Compare on the sample project: count edge crossings and edge/node overlaps for swimlane vs ELK (a small script in `test/` or a one-off), plus screenshots.

## Out of scope for the spike

Exporters (unchanged; Mermaid and DOT export still read the `View`), field-level groups beyond what ELK compound nodes give for free, animation, edge labels.

## Risks

- Backward edges (later partition to earlier) may be handled badly by partitioning; the mapping test must include one.
- Rapid filter changes can resolve out of order: tag each layout with the view it came from and drop superseded results (as `svgView` does for Graphviz), and apply `MAX_AUTO_EDGES` to ELK too.
- ELK partitioning can ignore lane intent; we only draw lanes after the fact.
- Orthogonal routes may be noisier than the custom Beziers on small graphs; the comparison step is the point of the spike.
- Layout time on large graphs: measure on the largest project available (do not copy `real-projects/` contents anywhere).

## Known edge in the custom layout

The reciprocal-edge nudge only applies to the straight same-column candidate; a reciprocal pair with a node between them picks the same side bow both ways and overlaps.
