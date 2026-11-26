import { describe, expect, it, vi } from 'vitest';
import { FieldEditorView, ValuesTableView, VisibilityTableView } from '../src/components/WhatIfTabViews';
import type { ChooserMatch, ValuesRow, ValuesTableViewProps, VisibilityRow, VisibilityTableViewProps } from '../src/components/WhatIfTabViews';
import { fireChange, renderComponent, tick } from './renderComponent';

const valuesRow = (over: Partial<ValuesRow> = {}): ValuesRow => ({
  key: 'age|', variable: 'age', event: null, explored: false, explorable: true, isSmart: false, showEventSelect: false,
  eventOptionIds: [], eventText: '', labelKind: 'label', label: 'Age in years', ...over,
});

function valuesProps(over: Partial<ValuesTableViewProps> = {}): ValuesTableViewProps {
  return {
    rows: [valuesRow()], showEventColumn: false, eventLabelOf: (id) => ({ ev1: 'Baseline', ev2: 'Week 1' } as Record<string, string>)[id] ?? id, clearCount: null, mode: 'form', engine: 'typescript', engineStatus: '', derive: true, onDeriveChange: vi.fn(), query: '', matches: [], listOpen: true,
    onModeChange: vi.fn(), onEngineChange: vi.fn(), onClearAll: vi.fn(), onExploreRow: vi.fn(), onChangeEvent: vi.fn(), onRemoveRow: vi.fn(),
    onQueryChange: vi.fn(), onChooseMatch: vi.fn(),
    renderValue: (row) => <span class="value-slot">{row().variable}</span>,
    renderState: () => <span class="state-slot">state</span>,
    ...over,
  };
}


