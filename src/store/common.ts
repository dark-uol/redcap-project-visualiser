/* Constants, types and pure helpers shared by the store modules. No signals here. */
import { TYPES } from '../lib/graph';
import type { DepType, FormPair, Level, Renderer, View } from '../lib/types';

export const MAX_AUTO_EDGES = 700;
export const TYPE_KEYS = Object.keys(TYPES) as DepType[];
export const clampDepth = (v: unknown): number => Math.min(50, Math.max(1, Math.round(Number(v)) || 1));

export type Tab = 'graph' | 'matrix' | 'analysis' | 'deps' | 'fields';

/** Navigation state: tab, level, focus and selection. */
export interface Navigation {
  tab: Tab;
  level: Level;
  focus: string;
  pair: FormPair | null;
  selection: string | null;
  edge: FormPair | null;
}

/** Browser history entry: navigation plus the file sequence number. */
export type HistoryState = Navigation & { m: number };

/** Keeps zoom and the position of a node across re-renders; set by GraphView, null when unmounted. */
export type AnchorCapture = (nodeId: string, options?: { zoom?: boolean; back?: boolean }) => void;

/** Input to one graph render: the text to draw and the context it is drawn in. */
export interface RenderInput {
  source: string | null;
  rendererName: Renderer;
  tooBig: boolean;
  status: string;
  view: View | null;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The value, asserting it is present. Components only render once a project is loaded. */
export function need<T>(v: T | null | undefined): T {
  if (v == null) throw new Error('No project loaded');
  return v;
}

export const allTypesOn = (): Record<DepType, boolean> =>
  Object.fromEntries(TYPE_KEYS.map((k) => [k, true])) as Record<DepType, boolean>;
