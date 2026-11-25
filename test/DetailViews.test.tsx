import { describe, expect, it, vi } from 'vitest';
import {
  CodeBlock, DetailPanelView, EdgeDetailView, EventDetailView, FieldDetailView, FormDetailView, GhostDetailView,
  InstanceDetailView, LogicSourceDetailView,
} from '../src/components/DetailViews';
import type { Edge, EventDef, Field, ViewEdge } from '../src/lib/types';
import { renderComponent } from './renderComponent';

const field = (over: Partial<Field> = {}): Field => ({
  variable: 'age', oid: 'age', type: 'text', label: 'Age in years', section: '', note: '', branching: '', calc: '',
  annotation: '', required: false, choices: [], form: 'demographics', ...over,
});
const edge = (over: Partial<Edge> = {}): Edge => ({ from: 'a', to: 'b', type: 'branching', expr: "[a] = '1'", cross: false, missing: false, ...over });
const viewEdge = (over: Partial<ViewEdge> = {}): ViewEdge => ({ from: 'x', to: 'y', types: ['branching'], count: 1, byType: {}, ...over });
const slot = (name: string) => <span class={'slot-' + name}>{name}</span>;
const buttonLabelled = (container: HTMLElement, label: string): HTMLButtonElement =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

describe('CodeBlock', () => {
  const props = { title: 'Logic', isDefined: (v: string) => v === 'known', onSelect: vi.fn() };

  it('renders nothing without text', () => {
    expect(renderComponent(() => <CodeBlock {...props} text="" />).innerHTML).not.toContain('Logic');
  });

  it('makes defined references clickable and marks undefined ones bad', () => {
    const onSelect = vi.fn();
    const container = renderComponent(() => <CodeBlock {...props} onSelect={onSelect} text="[known] = 1 and [ghost] = 2" />);
    const refs = container.querySelectorAll('.ref');
    expect(refs).toHaveLength(2);
    expect(refs[1].classList).toContain('bad');
    (refs[0] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('known');
    (refs[1] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('copies the text and confirms on the button', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const container = renderComponent(() => <CodeBlock {...props} text="[known]" copyable={true} />);
    const copy = buttonLabelled(container, 'copy');
    copy.click();
    expect(writeText).toHaveBeenCalledWith('[known]');
    expect(copy.textContent).toBe('copied');
  });
});

describe('FieldDetailView', () => {
  const baseProps = () => ({
    field: field({ branching: "[other] = '1'" }),
    formLabel: 'Demographics',
    dependsOn: [{ id: 'other', t: 'branching' }],
    usedBy: [],
    isDefined: () => true,
    onSelect: vi.fn(),
    onOpenWhatIf: vi.fn(),
    whatIfBadge: slot('badge'),
    explore: slot('explore'),
    trace: slot('trace'),
  });

  it('shows the field, its logic, chips and the connected slots', () => {
    const container = renderComponent(() => <FieldDetailView {...baseProps()} />);
    expect(container.querySelector('h3')!.textContent).toBe('age');
    expect(container.textContent).toContain('Demographics');
    for (const name of ['badge', 'explore', 'trace']) expect(container.querySelector('.slot-' + name)).not.toBeNull();
    expect(container.textContent).toContain('Branching logic');
    expect(container.textContent).not.toContain('No logic code on this field.');
    expect(container.textContent).toContain('Depends on (1)');
    expect(container.textContent).toContain('Used by (0)');
  });

  it('says so when the field has no logic code, and lists choices', () => {
    const container = renderComponent(() => <FieldDetailView {...baseProps()} field={field({ choices: [{ code: '1', label: 'Yes' }] })} />);
    expect(container.textContent).toContain('No logic code on this field.');
    expect(container.querySelector('pre')!.textContent).toBe('1, Yes');
  });

  it('selects a chip and opens the what-if tab', () => {
    const props = baseProps();
    const container = renderComponent(() => <FieldDetailView {...props} />);
    (container.querySelector('.chip') as HTMLElement).click();
    expect(props.onSelect).toHaveBeenCalledWith('other');
    buttonLabelled(container, 'What if…').click();
    expect(props.onOpenWhatIf).toHaveBeenCalledOnce();
  });
});

describe('FormDetailView', () => {
  const baseProps = () => ({
    label: 'Baseline', formId: 'baseline', fieldCount: 4, repeatingNote: ' · repeating in Visit 1', canZoom: true,
    zoomLabel: 'into fields', onToggleZoom: vi.fn(), crossFormEdges: [edge()], onOpen: vi.fn(),
    explore: slot('explore'), trace: slot('trace'),
  });

  it('shows the form summary, slots and cross-form edges', () => {
    const container = renderComponent(() => <FormDetailView {...baseProps()} />);
    expect(container.textContent).toContain('form baseline · 4 fields · repeating in Visit 1');
    expect(container.querySelector('.slot-explore')).not.toBeNull();
    expect(container.textContent).toContain('Cross-form dependencies (1)');
  });

  it('offers the zoom toggle only when allowed', () => {
    const props = baseProps();
    const container = renderComponent(() => <FormDetailView {...props} />);
    buttonLabelled(container, 'into fields').click();
    expect(props.onToggleZoom).toHaveBeenCalledOnce();
    expect(renderComponent(() => <FormDetailView {...props} canZoom={false} />).textContent).not.toContain('into fields');
  });

  it('opens a field from an edge row', () => {
    const props = baseProps();
    const container = renderComponent(() => <FormDetailView {...props} />);
    buttonLabelled(container, 'b').click();
    expect(props.onOpen).toHaveBeenCalledWith('b');
  });
});

describe('small views', () => {
  it('GhostDetailView shows an empty "Used by" as none', () => {
    const container = renderComponent(() => <GhostDetailView id="ghost" usedBy={[]} onSelect={vi.fn()} explore={slot('explore')} />);
    expect(container.textContent).toContain('Referenced but not defined');
    expect(container.querySelector('.muted.small:last-child')!.textContent).toBe('none');
  });

  it('LogicSourceDetailView lists the fields the logic reads', () => {
    const onSelect = vi.fn();
    const container = renderComponent(() => (
      <LogicSourceDetailView label="Gate" kind="formdisplay" logic="[a] = 1" reads={[{ id: 'a', t: 'logicsrc' }]} isDefined={() => true} onSelect={onSelect} explore={slot('explore')} />
    ));
    expect(container.textContent).toContain('Reads fields (1)');
    (container.querySelector('.chip') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});

describe('InstanceDetailView', () => {
  it('shows form, event and repeating facts, other events and the edges with their flags', () => {
    const onSelect = vi.fn();
    const container = renderComponent(() => (
      <InstanceDetailView
        title="Vitals @ Baseline" formId="vitals" eventId="baseline" fieldCount={3} repeating={true}
        zoomLabel="into fields" onToggleZoom={vi.fn()}
        alsoIn={[{ id: 'vitals@@week1', label: 'Week 1' }]}
        incoming={[{ edge: viewEdge({ cross: true, crossArm: true }), other: 'x', label: 'Intake @ Baseline' }]}
        outgoing={[]} onSelect={onSelect} explore={slot('explore')}
      />
    ));
    expect(container.querySelector('h3')!.textContent).toBe('Vitals @ Baseline');
    expect(container.textContent).toContain('form vitals · event baseline · 3 fields · repeating');
    expect(container.textContent).toContain('Also collected in (1)');
    expect(container.textContent).toContain('cross');
    expect(container.textContent).toContain('cross-arm');
    expect(container.textContent).toContain('Outgoing to other instances (0)');
    buttonLabelled(container, 'Week 1').click();
    expect(onSelect).toHaveBeenCalledWith('vitals@@week1');
  });
});

describe('EventDetailView', () => {
  const event: EventDef = { id: 'ev1', label: 'Baseline', arm: '1', armName: 'Arm A', repeating: false, forms: ['f1'] };
  const baseProps = () => ({
    event, formLabels: [] as string[], canZoom: true, zoomLabel: 'into forms', onToggleZoom: vi.fn(),
    repeatingInstruments: [] as string[], readFromEvent: [edge({ events: ['ev1', 'ev2'] })], readsOtherEvents: [] as Edge[],
    onOpen: vi.fn(), trace: slot('trace'),
  });

  it('shows arm info, "none" for no forms, and the events of each edge', () => {
    const container = renderComponent(() => <EventDetailView {...baseProps()} />);
    expect(container.textContent).toContain('event ev1 · arm 1 (Arm A)');
    expect(container.textContent).toContain('Forms: none');
    expect(container.textContent).toContain('ev1, ev2');
    expect(container.textContent).toContain('Reads other events (0)');
  });

  it('offers zoom only at event level and lists repeating instruments', () => {
    const props = baseProps();
    expect(renderComponent(() => <EventDetailView {...props} canZoom={false} repeatingInstruments={['Labs']} />).textContent).toContain('Repeating instruments: Labs');
    const container = renderComponent(() => <EventDetailView {...props} />);
    buttonLabelled(container, 'into forms').click();
    expect(props.onToggleZoom).toHaveBeenCalledOnce();
  });
});

describe('EdgeDetailView', () => {
  const baseProps = () => ({
    fromLabel: 'Intake', toLabel: 'Outcome', sourceCount: 1,
    dependents: [{ dependent: 'score', edges: [edge({ from: 'a', to: 'score', type: 'calc', expr: '[a] * 2' })] }],
    dependencyCount: 1, onShowFields: vi.fn(), onSelect: vi.fn(),
  });

  it('uses singular nouns for one of each', () => {
    const container = renderComponent(() => <EdgeDetailView {...baseProps()} />);
    expect(container.querySelector('h3')!.textContent).toBe('Intake → Outcome');
    expect(container.textContent).toContain('1 source field · 1 dependent field · 1 dependency');
    expect(container.querySelector('pre')!.textContent).toBe('[a] * 2');
  });

  it('uses plural nouns otherwise, and wires its buttons', () => {
    const props = baseProps();
    const container = renderComponent(() => <EdgeDetailView {...props} sourceCount={2} dependencyCount={3} />);
    expect(container.textContent).toContain('2 source fields · 1 dependent field · 3 dependencies');
    buttonLabelled(container, 'score').click();
    expect(props.onSelect).toHaveBeenCalledWith('score');
    buttonLabelled(container, 'Show these fields in the field graph').click();
    expect(props.onShowFields).toHaveBeenCalledOnce();
  });
});

describe('DetailPanelView', () => {
  it('renders its content and closes', () => {
    const onClose = vi.fn();
    const container = renderComponent(() => <DetailPanelView onClose={onClose}><p id="inner">hello</p></DetailPanelView>);
    expect(container.querySelector('#detail #inner')).not.toBeNull();
    buttonLabelled(container, '✕ close').click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
