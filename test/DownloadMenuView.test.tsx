import { describe, expect, it, vi } from 'vitest';
import { DownloadMenuView } from '../src/components/DownloadMenuView';
import { renderComponent } from './renderComponent';

function renderMenu() {
  const handlers = { mermaid: vi.fn(), dot: vi.fn(), svg: vi.fn(), csv: vi.fn() };
  const container = renderComponent(() => (
    <DownloadMenuView
      onDownloadMermaid={handlers.mermaid}
      onDownloadDot={handlers.dot}
      onDownloadSvg={handlers.svg}
      onDownloadCsv={handlers.csv}
    />
  ));
  const toggle = container.querySelector('.dlmenu > button') as HTMLButtonElement;
  const popup = () => container.querySelector('.dlpop');
  return { handlers, toggle, popup };
}

describe('DownloadMenuView', () => {
  it('starts closed and opens when the button is clicked', async () => {
    const { toggle, popup } = renderMenu();
    expect(popup()).toBeNull();
    toggle.click();
    await Promise.resolve();
    expect(popup()).not.toBeNull();
  });

  it('runs the chosen download and closes', async () => {
    const { toggle, popup, handlers } = renderMenu();
    toggle.click();
    await Promise.resolve();
    (popup()!.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await Promise.resolve();
    expect(handlers.dot).toHaveBeenCalledOnce();
    expect(handlers.mermaid).not.toHaveBeenCalled();
    expect(popup()).toBeNull();
  });

  it('closes on Escape', async () => {
    const { toggle, popup } = renderMenu();
    toggle.click();
    await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await Promise.resolve();
    expect(popup()).toBeNull();
  });
});
