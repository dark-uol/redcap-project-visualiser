import { describe, expect, it, vi } from 'vitest';
import { LogicTextView, SmartValueInputView, StateBadgeView, ValueInputView, choicesFor } from '../src/components/whatIfViews';
import type { Field } from '../src/lib/types';
import { renderComponent } from './renderComponent';

const field = (over: Partial<Field> = {}): Field => ({
  variable: 'v', oid: 'v', type: 'text', label: 'V', section: '', note: '', branching: '', calc: '', annotation: '',
  required: false, choices: [], form: 'f', ...over,
});
const choices = [{ code: '1', label: 'One' }, { code: '2', label: 'Two' }];
const change = (element: Element): void => { element.dispatchEvent(new Event('change', { bubbles: true })); };

describe('choicesFor', () => {
  it('uses the field choices, else the implicit yes/no and true/false ones, else none', () => {
    expect(choicesFor(field({ choices }))).toEqual(choices);
    expect(choicesFor(field({ type: 'yesno' })).map((c) => c.label)).toEqual(['Yes', 'No']);
    expect(choicesFor(field({ type: 'truefalse' })).map((c) => c.label)).toEqual(['True', 'False']);
    expect(choicesFor(field())).toEqual([]);
  });
});

describe('StateBadgeView', () => {
  it('shows the state with its class and tooltip', () => {
    const badge = renderComponent(() => <StateBadgeView state="hidden" tooltip="branching logic false" />).querySelector('.wi-state')!;
    expect(badge.textContent).toBe('hidden');
    expect(badge.classList).toContain('hidden');
    expect(badge.getAttribute('title')).toBe('branching logic false');
  });
});

describe('LogicTextView', () => {
  it('colours each part by its result and shows the joiners between them', () => {
    const container = renderComponent(() => (
      <LogicTextView parts={[
        { joiner: '', text: '[a] = 1', result: true },
        { joiner: 'and', text: '[b] = 2', result: false },
        { joiner: 'or', text: '[c] = 3', result: undefined },
      ]} />
    ));
    const parts = [...container.querySelectorAll('.wi-part')];
    expect(parts.map((part) => part.className)).toEqual(['wi-part true', 'wi-part false', 'wi-part unknown']);
    expect(parts[2].getAttribute('title')).toBe('not decided yet');
    expect([...container.querySelectorAll('.wi-joiner')].map((joiner) => joiner.textContent!.trim())).toEqual(['and', 'or']);
  });
});

describe('SmartValueInputView', () => {
  it('reports trimmed text, and null when emptied', () => {
    const onChange = vi.fn();
    const input = renderComponent(() => <SmartValueInputView value="x" onChange={onChange} />).querySelector('input')!;
    expect(input.value).toBe('x');
    input.value = '  admin ';
    change(input);
    expect(onChange).toHaveBeenLastCalledWith('admin');
    input.value = '   ';
    change(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('ValueInputView', () => {
  it('shows a text input for a plain field and reports the trimmed text', () => {
    const onChange = vi.fn();
    const input = renderComponent(() => <ValueInputView field={field()} value="5" formUnused={false} onChange={onChange} />).querySelector('input[type=text]') as HTMLInputElement;
    expect(input.value).toBe('5');
    input.value = ' 7 ';
    change(input);
    expect(onChange).toHaveBeenCalledWith('7');
  });

  it('shows a select for radio fields with the current choice selected, and reports a pick', () => {
    const onChange = vi.fn();
    const select = renderComponent(() => <ValueInputView field={field({ type: 'radio', choices })} value="2" formUnused={false} onChange={onChange} />).querySelector('select')!;
    expect([...select.options].map((option) => option.value)).toEqual(['', '1', '2']);
    expect(select.options[2].selected).toBe(true);
    select.value = '1';
    change(select);
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('shows checkboxes for checkbox fields and reports the new list of checked codes', () => {
    const onChange = vi.fn();
    const container = renderComponent(() => <ValueInputView field={field({ type: 'checkbox', choices })} value={['1']} formUnused={false} onChange={onChange} />);
    const boxes = [...container.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    boxes[1].checked = true;
    change(boxes[1]);
    expect(onChange).toHaveBeenCalledWith(['1', '2']);
    boxes[0].checked = false;
    change(boxes[0]);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('falls back to text for a calculated field and notes the override, except when compact', () => {
    const calc = field({ type: 'radio', choices, calc: '[a]+1' });
    const container = renderComponent(() => <ValueInputView field={calc} value={undefined} formUnused={false} onChange={vi.fn()} />);
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).toContain('overrides the calculation');
    expect(renderComponent(() => <ValueInputView field={calc} value={undefined} formUnused={false} compact onChange={vi.fn()} />).textContent).not.toContain('overrides');
  });

  it('warns when the form is not used in the event', () => {
    expect(renderComponent(() => <ValueInputView field={field()} value={undefined} formUnused={true} onChange={vi.fn()} />).textContent).toContain('This form is not used in this event');
  });
});
