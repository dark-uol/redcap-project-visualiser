/* Shared domain types: parsed REDCap metadata, the dependency model and the view the renderers consume. */

export type DepType = 'branching' | 'calc' | 'piping' | 'embedding' | 'actiontag' | 'formlogic' | 'logicsrc';
export type Level = 'field' | 'form' | 'event';
export type Direction = 'LR' | 'TD';
export type LabelMode = 'var' | 'label';
export type GroupBy = 'none' | 'form' | 'event' | 'arm';
export type FocusDir = 'both' | 'up' | 'down';
export type Renderer = 'graphviz' | 'mermaid' | 'swimlane';
/** 'up' / 'down' = field-level or instance references; 'fup' / 'fdown' = whole-form references. */
export type NeighborDir = 'up' | 'down' | 'fup' | 'fdown';
export type NodeKind = 'field' | 'calc' | 'form' | 'missing' | 'status' | 'logic';

export interface TypeMeta {
  label: string;
  color: string;
}

// ---------- parsed REDCap metadata ----------

export interface Choice {
  code: string;
  label: string;
}

export interface Media {
  inlineImage: string;
  videoUrl: string;
  videoInline: boolean;
}

export interface Field {
  variable: string;
  oid: string;
  type: string;
  label: string;
  section: string;
  note: string;
  branching: string;
  calc: string;
  annotation: string;
  required: boolean;
  choices: Choice[];
  media?: Media;
  form: string;
  /** REDCap's implicit `<form>_complete` status field. */
  synthetic?: boolean;
}

export interface Form {
  id: string;
  label: string;
  repeating: boolean;
  fields: string[];
}

export interface EventDef {
  id: string;
  label: string;
  arm: string;
  armName: string;
  repeating: boolean;
  /** Scheduled day of the event (redcap:DayOffset) and its visit window (days before / after), when the project defines them. */
  dayOffset?: number;
  offsetMin?: number;
  offsetMax?: number;
  forms: string[];
}

export interface Arm {
  num: string;
  name: string;
}

export interface RepeatingInstrument {
  form: string;
  event: string;
  label: string;
}

export interface FormEventRef {
  event: string;
  form: string;
}

export interface FormLogicRule {
  logic: string;
  forms: string[];
  formEvents?: FormEventRef[];
}

export interface LogicSource {
  id: string;
  kind: string;
  label: string;
  logic: string;
  refs: string[];
}

export interface ParsedODM {
  projectName: string;
  redcapVersion: string;
  forms: Form[];
  fields: Field[];
  formLogic: FormLogicRule[];
  logicSources: LogicSource[];
  events: EventDef[];
  arms: Arm[];
  repeatingInstruments: RepeatingInstrument[];
}

/** One `[name]`, `[name(code)]` or `[name:mod]` reference found in a logic string. */
export interface RefToken {
  name: string;
  code: string;
  mod: string;
  /** Another `[..]` follows immediately, so this token may be an event prefix (`[event][var]`). */
  adjNext: boolean;
}

/** One `{name}` or `{name:mod}` field embedding found in a label, note or section header. */
export interface EmbedToken {
  name: string;
  mod: string;
}

// ---------- dependency model ----------

export interface Edge {
  from: string;
  to: string;
  type: DepType;
  expr: string;
  cross: boolean;
  missing: boolean;
  events?: string[];
  smart?: string[];
  tgtAllEvents?: boolean;
  tgtEvents?: string[];
}

export interface GhostNode {
  variable: string;
  type: 'missing';
  label: string;
  form: string;
  ghost: true;
}

export interface FormNode {
  variable: string;
  type: 'formnode';
  label: string;
  form: string;
  formNode: true;
  logic: string[];
  logicEvents: string[][];
}

export interface LogicNode {
  variable: string;
  type: 'logicnode';
  label: string;
  form: string;
  logicNode: true;
  kind: string;
  logic: string;
}

