import { describe, it, expect, vi } from 'vitest';
import {
  bracketLabel,
  BRACKET_LABELS,
  isStaxPiece,
  isFastMana,
  isGameChangerCard,
  isMassLandDenialFloor,
  isTutor,
  type RoleKey,
  type TagLookup,
} from './index';

/**
 * A TagLookup built from plain data. The estimator suites drive the seam with
 * vi.fn() mocks; this one exercises the exported predicates directly, including
 * the two that only exist so callers gate on the SAME signal the estimator
 * counts (isMassLandDenialFloor, isTutor) rather than re-inlining the check.
 */
function lookup(opts: {
  tags?: Record<string, string[]>;
  roles?: Record<string, RoleKey>;
  mld?: string[];
  extraTurns?: string[];
}): TagLookup {
  return {
    hasTag: (name, tag) => (opts.tags?.[tag] ?? []).includes(name),
    getCardRole: (name) => opts.roles?.[name] ?? null,
    isMassLandDenial: (name) => (opts.mld ?? []).includes(name),
    isExtraTurn: (name) => (opts.extraTurns ?? []).includes(name),
  };
}

describe('bracketLabel', () => {
  it('names each of the five brackets', () => {
    expect(bracketLabel(1)).toBe('Exhibition');
    expect(bracketLabel(2)).toBe('Core');
    expect(bracketLabel(3)).toBe('Upgraded');
    expect(bracketLabel(4)).toBe('Optimized');
    expect(bracketLabel(5)).toBe('cEDH');
    expect(Object.keys(BRACKET_LABELS)).toHaveLength(5);
  });

  it('falls back to the number for an out-of-range bracket', () => {
    expect(bracketLabel(0)).toBe('0');
    expect(bracketLabel(9)).toBe('9');
  });
});

describe('isStaxPiece', () => {
  it('matches curated lock pieces', () => {
    expect(isStaxPiece('Winter Orb')).toBe(true);
    expect(isStaxPiece('Null Rod')).toBe(true);
  });

  it('does NOT match single-bodied hatebears, which live in casual decks', () => {
    // Deliberately excluded (audit P2 #8) — counting three of these as a "stax
    // strategy" over-rated fair white/blue decks into Bracket 3.
    expect(isStaxPiece('Thalia, Guardian of Thraben')).toBe(false);
    expect(isStaxPiece('Esper Sentinel')).toBe(false);
  });
});

describe('isFastMana', () => {
  it('matches the fast-mana pool', () => {
    expect(isFastMana('Mana Crypt')).toBe(true);
    expect(isFastMana('Jeweled Lotus')).toBe(true);
  });

  it('excludes Sol Ring — a precon staple allowed in brackets 1-2', () => {
    expect(isFastMana('Sol Ring')).toBe(false);
  });
});

describe('isGameChangerCard', () => {
  it('reads membership from the injected set', () => {
    const gc = new Set(['Thassa’s Oracle']);
    expect(isGameChangerCard('Thassa’s Oracle', gc)).toBe(true);
    expect(isGameChangerCard('Llanowar Elves', gc)).toBe(false);
  });
});

describe('isMassLandDenialFloor', () => {
  it('counts a tagged mass-land-denial card', () => {
    const tags = lookup({ mld: ['Armageddon'] });
    expect(isMassLandDenialFloor('Armageddon', tags)).toBe(true);
  });

  it('subtracts the curated upstream false positives', () => {
    // The Scryfall tag sweeps in a planeswalker whose -15 is a one-sided wipe,
    // not land denial. MLD is the harshest floor (-> Bracket 4), so one bad tag
    // turned a Bracket 2 precon into Bracket 4 (E48).
    const tags = lookup({ mld: ['Gideon, Champion of Justice', 'Damping Sphere'] });
    expect(isMassLandDenialFloor('Gideon, Champion of Justice', tags)).toBe(false);
    expect(isMassLandDenialFloor('Damping Sphere', tags)).toBe(false);
  });

  it('is false when the tag data has no opinion', () => {
    expect(isMassLandDenialFloor('Armageddon', lookup({}))).toBe(false);
  });
});

describe('isTutor', () => {
  it('requires BOTH the tutor tag and a cardDraw primary role', () => {
    const tags = lookup({
      tags: { tutor: ['Demonic Tutor', 'Cultivate'] },
      roles: { 'Demonic Tutor': 'cardDraw', Cultivate: 'ramp' },
    });
    expect(isTutor('Demonic Tutor', tags)).toBe(true);
    // Cultivate carries the tutor tag but is primarily ramp, not tutoring.
    expect(isTutor('Cultivate', tags)).toBe(false);
  });

  it('is false for an untagged card', () => {
    expect(isTutor('Llanowar Elves', lookup({}))).toBe(false);
  });
});

describe('TagLookup injection', () => {
  it('never reaches for a module-global — every signal comes from the parameter', () => {
    // The whole point of the seam: on a server the frontend tagger client's
    // `tagSets` is null and every predicate there returns false, which would
    // silently mis-score decks rather than throw. A caller-supplied lookup is
    // the only source, so a stub with no data yields no signal, and a stub with
    // data yields signal, with nothing ambient in between.
    const spy = vi.fn<(name: string, tag: string) => boolean>().mockReturnValue(true);
    const tags: TagLookup = {
      hasTag: spy,
      getCardRole: () => 'cardDraw',
      isMassLandDenial: () => false,
      isExtraTurn: () => false,
    };
    expect(isTutor('Any Card', tags)).toBe(true);
    expect(spy).toHaveBeenCalledWith('Any Card', 'tutor');
  });
});
