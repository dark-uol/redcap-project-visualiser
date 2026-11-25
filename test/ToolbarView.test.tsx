import { describe, expect, it, vi } from 'vitest';
import { ToolbarView } from '../src/components/ToolbarView';
import { renderComponent } from './renderComponent';

function renderToolbar(summary = '') {
  const handlers = { openFile: vi.fn(), loadSample: vi.fn() };
  const container = renderComponent(() => (
    <ToolbarView summary={summary} onOpenFile={handlers.openFile} onLoadSample={handlers.loadSample} />
  ));
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const sampleButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Load sample') as HTMLButtonElement;
  return { container, handlers, input, sampleButton };
}

describe('ToolbarView', () => {
  it('shows the project summary', () => {
    const { container } = renderToolbar('Demo · 3 fields · 1 forms');
    expect(container.textContent).toContain('Demo · 3 fields · 1 forms');
  });

  it('calls onLoadSample when Load sample is clicked', async () => {
    const { handlers, sampleButton } = renderToolbar();
    sampleButton.click();
    await Promise.resolve();
    expect(handlers.loadSample).toHaveBeenCalledOnce();
    expect(handlers.openFile).not.toHaveBeenCalled();
  });

  it('calls onOpenFile with the selected file and clears the input', async () => {
    const { handlers, input } = renderToolbar();
    const file = new File(['<ODM/>'], 'project.xml', { type: 'text/xml' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(handlers.openFile).toHaveBeenCalledOnce();
    expect(handlers.openFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('does not call onOpenFile when no file is selected', async () => {
    const { handlers, input } = renderToolbar();
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(handlers.openFile).not.toHaveBeenCalled();
  });
});
