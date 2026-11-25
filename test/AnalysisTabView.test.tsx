import { describe, expect, it, vi } from 'vitest';
import sampleXml from '../public/sample/sample.xml?raw';
import { AnalysisTabView } from '../src/components/AnalysisTabView';
import { buildModel } from '../src/lib/graph';
import { parseODM } from '../src/lib/parser';
import type { Model } from '../src/lib/types';
import { renderComponent } from './renderComponent';

const sampleModel: Model = buildModel(parseODM(sampleXml));

/** Finds the summary card whose text label (the node after the count) matches. */
function cardFor(container: HTMLElement, label: string): HTMLElement {
  const card = Array.from(container.querySelectorAll<HTMLElement>('.card')).find((c) => c.lastChild?.textContent === label);
  if (!card) throw new Error(`no card labelled ${label}`);
  return card;
}

function renderView(model: Model, onJumpToField = vi.fn()) {
  const container = renderComponent(() => <AnalysisTabView model={model} onJumpToField={onJumpToField} />);
  return { container, onJumpToField };
}

describe('AnalysisTabView', () => {
  it('shows summary cards with the counts from the model', () => {
    const { container } = renderView(sampleModel);
    expect(cardFor(container, 'fields').querySelector('b')!.textContent).toBe(String(sampleModel.parsed.fields.length));
    expect(cardFor(container, 'dependencies').querySelector('b')!.textContent).toBe(String(sampleModel.edges.length));
    expect(cardFor(container, 'isolated fields').querySelector('b')!.textContent).toBe(String(sampleModel.analysis.isolated.length));
  });

  it('marks the circular-groups card as a warning and lists its cycles as field links', () => {
    const model: Model = { ...sampleModel, analysis: { ...sampleModel.analysis, cycles: [['alpha', 'beta']] } };
    const { container } = renderView(model);
    expect(cardFor(container, 'circular groups').classList).toContain('warn');
    expect(cardFor(container, 'circular groups').querySelector('b')!.textContent).toBe('1');
    const links = Array.from(container.querySelectorAll('#an-cycles + ul .fieldlink')).map((b) => b.textContent);
    expect(links).toEqual(['alpha', 'beta']);
  });

  it('calls onJumpToField with the variable when a field link is clicked', async () => {
    const model: Model = { ...sampleModel, analysis: { ...sampleModel.analysis, cycles: [['alpha', 'beta']] } };
    const { container, onJumpToField } = renderView(model);
    const betaLink = Array.from(container.querySelectorAll<HTMLButtonElement>('.fieldlink')).find((b) => b.textContent === 'beta')!;
    betaLink.click();
    await Promise.resolve();
    expect(onJumpToField).toHaveBeenCalledOnce();
    expect(onJumpToField).toHaveBeenCalledWith('beta');
  });

  it('shows "None" in every list section when the analysis is empty', () => {
    const empty: Model = {
      ...sampleModel,
      selfRefs: [],
      analysis: { ...sampleModel.analysis, cycles: [], missing: [], forward: [], hubs: [], heavy: [] },
    };
    const { container } = renderView(empty);
    expect(container.querySelectorAll('.muted').length).toBeGreaterThanOrEqual(5);
    expect(Array.from(container.querySelectorAll('p.muted')).every((p) => p.textContent === 'None 🎉')).toBe(true);
    expect(container.querySelectorAll('p.muted').length).toBe(5);
    expect(cardFor(container, 'circular groups').classList).not.toContain('warn');
  });

  it('scrolls to the section when a clickable card is activated with Enter', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      const { container } = renderView(sampleModel);
      const card = cardFor(container, 'circular groups');
      expect(card.getAttribute('role')).toBe('button');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(scroll).toHaveBeenCalledOnce();
      expect(scroll.mock.contexts[0]).toBe(container.querySelector('#an-cycles'));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
