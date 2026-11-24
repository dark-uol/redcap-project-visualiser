import { describe, expect, it } from 'vitest';
import { groupFormIdOf, groupIdFor, instanceFieldIdFor, instanceIdFor, isInstanceScopedId, parseSelection } from '../src/lib/selection';

describe('parseSelection', () => {
  it('reads a form box id as a group', () => {
    expect(parseSelection('@form:demographics')).toEqual({ kind: 'group', formId: 'demographics' });
  });

  it('gives an empty form id for a bare group prefix', () => {
    expect(parseSelection('@form:')).toEqual({ kind: 'group', formId: '' });
  });

  it('splits an instance-expanded field at the first @@', () => {
    expect(parseSelection('age@@event_1_arm_1')).toEqual({ kind: 'instanceField', variable: 'age', instanceId: 'event_1_arm_1' });
  });

  it('keeps any later @@ inside the instance id', () => {
    expect(parseSelection('age@@a@@b')).toEqual({ kind: 'instanceField', variable: 'age', instanceId: 'a@@b' });
  });

  it('keeps a single @ inside the variable', () => {
    expect(parseSelection('a@b@@1')).toEqual({ kind: 'instanceField', variable: 'a@b', instanceId: '1' });
  });

  it('allows an empty instance id after @@', () => {
    expect(parseSelection('age@@')).toEqual({ kind: 'instanceField', variable: 'age', instanceId: '' });
  });

  it('treats a leading @@ as a plain id (separator must follow a name)', () => {
    expect(parseSelection('@@x')).toEqual({ kind: 'plain', id: '@@x' });
  });

  it('reads a plain field or form id as plain', () => {
    expect(parseSelection('weight')).toEqual({ kind: 'plain', id: 'weight' });
    expect(parseSelection('(unknown)')).toEqual({ kind: 'plain', id: '(unknown)' });
  });

  it('reads a single @ as plain', () => {
    expect(parseSelection('a@b')).toEqual({ kind: 'plain', id: 'a@b' });
  });

  it('reads the empty string as plain', () => {
    expect(parseSelection('')).toEqual({ kind: 'plain', id: '' });
  });

  it('reads a form-prefix lookalike without the colon as plain', () => {
    expect(parseSelection('@form-demographics')).toEqual({ kind: 'plain', id: '@form-demographics' });
  });

  it('gives group precedence over the instance separator', () => {
    expect(parseSelection('@form:f@@1')).toEqual({ kind: 'group', formId: 'f@@1' });
  });
});

describe('groupIdFor', () => {
  it('round-trips through parseSelection', () => {
    expect(parseSelection(groupIdFor('visit'))).toEqual({ kind: 'group', formId: 'visit' });
  });
});

describe('instanceFieldIdFor', () => {
  it('round-trips through parseSelection', () => {
    expect(parseSelection(instanceFieldIdFor('age', 'demographics@baseline')))
      .toEqual({ kind: 'instanceField', variable: 'age', instanceId: 'demographics@baseline' });
  });
});

describe('groupFormIdOf', () => {
  it('returns the form id for a form box id', () => {
    expect(groupFormIdOf(groupIdFor('visit'))).toBe('visit');
  });

  it('returns null for anything else', () => {
    expect(groupFormIdOf('age')).toBeNull();
    expect(groupFormIdOf('age@@f@e')).toBeNull();
    expect(groupFormIdOf('f@e')).toBeNull();
  });
});

describe('instanceIdFor', () => {
  it('joins form and event with a single @', () => {
    expect(instanceIdFor('baseline', 'visit_1_arm_1')).toBe('baseline@visit_1_arm_1');
  });
});

describe('isInstanceScopedId', () => {
  it('is true for an instance node id', () => {
    expect(isInstanceScopedId(instanceIdFor('baseline', 'visit_1'))).toBe(true);
  });

  it('is true for a field expanded inside an instance', () => {
    expect(isInstanceScopedId(instanceFieldIdFor('age', instanceIdFor('baseline', 'visit_1')))).toBe(true);
  });

  it('is false for a form box, even when the form id contains @', () => {
    expect(isInstanceScopedId(groupIdFor('baseline'))).toBe(false);
    expect(isInstanceScopedId('@form:a@b')).toBe(false);
  });

  it('is false for plain field, form, event and unknown ids', () => {
    expect(isInstanceScopedId('age')).toBe(false);
    expect(isInstanceScopedId('baseline')).toBe(false);
    expect(isInstanceScopedId('(unknown)')).toBe(false);
    expect(isInstanceScopedId('')).toBe(false);
  });
});
