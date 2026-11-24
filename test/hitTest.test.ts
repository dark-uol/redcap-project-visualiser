import { describe, expect, it } from 'vitest';
import { resolveClick } from '../src/components/hitTest';
import { graphvizSvg, makeView, node } from './fixtures';

const isForm = (id: string) => ['f1', 'f2'].includes(id);
const target = (sel: string) => graphvizSvg().querySelector(sel);

describe('resolveClick', () => {
  it('selects the clicked node by its full id', () => {
    const view = makeView({ nodes: [node('x@@1'), node('y'), node('z')] });
    expect(resolveClick(target('g.node text'), view, isForm)).toEqual({ type: 'select', id: 'x@@1' });
  });

  it('ignores a node whose key is outside the view', () => {
    expect(resolveClick(target('g.node'), makeView({ nodes: [] }), isForm)).toEqual({ type: 'none' });
  });

  describe('form-level edges', () => {
    const forms = makeView({
      level: 'form',
      nodes: [node('f1', { kind: 'form', form: 'f1' }), node('f2', { kind: 'form', form: 'f2' }), node('c')],
    });
    it('selects the edge between two forms', () => {
      expect(resolveClick(target('g.edge'), forms, isForm)).toEqual({ type: 'edge', from: 'f1', to: 'f2' });
    });
    it('does not select an edge whose end is a field', () => {
      const svg = graphvizSvg();
      expect(resolveClick(svg.querySelectorAll('g.edge')[1], forms, isForm)).toEqual({ type: 'none' });
    });
    it('ignores edges at other levels', () => {
      expect(resolveClick(target('g.edge'), makeView({ level: 'field' }), isForm)).toEqual({ type: 'none' });
    });
  });

  describe('clusters', () => {
    const groups = [{ id: 'f1', label: 'F1', nodes: ['a'] }];
    it('selects the form box in a field-level view', () => {
      expect(resolveClick(target('g.cluster'), makeView({ groups }), isForm)).toEqual({ type: 'select', id: '@form:f1' });
    });
    it('selects the plain group id in a mixed view', () => {
      expect(resolveClick(target('g.cluster'), makeView({ level: 'form', mixed: true, groups }), isForm))
        .toEqual({ type: 'select', id: 'f1' });
    });
    it('ignores noSelect groups and form-level views', () => {
      expect(resolveClick(target('g.cluster'), makeView({ groups: [{ ...groups[0], noSelect: true }] }), isForm)).toEqual({ type: 'none' });
      expect(resolveClick(target('g.cluster'), makeView({ level: 'form', groups }), isForm)).toEqual({ type: 'clear' });
    });
  });

  it('clears on empty background', () => {
    expect(resolveClick(graphvizSvg(), makeView(), isForm)).toEqual({ type: 'clear' });
    expect(resolveClick(null, makeView(), isForm)).toEqual({ type: 'clear' });
  });

  it('does not clear when clicking an edge that is not selectable', () => {
    expect(resolveClick(target('g.edge'), makeView(), isForm)).toEqual({ type: 'none' });
  });
});
