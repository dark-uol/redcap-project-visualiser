import { describe, expect, it } from 'vitest';
import { FileDropView } from '../src/components/FileDropView';
import { renderComponent } from './renderComponent';

describe('FileDropView', () => {
  it('shows the drop prompt', () => {
    const container = renderComponent(() => <FileDropView over={false} />);
    expect(container.textContent).toContain('Drop a REDCap project XML here');
  });

  it('adds the over class only while a file is dragged over', () => {
    expect(renderComponent(() => <FileDropView over={false} />).querySelector('.drop')!.classList).not.toContain('over');
    expect(renderComponent(() => <FileDropView over={true} />).querySelector('.drop')!.classList).toContain('over');
  });
});
