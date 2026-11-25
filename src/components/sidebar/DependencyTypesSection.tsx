import { withFlags } from '../../lib/flags';
import type { DepType } from '../../lib/types';
import { filters } from '../../store';
import { DependencyTypesSectionView } from './DependencyTypesSectionView';

const { typesOn, setTypesOn } = filters;

/** Connector: reads which dependency types are drawn from the store and writes ticks back. */
export default function DependencyTypesSection() {
  const onTypeChange = function onTypeChange(kind: DepType, checked: boolean): void {
    setTypesOn(withFlags(typesOn(), [kind], checked));
  };
  return <DependencyTypesSectionView typesOn={typesOn()} onTypeChange={onTypeChange} />;
}