describe('ValuesTableView', () => {
  it('shows a row with its label and the connected value and state cells', () => {
    const container = renderComponent(() => <ValuesTableView {...valuesProps()} />);
    expect(container.querySelector('tbody tr td button.link')!.textContent).toBe('age');
    expect(container.textContent).toContain('Age in years');
    expect(container.querySelector('.value-slot')!.textContent).toBe('age');
    expect(container.querySelector('.state-slot')).not.toBeNull();
  });

  it('marks the explored row and shows a plain code cell for an unexplorable one', () => {
    const rows = [valuesRow({ explored: true }), valuesRow({ key: 'ghost|', variable: 'ghost', explorable: false, labelKind: 'undefined' })];
    const container = renderComponent(() => <ValuesTableView {...valuesProps({ rows })} />);
    const [explored, ghost] = [...container.querySelectorAll('tbody tr:not(.wi-chooser)')];
    expect(explored.classList).toContain('wi-current');
    expect(ghost.querySelector('code')!.textContent).toBe('ghost');
    expect(ghost.textContent).toContain('not defined in this project');
  });

  it('labels smart variables', () => {
    const rows = [valuesRow({ key: '[user-name]|', variable: '[user-name]', isSmart: true, explorable: false, labelKind: 'smart', label: '' })];
    expect(renderComponent(() => <ValuesTableView {...valuesProps({ rows })} />).textContent).toContain('smart variable');
  });

  it('explores a row by clicking it, but not when the click is on an input', () => {
    const props = valuesProps();
    const container = renderComponent(() => <ValuesTableView {...props} />);
    (container.querySelector('tbody tr td:nth-child(2)') as HTMLElement).click();
    expect(props.onExploreRow).toHaveBeenCalledTimes(1);
    const unexplorable = renderComponent(() => <ValuesTableView {...valuesProps({ rows: [valuesRow({ explorable: false })], onExploreRow: props.onExploreRow })} />);
    (unexplorable.querySelector('tbody tr td:nth-child(2)') as HTMLElement).click();
    expect(props.onExploreRow).toHaveBeenCalledTimes(1);
  });

  it('removes a row', () => {
    const props = valuesProps();
    const container = renderComponent(() => <ValuesTableView {...props} />);
    (container.querySelector('.wi-remove') as HTMLElement).click();
    expect(props.onRemoveRow).toHaveBeenCalledWith(props.rows[0]);
  });

  it('shows the event column as text or as a choice of events', () => {
    const rows = [
      valuesRow({ eventText: 'Baseline', event: 'ev1' }),
      valuesRow({ key: 'sex|ev1', variable: 'sex', event: 'ev1', showEventSelect: true, eventOptionIds: ['ev1', 'ev2'] }),
    ];
    const props = valuesProps({ rows, showEventColumn: true });
    const container = renderComponent(() => <ValuesTableView {...props} />);
    expect(container.querySelector('thead')!.textContent).toContain('Event');
    const select = container.querySelector('select[title="Event the value is entered in"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(['ev1', 'ev2']);
    select.value = 'ev2';
    fireChange(select);
    expect(props.onChangeEvent).toHaveBeenCalledWith(rows[1], 'ev2');
    expect(renderComponent(() => <ValuesTableView {...valuesProps()} />).querySelector('thead')!.textContent).not.toContain('Event');
  });

  it('offers "all events" for a smart variable', () => {
    const rows = [valuesRow({ variable: '[x]', isSmart: true, showEventSelect: true, eventOptionIds: ['ev1'] })];
    const select = renderComponent(() => <ValuesTableView {...valuesProps({ rows, showEventColumn: true })} />).querySelector('select[title="Event the value is entered in"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['all events', 'Baseline']);
  });

  it('shows Clear all with its count only when there is something to clear', () => {
    const props = valuesProps({ clearCount: 3 });
    const container = renderComponent(() => <ValuesTableView {...props} />);
    const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear all (3)') as HTMLButtonElement;
    clear.click();
    expect(props.onClearAll).toHaveBeenCalledOnce();
    expect(renderComponent(() => <ValuesTableView {...valuesProps()} />).textContent).not.toContain('Clear all');
  });

  it('reports a mode change', () => {
    const props = valuesProps();
    const select = renderComponent(() => <ValuesTableView {...props} />).querySelector('.wi-mode select') as HTMLSelectElement;
    select.value = 'survey';
    fireChange(select);
    expect(props.onModeChange).toHaveBeenCalledWith('survey');
  });

  it('reports an engine change and shows the engine status only when there is one', () => {
    const props = valuesProps();
    const container = renderComponent(() => <ValuesTableView {...props} />);
    expect(container.querySelector('.wi-engine-status')).toBeNull();
    const select = container.querySelector('select.wi-engine') as HTMLSelectElement;
    select.value = 'python';
    fireChange(select);
    expect(props.onEngineChange).toHaveBeenCalledWith('python');
    const withStatus = renderComponent(() => <ValuesTableView {...valuesProps({ engine: 'python', engineStatus: 'Python 3.14.2' })} />);
    expect(withStatus.querySelector('.wi-engine-status')?.textContent).toBe('Python 3.14.2');
    expect((withStatus.querySelector('select.wi-engine') as HTMLSelectElement).value).toBe('python');
  });

  it('reports the Calculate setting changing', () => {
    const props = valuesProps({ derive: true });
    const box = renderComponent(() => <ValuesTableView {...props} />).querySelector('input.wi-derive') as HTMLInputElement;
    expect(box.checked).toBe(true);
    box.click();
    expect(props.onDeriveChange).toHaveBeenCalledWith(false);
    expect((renderComponent(() => <ValuesTableView {...valuesProps({ derive: false })} />).querySelector('input.wi-derive') as HTMLInputElement).checked).toBe(false);
  });

  describe('chooser', () => {
    const matches: ChooserMatch[] = [{ variable: 'sex', smart: false, text: 'sex — Sex (Demographics)' }, { variable: '[x]', smart: true, text: '[x] — smart variable' }];

    it('reports typing and lists the matches only while the list is open', () => {
      const props = valuesProps({ matches });
      const container = renderComponent(() => <ValuesTableView {...props} />);
      const input = container.querySelector('.wi-chooser input') as HTMLInputElement;
      input.value = 'se';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(props.onQueryChange).toHaveBeenCalledWith('se');
      expect(container.querySelectorAll('.wi-match')).toHaveLength(2);
      expect(renderComponent(() => <ValuesTableView {...valuesProps({ matches, listOpen: false })} />).querySelector('.wi-matches')).toBeNull();
    });

    it('chooses a match by click, and the first match with Enter', () => {
      const props = valuesProps({ matches });
      const container = renderComponent(() => <ValuesTableView {...props} />);
      (container.querySelectorAll('.wi-match')[1] as HTMLElement).click();
      expect(props.onChooseMatch).toHaveBeenLastCalledWith(matches[1]);
      const input = container.querySelector('.wi-chooser input') as HTMLInputElement;
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      input.dispatchEvent(enter);
      expect(props.onChooseMatch).toHaveBeenLastCalledWith(matches[0]);
      expect(enter.defaultPrevented).toBe(true);
    });

    it('ignores Enter when there is no match', () => {
      const props = valuesProps();
      const input = renderComponent(() => <ValuesTableView {...props} />).querySelector('.wi-chooser input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(props.onChooseMatch).not.toHaveBeenCalled();
    });

    it('spans every column', () => {
      expect(renderComponent(() => <ValuesTableView {...valuesProps({ showEventColumn: true })} />).querySelector('.wi-chooser td')!.getAttribute('colspan')).toBe('6');
      expect(renderComponent(() => <ValuesTableView {...valuesProps()} />).querySelector('.wi-chooser td')!.getAttribute('colspan')).toBe('5');
    });
  });
});

describe('FieldEditorView', () => {
  it('shows the field, the event when there is one, and the state slot', () => {
    const props = { variable: 'age', label: 'Age', eventLabel: 'Baseline', stateBadge: <b class="badge">shown</b>, onShowInGraph: vi.fn() };
    const container = renderComponent(() => <FieldEditorView {...props} />);
    expect(container.querySelector('h4')!.textContent).toContain('Exploring age — Age in Baseline');
    expect(container.querySelector('.badge')).not.toBeNull();
    (container.querySelector('button.link') as HTMLElement).click();
    expect(props.onShowInGraph).toHaveBeenCalledOnce();
  });

  it('omits the dash and the event when there are none', () => {
    const container = renderComponent(() => <FieldEditorView variable="age" label="" eventLabel={null} stateBadge="" onShowInGraph={vi.fn()} />);
    expect(container.querySelector('h4')!.textContent).toContain('Exploring age');
    expect(container.querySelector('h4')!.textContent).not.toContain('—');
    expect(container.querySelector('h4 .small.muted')).toBeNull();
  });
});

const visibilityRow = (over: Partial<VisibilityRow> = {}): VisibilityRow => ({
  key: 'a|', id: 'a', event: null, eventLabel: '', state: 'shown', info: undefined, step: 0, formId: 'f1', formLabel: 'Form One',
  kind: 'field', label: 'Field A', defined: true, logicTexts: [], logicNote: '', needs: [], value: '', valueKind: '', derivation: '', ...over,
});

function visibilityProps(over: Partial<VisibilityTableViewProps> = {}): VisibilityTableViewProps {
  return {
    title: 'Shown when', emptyText: 'Always shown.', rows: [visibilityRow()], showEventColumn: false, collapsed: false,
    onToggleCollapsed: vi.fn(), onEditField: vi.fn(),
    renderLogicText: (text) => <span class="logic-slot">{text}</span>,
    renderNeed: (input) => <span class="need-slot">{input().variable}</span>,
    renderState: (row) => <span class="state-slot">{row().state}</span>,
    ...over,
  };
}

describe('VisibilityTableView values', () => {
  const headers = (container: HTMLElement) => [...container.querySelectorAll('th')].map((cell) => cell.textContent);

  it('has no Value column when no row has a value', () => {
    expect(headers(renderComponent(() => <VisibilityTableView {...visibilityProps()} />))).not.toContain('Value');
  });

  it('shows a Value column when a row has one, marking calculated and default values with "=" and set ones plainly', () => {
    const rows = [
      visibilityRow({ key: 'a|', id: 'a', value: '299', valueKind: 'calculated', derivation: '= (a * 2)' }),
      visibilityRow({ key: 'b|', id: 'b', value: 'x', valueKind: 'default', derivation: "default '[ev][z]'" }),
      visibilityRow({ key: 'c|', id: 'c', value: '17', valueKind: 'set' }),
      visibilityRow({ key: 'd|', id: 'd' }),
    ];
    const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows })} />);
    expect(headers(container)).toContain('Value');
    const cells = [...container.querySelectorAll('tbody tr')].map((row) => row.querySelector('[class^="wi-value-"]'));
    expect(cells.map((cell) => cell?.className ?? null)).toEqual(['wi-value-calculated', 'wi-value-default', 'wi-value-set', null]);
    expect(cells.map((cell) => cell?.textContent?.trim() ?? null)).toEqual(['= 299', '= x', '17', null]);
    expect(cells[0]!.getAttribute('title')).toBe('Calculated from its inputs');
  });

  it('shows a blank result as "(blank)", not as nothing', () => {
    const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows: [visibilityRow({ value: '', valueKind: 'calculated' })] })} />);
    expect(container.querySelector('.wi-value-calculated')!.textContent).toContain('(blank)');
  });

  it('shows the formula under the logic, with or without a value yet', () => {
    const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows: [visibilityRow({ derivation: '= a + b' })] })} />);
    expect(container.querySelector('.wi-derivation')!.textContent).toBe('= a + b');
  });
});

