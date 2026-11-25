import { For } from 'solid-js';
import type { Layout, LayoutEdge, LayoutNode, LayoutRegion } from '../lib/layout';

export interface LayoutSvgViewProps {
  layout: Layout;
  nodeLabel: (id: string) => string;
  nodeSublabel?: (id: string) => string;
  /** The selected node id, or null. */
  selected: string | null;
  selectedEdge: { from: string; to: string } | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (from: string, to: string) => void;
  onClear: () => void;
}

let instanceCounter = 0;
/* The graph stage is white in both themes (like the Graphviz output), so the palette is fixed rather than themed. */
const BACKWARD_COLOUR = '#c0392b';
const LINE_COLOUR = '#64748b';
const REGION_FILL = '#f1f5f9';
const REGION_LINE = '#cbd5e1';
const TEXT_COLOUR = '#1f2937';
const MUTED_COLOUR = '#64748b';
const NODE_FILL = '#ffffff';
const ACCENT_COLOUR = '#2563eb';
const LANE_LABEL_WIDTH = 110;
const DIMMED_OPACITY = 0.25;
const NODE_TEXT_PADDING = 12;
/** Rough average glyph width at the node label's font size; used only to truncate. */
const NODE_CHARACTER_WIDTH = 6.5;

/** `text` cut to fit a box `widthPixels` wide, ending in an ellipsis when it is shortened. */
export function truncateLabel(text: string, widthPixels: number): string {
  const maxCharacters = Math.max(1, Math.floor((widthPixels - NODE_TEXT_PADDING) / NODE_CHARACTER_WIDTH));
  return text.length <= maxCharacters ? text : text.slice(0, maxCharacters - 1) + '…';
}

/** Whether `id` is directly linked to `selected` by an edge in either direction. */
function isLinkedToSelection(layout: Layout, selected: string, id: string): boolean {
  return layout.edges.some((edge) => (edge.from === selected && edge.to === id) || (edge.to === selected && edge.from === id));
}

/** 'on' for the selected node and its direct neighbours, 'dim' for the rest, '' when nothing is selected. */
function nodeState(props: LayoutSvgViewProps, id: string): 'on' | 'dim' | '' {
  const selected = props.selected;
  if (selected === null) return '';
  return id === selected || isLinkedToSelection(props.layout, selected, id) ? 'on' : 'dim';
}

/** Edges touching the selected node are 'on', the selected edge is 'selected', and the other edges are 'dim' while a node is selected. */
function edgeClass(props: LayoutSvgViewProps, edge: LayoutEdge): string {
  const classes = ['edge'];
  const selectedEdge = props.selectedEdge;
  const selected = props.selected;
  if (selectedEdge !== null && selectedEdge.from === edge.from && selectedEdge.to === edge.to) classes.push('selected');
  if (selected !== null) classes.push(edge.from === selected || edge.to === selected ? 'on' : 'dim');
  return classes.join(' ');
}

function edgeDimmed(props: LayoutSvgViewProps, edge: LayoutEdge): boolean {
  return props.selected !== null && edge.from !== props.selected && edge.to !== props.selected;
}

function curveData(edge: LayoutEdge): string {
  const [start, controlA, controlB, end] = edge.curve;
  return `M${start.x} ${start.y} C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${end.x} ${end.y}`;
}

/** A column's label, with a repeat mark when the event repeats. */
function columnTitle(region: LayoutRegion): string {
  return region.repeating ? `${region.label} ↻` : region.label;
}

/** Presentational: draws a positioned layout (regions, edges, nodes) as one SVG and highlights the selection. */
export function LayoutSvgView(props: LayoutSvgViewProps) {
  // Marker ids are document-global, so each instance gets its own pair.
  instanceCounter += 1;
  const ARROW_ID = `layout-arrow-${instanceCounter}`;
  const ARROW_BACKWARD_ID = `layout-arrow-backward-${instanceCounter}`;
  return (
    <svg
      viewBox={`0 0 ${props.layout.width} ${props.layout.height}`}
      width={props.layout.width}
      height={props.layout.height}
      onClick={() => props.onClear()}
    >
      <defs>
        <marker id={ARROW_ID} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={LINE_COLOUR} />
        </marker>
        <marker id={ARROW_BACKWARD_ID} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={BACKWARD_COLOUR} />
        </marker>
      </defs>

      <For each={props.layout.regions}>
        {(region) =>
          region.kind === 'lane' ? (
            <g class="region lane" data-region-id={region.id}>
              <rect x={region.x} y={region.y} width={region.width} height={region.height} fill={REGION_FILL} />
              <text x={region.x + 8} y={region.y + 16} font-size="12" font-weight="600" fill={MUTED_COLOUR}>{truncateLabel(region.label, LANE_LABEL_WIDTH)}</text>
            </g>
          ) : (
            <g class="region column" data-region-id={region.id}>
              <rect x={region.x} y={region.y} width={region.width} height={region.height} fill="none" stroke={REGION_LINE} stroke-dasharray={region.repeating ? '4 3' : undefined} />
              <text x={region.x + region.width / 2} y={region.y + 16} text-anchor="middle" font-size="12" font-weight="600" fill={TEXT_COLOUR}>{columnTitle(region)}</text>
              <text x={region.x + region.width / 2} y={region.y + 30} text-anchor="middle" font-size="11" fill={MUTED_COLOUR}>{region.sublabel ?? ''}</text>
            </g>
          )
        }
      </For>

      <For each={props.layout.edges}>
        {(edge) => (
          <g class={edgeClass(props, edge)} data-from={edge.from} data-to={edge.to} opacity={edgeDimmed(props, edge) ? DIMMED_OPACITY : 1}>
            <path
              d={curveData(edge)}
              fill="none"
              stroke={edge.backward ? BACKWARD_COLOUR : LINE_COLOUR}
              stroke-width="1.5"
              stroke-dasharray={edge.backward ? '6 4' : undefined}
              marker-end={edge.backward ? `url(#${ARROW_BACKWARD_ID})` : `url(#${ARROW_ID})`}
              class={edge.backward ? 'backward' : undefined}
            />
            <path
              class="hit"
              d={curveData(edge)}
              fill="none"
              stroke="transparent"
              stroke-width="14"
              pointer-events="stroke"
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                props.onSelectEdge(edge.from, edge.to);
              }}
            />
          </g>
        )}
      </For>

      <For each={props.layout.nodes}>
        {(node: LayoutNode) => {
          const state = () => nodeState(props, node.id);
          const sublabel = () => props.nodeSublabel?.(node.id);
          return (
            <g
              class={`node ${state()}`.trim()}
              data-node-id={node.id}
              opacity={state() === 'dim' ? DIMMED_OPACITY : 1}
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                props.onSelectNode(node.id);
              }}
            >
              <title>{props.nodeLabel(node.id)}</title>
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx="4"
                fill={NODE_FILL}
                stroke={state() === 'on' ? ACCENT_COLOUR : LINE_COLOUR}
                stroke-width={state() === 'on' ? 2 : 1}
              />
              <text
                x={node.x + 8}
                y={node.y + node.height / 2 + (sublabel() ? -2 : 4)}
                font-size="12"
                fill={TEXT_COLOUR}
              >
                {truncateLabel(props.nodeLabel(node.id), node.width)}
              </text>
              {sublabel() ? (
                <text x={node.x + 8} y={node.y + node.height / 2 + 11} font-size="10" fill={MUTED_COLOUR}>
                  {truncateLabel(sublabel() ?? '', node.width)}
                </text>
              ) : null}
            </g>
          );
        }}
      </For>
    </svg>
  );
}
