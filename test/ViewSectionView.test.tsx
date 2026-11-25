import { describe, expect, it, vi } from 'vitest';
import { ViewSectionView } from '../src/components/sidebar/ViewSectionView';
import type { ViewSectionViewProps } from '../src/components/sidebar/ViewSectionView';
import { renderComponent } from './renderComponent';

const BASE_PROPS = {
  level: 'field',
  renderer: 'graphviz',
  direction: 'LR',
  labelMode: 'var',
  groupBy: 'form',
  hasEvents: false,
  instances: false,
  edgeLabels: false,
  hideIsolatedNodes: true,
  hideIsolatedFields: true,
  showMissing: true,
} as const;

function makeHandlers() {
  return {
    onLevelChange: vi.fn(),
    onRendererChange: vi.fn(),
    onDirectionChange: vi.fn(),
    onLabelModeChange: vi.fn(),
    onGroupByChange: vi.fn(),
    onInstancesChange: vi.fn(),
    onEdgeLabelsChange: vi.fn(),
    onHideIsolatedNodesChange: vi.fn(),
    onHideIsolatedFieldsChange: vi.fn(),
    onShowMissingChange: vi.fn(),
  };
}

function renderView(overrides: Partial<ViewSectionViewProps> = {}) {
  const handlers = makeHandlers();
  const props: ViewSectionViewProps = { ...BASE_PROPS, ...handlers, ...overrides };
  const container = renderComponent(() => <ViewSectionView {...props} />);
  const labelled = (text: string) => Array.from(container.querySelectorAll('label')).find((label) => label.textContent?.includes(text))!;
  const selectIn = (text: string) => labelled(text).querySelector('select') as HTMLSelectElement;
  const checkboxIn = (text: string) => labelled(text).querySelector('input[type="checkbox"]') as HTMLInputElement;
  return { container, handlers, selectIn, checkboxIn };
}

function changeSelect(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function changeCheckbox(box: HTMLInputElement, checked: boolean): void {
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ViewSectionView selects', () => {
  it('passes the chosen level, renderer, direction, node text and grouping to their callbacks', () => {
    const { selectIn, handlers } = renderView();
    changeSelect(selectIn('Level'), 'event');
    changeSelect(selectIn('Renderer'), 'mermaid');
    changeSelect(selectIn('Direction'), 'TD');
    changeSelect(selectIn('Node text'), 'label');
    changeSelect(selectIn('Group fields by'), 'none');
    expect(handlers.onLevelChange).toHaveBeenCalledWith('event');
    expect(handlers.onRendererChange).toHaveBeenCalledWith('mermaid');
    expect(handlers.onDirectionChange).toHaveBeenCalledWith('TD');
    expect(handlers.onLabelModeChange).toHaveBeenCalledWith('label');
    expect(handlers.onGroupByChange).toHaveBeenCalledWith('none');
  });

  it('selects the option matching each current value', () => {
    const { selectIn } = renderView({ level: 'form', groupBy: 'arm' });
    expect(selectIn('Level').value).toBe('form');
    expect(selectIn('Group fields by').value).toBe('arm');
  });
});

describe('ViewSectionView checkboxes', () => {
  it('reports each toggle with its new checked state', () => {
    const { checkboxIn, handlers } = renderView({ level: 'form', hasEvents: true, instances: false });
    changeCheckbox(checkboxIn('Instances'), true);
    changeCheckbox(checkboxIn('Edge labels'), true);
    changeCheckbox(checkboxIn('Hide forms with no dependencies'), false);
    changeCheckbox(checkboxIn('Hide fields with no dependencies'), false);
    changeCheckbox(checkboxIn('Show undefined references'), false);
    expect(handlers.onInstancesChange).toHaveBeenCalledWith(true);
    expect(handlers.onEdgeLabelsChange).toHaveBeenCalledWith(true);
    expect(handlers.onHideIsolatedNodesChange).toHaveBeenCalledWith(false);
    expect(handlers.onHideIsolatedFieldsChange).toHaveBeenCalledWith(false);
    expect(handlers.onShowMissingChange).toHaveBeenCalledWith(false);
  });

  it('shows the instances option only at form level in a project with events', () => {
    expect(renderView({ level: 'form', hasEvents: true }).container.textContent).toContain('Instances (one node per form per event)');
    expect(renderView({ level: 'form', hasEvents: false }).container.textContent).not.toContain('Instances (one node per form per event)');
    expect(renderView({ level: 'field', hasEvents: true }).container.textContent).not.toContain('Instances (one node per form per event)');
  });

  it('names the isolated-node option for the current level, and hides it at field level', () => {
    expect(renderView({ level: 'form' }).container.textContent).toContain('Hide forms with no dependencies');
    expect(renderView({ level: 'event' }).container.textContent).toContain('Hide events with no dependencies');
    const fieldLevel = renderView({ level: 'field' }).container.textContent;
    expect(fieldLevel).not.toContain('Hide forms with no dependencies');
    expect(fieldLevel).not.toContain('Hide events with no dependencies');
  });

  it('reflects the checked state of each option', () => {
    const { checkboxIn } = renderView({ edgeLabels: true, showMissing: false });
    expect(checkboxIn('Edge labels').checked).toBe(true);
    expect(checkboxIn('Show undefined references').checked).toBe(false);
  });
});
