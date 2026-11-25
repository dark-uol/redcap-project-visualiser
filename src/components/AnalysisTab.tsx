import { need, model, jumpToField } from '../store';
import { AnalysisTabView } from './AnalysisTabView';

export default function AnalysisTab() {
  return <AnalysisTabView model={need(model())} onJumpToField={jumpToField} />;
}
