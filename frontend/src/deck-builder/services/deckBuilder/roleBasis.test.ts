import { describe, expect, it } from 'vitest';
import { Archetype } from '@/deck-builder/types';
import {
  getBaseRoleTargets,
  getDynamicRoleTargets,
  USE_MEASURED_ROLE_BASELINE,
} from './roleTargets';
import { bracketReference, roleBasisRows } from './roleBasis';

describe('generator role targets are untouched by the display references (roadmap 3.3)', () => {
  // Literal numbers, captured before roleBasis.ts existed. If one moves, the
  // generator's targets moved: that is a change behind the ship gate (5.4c moved the 99 base).
  it('getBaseRoleTargets keeps its numbers for every format size', () => {
    // 5.4c: the 99-card base is the measured median of 93 EDHREC average decks
    // (08 section 4.1: ramp 10, spot removal 8, sweepers 2, draw 9).
    expect(getBaseRoleTargets(99)).toEqual({ ramp: 10, removal: 8, boardwipe: 2, cardDraw: 9 });
    expect(getBaseRoleTargets(60)).toEqual({ ramp: 4, removal: 5, boardwipe: 2, cardDraw: 4 });
    expect(getBaseRoleTargets(40)).toEqual({ ramp: 2, removal: 3, boardwipe: 1, cardDraw: 2 });
    expect(getBaseRoleTargets(20)).toEqual({ ramp: 2, removal: 2, boardwipe: 1, cardDraw: 2 });
  });

  it('getDynamicRoleTargets keeps its numbers without EDHREC data', () => {
    const goodstuff = getDynamicRoleTargets(99, undefined, undefined, null, null, null);
    expect(goodstuff.targets).toEqual(GOODSTUFF_99);
    const control = getDynamicRoleTargets(
      99,
      undefined,
      undefined,
      null,
      null,
      null,
      Archetype.CONTROL
    );
    expect(control.targets).toEqual(CONTROL_99);
  });
});

describe('roleBasisRows', () => {
  it('pairs the target with the three references in panel order', () => {
    const rows = roleBasisRows(
      { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
      { ramp: 12, removal: 4, boardwipe: 1, cardDraw: 9 }
    );
    expect(rows.map((r) => r.role)).toEqual(['ramp', 'removal', 'boardwipe', 'cardDraw']);
    expect(rows[0]).toMatchObject({ target: 10, commander: 12, expert: 10 });
    expect(rows[0]!.baseline).toEqual({ median: 10, q1: 7, q3: 14 });
  });

  it('reads the commander count as unknown when the deck has no EDHREC page', () => {
    expect(roleBasisRows({} as never, null).every((r) => r.commander === null)).toBe(true);
  });
});

describe('bracketReference', () => {
  it('groups brackets 1 to 3 and separates 4 and 5', () => {
    expect(bracketReference(1)).toEqual(bracketReference(3));
    expect(bracketReference(4).lands).toBe('33 to 34');
    expect(bracketReference(5).tutors).toBe('8 to 10');
  });
});

const GOODSTUFF_99 = { ramp: 10, removal: 8, boardwipe: 2, cardDraw: 9 };
const CONTROL_99 = { ramp: 9, removal: 10, boardwipe: 3, cardDraw: 10 };

describe('USE_MEASURED_ROLE_BASELINE (5.4c)', () => {
  it('is on, and the 99 base matches the 08 section 4.1 medians', () => {
    expect(USE_MEASURED_ROLE_BASELINE).toBe(true);
    const base = getBaseRoleTargets(99);
    // EDHREC average decks, n=93: ramp 10, spot removal 8, sweepers 2, draw 9.
    expect([base.ramp, base.removal, base.boardwipe, base.cardDraw]).toEqual([10, 8, 2, 9]);
  });
});
