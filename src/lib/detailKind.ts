/* Which detail view a selected id gets. Pure: the caller supplies the model and view lookups as facts. */
import { isFormNode, isGhost, isLogicNode } from './graph';
import type { Selection } from './selection';
import type { EventDef, Form, NodeInfo, ViewNode } from './types';

/** What the model and the Instances view know about one id. */
export interface DetailFacts {
  /** The model node (field, ghost, form display logic or logic source) for the id. */
  node: NodeInfo | undefined;
  /** An Instances-view node for the id; only meaningful when there is no model node. */
  instanceNode: ViewNode | undefined;
  event: EventDef | undefined;
  form: Form | undefined;
}

export type DetailKind = 'instance' | 'undefinedFields' | 'event' | 'form' | 'formDisplayLogic' | 'logicSource' | 'ghost' | 'field' | 'none';

export type ClassifiedDetail =
  | { kind: 'group'; formId: string }
  | { kind: DetailKind; id: string; instanceId: string | undefined; facts: DetailFacts };

const UNDEFINED_FIELDS_ID = '(unknown)';

function kindOf(id: string, facts: DetailFacts): DetailKind {
  if (!facts.node) {
    if (facts.instanceNode) return 'instance';
    if (id === UNDEFINED_FIELDS_ID) return 'undefinedFields';
    if (facts.event) return 'event';
    if (facts.form) return 'form';
    return 'none';
  }
  if (isFormNode(facts.node)) return 'formDisplayLogic';
  if (isLogicNode(facts.node)) return 'logicSource';
  if (isGhost(facts.node)) return 'ghost';
  return 'field';
}

/**
 * Classify a selection. For an instance-expanded field (`variable@@instanceId`) the variable is classified
 * and the instance id is carried along so the explore buttons can act on the instance.
 */
export function classifyDetail(selection: Selection, lookUp: (id: string) => DetailFacts): ClassifiedDetail {
  if (selection.kind === 'group') return { kind: 'group', formId: selection.formId };
  const id = selection.kind === 'instanceField' ? selection.variable : selection.id;
  const instanceId = selection.kind === 'instanceField' ? selection.instanceId : undefined;
  const facts = lookUp(id);
  return { kind: kindOf(id, facts), id, instanceId, facts };
}
