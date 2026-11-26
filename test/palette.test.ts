import { describe, expect, it } from 'vitest';
import { colourDistance, contrastRatio, type Deficiency } from '../src/lib/colour';
import { TYPES } from '../src/lib/graph';

const CROSS_ARM_RED = '#dc2626';
const DEFICIENCIES: Deficiency[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];
/** CIEDE2000 floor, with margin below the measured minimum (11.5). A just-noticeable difference is about 2.3. */
const MINIMUM_DISTANCE = 9;
/** WCAG non-text contrast against the white stage. */
const MINIMUM_CONTRAST = 2.95;

const typeColours = Object.entries(TYPES).map(([type, meta]) => ({ type, colour: meta.color }));
const everyColour = [...typeColours, { type: 'crossArm', colour: CROSS_ARM_RED }];

describe('dependency type palette', () => {
  it('measures colours sensibly (sanity of the helper)', () => {
    expect(colourDistance('#000000', '#ffffff')).toBeGreaterThan(90);
    expect(colourDistance('#336699', '#336699')).toBeCloseTo(0, 6);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    // Pure red and green collapse for a red-green deficient viewer, but not for normal vision.
    expect(colourDistance('#ff0000', '#00ff00', 'deuteranopia')).toBeLessThan(colourDistance('#ff0000', '#00ff00'));
  });

  for (const deficiency of DEFICIENCIES) {
    it(`keeps every pair apart under ${deficiency} vision, including the cross-arm red`, () => {
      for (let first = 0; first < everyColour.length; first++) {
        for (let second = first + 1; second < everyColour.length; second++) {
          const distance = colourDistance(everyColour[first].colour, everyColour[second].colour, deficiency);
          expect(distance, `${everyColour[first].type} vs ${everyColour[second].type}`).toBeGreaterThanOrEqual(MINIMUM_DISTANCE);
        }
      }
    });
  }

  it('keeps each colour visible as a thin line on white', () => {
    for (const { type, colour } of typeColours) {
      expect(contrastRatio(colour, '#ffffff'), type).toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
    }
  });
});
