import { downloadMermaid, downloadDot, downloadSvg, downloadCsv } from '../store';
import { DownloadMenuView } from './DownloadMenuView';

export default function DownloadMenu() {
  return (
    <DownloadMenuView
      onDownloadMermaid={downloadMermaid}
      onDownloadDot={downloadDot}
      onDownloadSvg={downloadSvg}
      onDownloadCsv={downloadCsv}
    />
  );
}