/** Anything a dependency edge can point at: a real field, an undefined reference, a form display rule or a logic source. */
export type NodeInfo = Field | GhostNode | FormNode | LogicNode;

export interface Analysis {
  degree: Map<string, { in: number; out: number }>;
  isolated: string[];
  hubs: [string, number][];
  heavy: [string, number][];
  cycles: string[][];
  maxChain: number;
  missing: Edge[];
  crossForm: Edge[];
  forward: Edge[];
  out: Map<string, Edge[]>;
  inn: Map<string, Edge[]>;
}

export interface SelfRef {
  field: string;
  type: DepType;
  expr: string;
}

export interface ModelBase {
  parsed: ParsedODM;
  byVar: Map<string, Field>;
  ghosts: Map<string, GhostNode>;
  formNodes: Map<string, FormNode>;
  logicNodes: Map<string, LogicNode>;
  edges: Edge[];
  selfRefs: SelfRef[];
  formsById: Map<string, Form>;
  /** Per field: the event/context smart variables its logic sources use (no `[field]` edge is drawn for these). */
  smartDeps: Map<string, { type: DepType; smart: string[] }[]>;
}

export interface Model extends ModelBase {
  analysis: Analysis;
}

// ---------- view (input to the exporters and renderers) ----------

/** Which elements of the model are included in the view. */
export interface ViewFilter {
  level: Level;
  eventSet: Set<string> | null;
  types: Set<DepType>;
  forms: Set<string> | null;
  formsNone: boolean;
  crossOnly: boolean;
  instOnly: boolean;
  instances: boolean;
  expanded: Set<string> | null;
  expandedEvents: Set<string> | null;
  explore: ExploreFilter | null;
  pair: FormPair | null;
  focus: string;
  focusDir: FocusDir;
  focusDepth: number;
  showMissing: boolean;
  hideIsolated: boolean;
  hideIsolatedNodes: boolean;
}

/** How the included elements are drawn. */
export interface ViewPresentation {
  dir: Direction;
  labelMode: LabelMode;
  group: boolean;
  groupBy: GroupBy;
  edgeLabels: boolean;
}

export type ViewOptions = ViewFilter & ViewPresentation;

/** A form-to-form link, used for the "form link focus" and edge selection. */
export interface FormPair {
  from: string;
  to: string;
}

export interface ExploreStep {
  node: string;
  dir: NeighborDir;
  added: string[];
}

/** Interactive expansion of back / forward references, as kept in the store. */
export interface Explore {
  level: Level;
  seeds: string[];
  exp: ExploreStep[];
  inst?: boolean;
}

/** The explore set in the form the view builder reads it. */
export interface ExploreFilter {
  level: Level;
  inst: boolean;
  set: Set<string>;
}

export interface ViewNode {
  id: string;
  label: string;
  sub?: string;
  form: string;
  kind: NodeKind;
  focus?: boolean;
  extra?: string[];
  event?: string | null;
  field?: string;
  /** Event/context smart variables (e.g. `event-name`) used by the node's logic, for enabled types only. */
  smart?: string[];
  /** Temporary: the band (group id) an instance node belongs to while the view is built. */
  band?: string;
}

export interface ViewEdge {
  from: string;
  to: string;
  types: DepType[];
  count: number;
  byType: Partial<Record<DepType, number>>;
  fieldLevel?: boolean;
  cross?: boolean;
  mismatch?: boolean;
  relative?: boolean;
  crossArm?: boolean;
}

export interface ViewGroup {
  id: string;
  label: string;
  nodes: string[];
  noSelect?: boolean;
  parent?: string;
}

export interface View {
  level: Level;
  nodes: ViewNode[];
  edges: ViewEdge[];
  groups: ViewGroup[];
  instances?: boolean;
  mixed?: boolean;
  instEdges?: ViewEdge[];
  expandedNodes?: ViewNode[];
  /** Field level with a focus: how many more fields lie beyond the current focus depth. */
  focusHidden?: number;
}