describe('VisibilityTableView', () => {
  it('shows the empty text when there are no rows', () => {
    const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows: [] })} />);
    expect(container.textContent).toContain('Always shown.');
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows the state counts in the heading and the row cells', () => {
    const rows = [visibilityRow(), visibilityRow({ key: 'b|', id: 'b', state: 'hidden', label: 'Field B' }), visibilityRow({ key: 'c|', id: 'c', state: 'hidden' })];
    const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows })} />);
    expect(container.querySelector('.wi-fold')!.textContent).toContain('Shown (1) · Hidden (2) · Unknown (0)');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(container.querySelector('tbody td:nth-child(2)')!.textContent).toBe('Field A');
  });

  it('collapses behind the heading but keeps the counts', () => {
    const props = visibilityProps({ collapsed: true });
    const container = renderComponent(() => <VisibilityTableView {...props} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('.wi-fold')!.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.wi-fold')!.textContent).toContain('Shown (1)');
    (container.querySelector('.wi-fold') as HTMLElement).click();
    expect(props.onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('renders each kind of first cell and the label for undefined ids', () => {
    const props = visibilityProps({
      rows: [
        visibilityRow(),
        visibilityRow({ key: 'form:f1|', id: 'form:f1', kind: 'form', label: '' }),
        visibilityRow({ key: 'ghost|', id: 'ghost', kind: 'undefined', defined: false, formId: undefined }),
      ],
    });
    const container = renderComponent(() => <VisibilityTableView {...props} />);
    const cells = [...container.querySelectorAll('tbody tr')].map((row) => row.querySelector('td:first-child')!);
    expect(cells[0].querySelector('button.link')!.textContent).toBe('a');
    expect(cells[1].textContent).toContain('Form: Form One');
    expect(cells[2].querySelector('code')!.textContent).toBe('ghost');
    expect(container.querySelectorAll('tbody tr')[2].textContent).toContain('not defined in this project');
    (cells[0].querySelector('button.link') as HTMLElement).click();
    expect(props.onEditField).toHaveBeenCalledWith(props.rows[0]);
  });

  it('shows the step column only when asked', () => {
    expect(renderComponent(() => <VisibilityTableView {...visibilityProps({ showStep: true, rows: [visibilityRow({ step: 2 })] })} />).querySelector('thead')!.textContent).toContain('Step');
    expect(renderComponent(() => <VisibilityTableView {...visibilityProps()} />).querySelector('thead')!.textContent).not.toContain('Step');
  });

  it('renders the logic, the note and the needs through the slots', () => {
    const rows = [visibilityRow({ logicTexts: ["[x] = '1'", "[y] = '2'"], logicNote: '@HIDDEN', needs: [{ variable: 'x', event: null }, { variable: 'y', event: null }] })];
    const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows })} />);
    expect([...container.querySelectorAll('.logic-slot')].map((node) => node.textContent)).toEqual(["[x] = '1'", "[y] = '2'"]);
    expect(container.querySelector('td.expr .muted')!.textContent).toBe('@HIDDEN');
    expect(container.querySelectorAll('.need-slot')).toHaveLength(2);
  });

  describe('filters', () => {
    const rows = [
      visibilityRow({ key: 'a|e1', id: 'a', event: 'e1', eventLabel: 'Baseline', state: 'shown', formId: 'f1', formLabel: 'Form One' }),
      visibilityRow({ key: 'b|e2', id: 'b', event: 'e2', eventLabel: 'Week 1', state: 'hidden', formId: 'f2', formLabel: 'Form Two' }),
    ];
    const rowIds = (container: HTMLElement): string[] => [...container.querySelectorAll('tbody tr')].map((row) => row.querySelector('button.link')!.textContent!);
    const select = (container: HTMLElement, title: string): HTMLSelectElement => container.querySelector(`select[title="${title}"]`) as HTMLSelectElement;

    it('filters by state and says how many rows remain', async () => {
      const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows, showEventColumn: true })} />);
      const state = select(container, 'Show rows in this state');
      state.value = 'hidden';
      fireChange(state);
      await tick();
      expect(rowIds(container)).toEqual(['b']);
      expect(container.textContent).toContain('1 of 2');
    });

    it('filters by event and by form, labelling the options from the rows', async () => {
      const container = renderComponent(() => <VisibilityTableView {...visibilityProps({ rows, showEventColumn: true })} />);
      const events = select(container, 'Show rows in this event');
      expect([...events.options].map((option) => option.textContent)).toEqual(['all events', 'Baseline', 'Week 1']);
      events.value = 'e1';
      fireChange(events);
      await tick();
      expect(rowIds(container)).toEqual(['a']);
      const forms = select(container, 'Show rows in this form');
      expect([...forms.options].map((option) => option.textContent)).toEqual(['all forms', 'Form One', 'Form Two']);
    });

    it('hides the event filter without events, or with only one event', () => {
      expect(select(renderComponent(() => <VisibilityTableView {...visibilityProps({ rows })} />), 'Show rows in this event')).toBeNull();
      expect(select(renderComponent(() => <VisibilityTableView {...visibilityProps({ rows: [rows[0]], showEventColumn: true })} />), 'Show rows in this event')).toBeNull();
    });
  });
});
