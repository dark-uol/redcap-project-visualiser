/* Download actions: Mermaid, DOT, CSV and the rendered SVG, named after the loaded file and level. */
import { need } from './common';
import type { Derived } from './derived';
import type { State } from './state';
import { download } from '../lib/download';
import { toCsv } from '../lib/exporters';

export function createDownloads(state: State, derived: Derived) {
  const { fileBase, svgEl, model } = state;
  const { level } = state.selection;
  const { instanceMode, mermaidSrc, dotSrc, opts } = derived;

  const suffix = (): string => (level() === 'form' ? (instanceMode() ? '_instances' : '_forms') : level() === 'event' ? '_events' : '_fields');
  const downloadMermaid = (): void => download(fileBase() + suffix() + '.mmd', mermaidSrc());
  const downloadDot = (): void => download(fileBase() + suffix() + '.dot', dotSrc());
  const downloadCsv = (): void => {
    const loadedModel = need(model());
    const types = need(opts()).types;
    download(fileBase() + '_dependencies.csv', toCsv(loadedModel, loadedModel.edges.filter((e) => types.has(e.type))), 'text/csv;charset=utf-8');
  };
  const downloadSvg = (): void => {
    const s = svgEl();
    if (!s) { alert('Render the graph first.'); return; }
    const c = s.cloneNode(true) as SVGSVGElement;
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    download(fileBase() + suffix() + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c), 'image/svg+xml;charset=utf-8');
  };

  return { downloadMermaid, downloadDot, downloadCsv, downloadSvg };
}
