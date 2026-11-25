import { selection } from '../store';
import { LegendView } from './LegendView';

export default function Legend() {
  return <LegendView formLevel={selection.level() === 'form'} />;
}
