/* Which explore buttons the Detail panel shows for a selection, and what they act on. Pure. */
import { parseSelection } from './selection';
import type { Level } from './types';

export interface ExploreContext {
  level: Level;
  instanceMode: boolean;
  isFormId(id: string): boolean;
  /** The form owning a field or node id. */
  formOf(id: string): string | undefined;
  /** Non-field nodes of the Instances view (empty outside instance mode). */
  instanceNodes: readonly { id: string; form?: string }[];
}

export type ExploreTarget =
  | { kind: 'none' }
  | { kind: 'hint'; message: string }
  | { kind: 'instance'; target: string; appliesTo: string | null }
  | { kind: 'field'; target: string; isGroup: boolean; wholeFormId: string | null; appliesTo: string | null };

const HINT_SELECT_INSTANCE = "Select one of this form's instance nodes to expand its references.";

function resolveFieldTarget(context: ExploreContext, id: string): ExploreTarget {
  const selection = parseSelection(id);
  const isGroup = selection.kind === 'group';
  // at form level the target is the form owning the selected node
  const target = context.level === 'form'
    ? (context.isFormId(id) || id === '(unknown)' ? id : context.formOf(id))
    : id;
  if (!target) return { kind: 'none' };
  const formId = selection.kind === 'group' ? selection.formId : context.formOf(id);
  return {
    kind: 'field',
    target,
    isGroup,
    wholeFormId: context.level === 'field' && formId ? formId : null,
    appliesTo: context.level === 'form' && target !== id ? target : null,
  };
}

function resolveInstanceTarget(context: ExploreContext, id: string): ExploreTarget {
  let target: string | null = context.instanceNodes.some((node) => node.id === id) ? id : null;
  if (!target) {
    // a plain field or form id resolves to its only instance node
    const selection = parseSelection(id);
    const formId = selection.kind === 'group' ? selection.formId : context.formOf(id);
    const candidates = context.instanceNodes.filter((node) => node.form === formId);
    if (candidates.length !== 1) {
      return { kind: 'hint', message: candidates.length ? HINT_SELECT_INSTANCE : '' };
    }
    target = candidates[0].id;
  }
  return { kind: 'instance', target, appliesTo: target !== id ? target : null };
}

/** The explore buttons for a selected id (or instance id) in the current level and mode. */
export function resolveExploreTarget(context: ExploreContext, id: string): ExploreTarget {
  if (context.level === 'event') return { kind: 'none' }; // the event graph has no back / forward expansion
  return context.instanceMode ? resolveInstanceTarget(context, id) : resolveFieldTarget(context, id);
}
