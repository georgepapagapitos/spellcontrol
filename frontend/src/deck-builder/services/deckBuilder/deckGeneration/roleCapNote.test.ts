// @vitest-environment node
//
// The deck's own roleCapOverflowNote and the build report's must agree about
// the "See Overbuilt roles" pointer (E513 round 3: Meren's allNotes copy kept
// it while the report's, with roleExcesses empty after the search, dropped it).
import { describe, expect, it } from 'vitest';
import { buildRoleCapOverflowNote, withoutDanglingPointer } from './roleCapNote';

describe('withoutDanglingPointer', () => {
  const note = buildRoleCapOverflowNote({ ramp: 2 });

  it('drops the pointer when no role is overbuilt in the final counts (Meren ramp 16 → 14 of 11)', () => {
    expect(note).toMatch(/See Overbuilt roles for the total\.$/);
    expect(withoutDanglingPointer(note, { ramp: 11 }, { ramp: 14 })).toBe(
      '2 cards went past a role cap. The ramp pool was thin.'
    );
  });

  it('keeps it where the report lists an overbuilt role', () => {
    expect(withoutDanglingPointer(note, { ramp: 11 }, { ramp: 16 })).toBe(note);
  });

  it('passes an absent note or absent targets through', () => {
    expect(withoutDanglingPointer(undefined, { ramp: 11 }, { ramp: 14 })).toBeUndefined();
    expect(withoutDanglingPointer(note, undefined, undefined)).toBe(note);
  });
});
