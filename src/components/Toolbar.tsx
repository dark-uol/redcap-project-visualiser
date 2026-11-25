/* Header: title, open-file / sample buttons and project summary. */
import { model, readFile, loadSample } from '../store';
import { ToolbarView } from './ToolbarView';

export default function Toolbar() {
  const summary = (): string => {
    const m = model();
    if (!m) return '';
    const p = m.parsed;
    return `${p.projectName} · ${p.fields.length} fields · ${p.forms.length} forms` + (p.redcapVersion ? ` · REDCap ${p.redcapVersion}` : '');
  };
  return <ToolbarView summary={summary()} onOpenFile={readFile} onLoadSample={loadSample} />;
}
