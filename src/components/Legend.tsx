import { presentation, selection } from '../store';
import { LegendView } from './LegendView';

export default function Legend() {
  return <LegendView lineWidths={presentation.lineWidths() && selection.level() !== 'field'} />;
}
