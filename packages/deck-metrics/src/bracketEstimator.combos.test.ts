/**
 * Combo relevance, hub-aware redundancy and the commander-as-piece signal.
 *
 * The fixtures are real Spellbook combos with the tags the dataset carries,
 * taken from a run of the estimator over all 197 MTGJSON Commander precons
 * (2026-09-23). Before these rules, 8 precons read as Bracket 4 and 36 as
 * Bracket 3; each case below is one of the false floors that run found.
 */
import { describe, it, expect } from 'vitest';
import type { BracketEstimation, DetectedCombo, TagLookup } from './index';
import {
  bracketReasons,
  countsTowardComboFloor,
  needsUnnamedCard,
  estimateBracket,
  floorOf,
  softScorePoints,
} from './index';

const noTags: TagLookup = {
  hasTag: () => false,
  getCardRole: () => null,
  isMassLandDenial: () => false,
  isExtraTurn: () => false,
};

function sb(cards: string[], bracketTag: string | null): DetectedCombo {
  return {
    comboId: cards.join('+'),
    cards,
    results: [],
    isComplete: true,
    missingCards: [],
    deckCount: 0,
    bracket: null,
    bracketTag,
    cardCount: cards.length,
  };
}

function estimate(
  combos: DetectedCombo[],
  opts: { commanders?: string[]; tutors?: number } = {}
): BracketEstimation {
  const tutorNames = Array.from({ length: opts.tutors ?? 0 }, (_, i) => `Tutor ${i}`);
  const tags: TagLookup = {
    ...noTags,
    hasTag: (name, tag) => tag === 'tutor' && tutorNames.includes(name),
    getCardRole: (name) => (tutorNames.includes(name) ? 'cardDraw' : null),
  };
  const names = [...new Set([...combos.flatMap((c) => c.cards), ...tutorNames])];
  return estimateBracket(names, combos, 3.4, undefined, {}, new Set(), tags, opts.commanders);
}

describe('Spellbook-tagged combo relevance', () => {
  it('an Exhibition loop sets no floor (Hullbreaker Horror + Sol Ring, Fae Dominion)', () => {
    const r = estimate([sb(['Hullbreaker Horror', 'Sol Ring'], 'E')]);
    expect(r.bracket).toBe(2);
    expect(r.hardFloors).toEqual([]);
    expect(r.breakdown.twoCardComboCount).toBe(0);
    expect(r.breakdown.lowPowerComboCount).toBe(1);
  });

  it('seven Exhibition/Core combos stay Core (Everyone’s Invited! read as Bracket 4)', () => {
    const r = estimate([
      sb(['The World Tree', 'Maskwood Nexus'], 'C'),
      sb(['The World Tree', 'Arcane Adaptation'], 'C'),
      sb(['The World Tree', 'Rukarumel, Biologist'], 'C'),
      sb(['Realmbreaker, the Invasion Tree', 'Maskwood Nexus'], 'E'),
      sb(['Realmbreaker, the Invasion Tree', 'Arcane Adaptation'], 'E'),
      sb(['Realmbreaker, the Invasion Tree', 'Rukarumel, Biologist'], 'E'),
      sb(['Moritte of the Frost'], 'E'),
    ]);
    expect(r.bracket).toBe(2);
    expect(r.breakdown.lowPowerComboCount).toBe(7);
  });

  it('a Spicy two-card combo still floors at 3 (Lightning Runner + Aetherwind Basker)', () => {
    const r = estimate([sb(['Lightning Runner', 'Aetherwind Basker'], 'S')]);
    expect(r.bracket).toBe(3);
    expect(r.breakdown.comboPieceNames).toEqual(['Lightning Runner', 'Aetherwind Basker']);
  });

  it('an untagged combo counts, so a stale dataset never under-rates', () => {
    expect(countsTowardComboFloor(sb(['A', 'B'], null))).toBe(true);
    expect(countsTowardComboFloor(sb(['A', 'B'], 'C'))).toBe(false);
    expect(countsTowardComboFloor({ ...sb(['A', 'B'], 'R'), isComplete: false })).toBe(false);
  });

  it('a variant that also needs an unnamed template card sets no floor (Quick Draw)', () => {
    // 5534--28: Stella Lee, Wild Card + "an instant or sorcery that untaps a creature".
    const stella = { ...sb(['Stella Lee, Wild Card'], 'S'), comboId: '5534--28' };
    expect(needsUnnamedCard(stella)).toBe(true);
    expect(needsUnnamedCard(sb(['A', 'B'], 'S'))).toBe(false);
    const r = estimate([stella]);
    expect(r.bracket).toBe(2);
    expect(r.breakdown.twoCardComboCount).toBe(0);
  });
});

describe('hub-aware combo redundancy', () => {
  const gorma = [
    sb(['Gorma, the Gullet', 'Yahenni, Undying Partisan'], 'O'),
    sb(['Umbral Collar Zealot', 'Gorma, the Gullet'], 'S'),
    sb(['Viscera Seer', 'Gorma, the Gullet'], 'O'),
    sb(['Woe Strider', 'Gorma, the Gullet'], 'O'),
  ];

  it('four combos through one non-commander card are one line (Witherbloom Pestilence)', () => {
    const r = estimate(gorma, { commanders: ['Dina, Essence Brewer'] });
    expect(r.bracket).toBe(3);
    expect(r.breakdown.twoCardComboCount).toBe(4);
    expect(r.breakdown.comboPieceNames).toHaveLength(5);
  });

  it('the same four combos through the COMMANDER are redundant: it is always there', () => {
    const r = estimate(gorma, { commanders: ['Gorma, the Gullet'] });
    expect(r.bracket).toBe(4);
    expect(r.hardFloors[0].detail).toContain('independent combo lines');
  });

  it('four combos with distinct pieces are still redundant', () => {
    const r = estimate([
      sb(['A1', 'B1'], null),
      sb(['A2', 'B2'], null),
      sb(['A3', 'B3'], null),
      sb(['A4', 'B4'], null),
    ]);
    expect(r.bracket).toBe(4);
  });
});

// Ruling of 2026-09-23: match Commander Spellbook, which rates every combo of
// the commander plus up to two more cards Ruthless (Creative Energy, Jump Scare!).
describe('commander as a combo piece', () => {
  const satya = sb(['Satya, Aetherflux Genius', 'Lightning Runner'], 'S');

  it('commander + one card floors at 4 with no tutors (Creative Energy)', () => {
    const r = estimate([satya], { commanders: ['Satya, Aetherflux Genius'] });
    expect(r.bracket).toBe(4);
    expect(r.hardFloors[0].reason).toBe('1 two-card combo with your commander');
    expect(r.hardFloors[0].detail).toBe(
      'Early assembly is likely: your commander is a combo piece, so the deck only has to draw the rest. Bracket 3 allows two-card combos only when they come together late.'
    );
  });

  it('commander + two cards floors at 4 on its own (one Jump Scare! line)', () => {
    const zimone = sb(
      ['Zimone, Mystery Unraveler', 'Yedora, Grave Gardener', 'Sakura-Tribe Elder'],
      'S'
    );
    expect(estimate([zimone], { commanders: ['Zimone, Mystery Unraveler'] }).bracket).toBe(4);
    // The same three cards without the commander are a lone multi-card combo: no floor.
    expect(estimate([zimone]).bracket).toBe(2);
  });

  it('commander + three cards is not a commander combo', () => {
    const r = estimate([sb(['Cmdr', 'A', 'B', 'C'], 'S')], { commanders: ['Cmdr'] });
    expect(r.bracket).toBe(2);
  });

  it('the same combo without the commander in it stays at 3', () => {
    expect(estimate([satya]).bracket).toBe(3);
  });
});

// Ruling of 2026-09-23: count what Commander Spellbook's land-denial list counts.
describe('mass land denial matches Spellbook', () => {
  it.each(['Whims of the Fates', 'Gideon, Champion of Justice'])('%s floors at 4', (card) => {
    const r = estimateBracket([card], [], 3, undefined, {}, new Set(), {
      ...noTags,
      isMassLandDenial: () => true,
    });
    expect(r.breakdown.massLandDenialNames).toEqual([card]);
    expect(r.bracket).toBe(4);
  });
});

describe('explainability helpers', () => {
  it('floorOf is the strongest floor, or Core with none', () => {
    expect(floorOf([])).toBe(2);
    expect(
      floorOf([
        { bracket: 3, reason: '' },
        { bracket: 4, reason: '' },
      ])
    ).toBe(4);
  });

  it('bracketReasons lists floors strongest first, then a power-signal lift', () => {
    const est = {
      bracket: 4,
      label: 'Optimized',
      softScore: 70,
      hardFloors: [
        { bracket: 3, reason: '1 Game Changer card' },
        { bracket: 3, reason: '1 two-card combo' },
      ],
    } as BracketEstimation;
    expect(bracketReasons(est)).toEqual([
      '1 Game Changer card',
      '1 two-card combo',
      'power signal 70/100',
    ]);
    const mld = {
      ...est,
      hardFloors: [...est.hardFloors, { bracket: 4, reason: 'Mass land denial (Armageddon)' }],
    } as BracketEstimation;
    expect(bracketReasons(mld)[0]).toBe('Mass land denial (Armageddon)');
    expect(bracketReasons(mld)).not.toContain('power signal 70/100');
  });

  it('softScorePoints matches the estimator’s own total', () => {
    const r = estimateBracket(
      ['Mana Vault', 'Chrome Mox'],
      [],
      2.5,
      undefined,
      {},
      new Set(),
      noTags
    );
    expect(softScorePoints(r.breakdown)).toEqual({
      fastMana: 16,
      tutors: 0,
      curve: 15,
      engines: 0,
    });
    expect(r.softScore).toBe(31);
  });
});

// A loop that doesn't end the game sets no floor, but a deck that can draw its
// library is stronger than one that can't. The Ulamog deck that raised this ran
// all three of these (Spellbook: E, "Infinite card draw").
describe('loop combos add to the power signal as combo engines', () => {
  const top = "Sensei's Divining Top";
  const ulamogLoops = [
    sb([top, 'Foundry Inspector', 'Mystic Forge'], 'E'),
    sb([top, 'Mystic Forge', 'Ugin, the Ineffable'], 'E'),
    sb([top, 'Echoes of Eternity', 'Foundry Inspector'], 'E'),
  ];

  it('three loops through the Top are one engine: 10 points, no floor', () => {
    const without = estimate([]);
    const r = estimate(ulamogLoops);
    expect(r.hardFloors).toEqual([]);
    expect(r.bracket).toBe(2);
    expect(r.breakdown.loopEngineCount).toBe(1);
    expect(r.breakdown.loopCombos).toEqual(ulamogLoops.map((c) => c.cards));
    expect(r.softScore - without.softScore).toBe(10);
  });

  it('independent loops add up, capped at 20', () => {
    const r = estimate([
      sb(['A1', 'B1', 'C1'], 'E'),
      sb(['A2', 'B2', 'C2'], 'C'),
      sb(['A3', 'B3', 'C3'], 'E'),
    ]);
    expect(r.breakdown.loopEngineCount).toBe(3);
    expect(softScorePoints(r.breakdown).engines).toBe(20);
  });

  it('a template variant is neither a floor nor an engine', () => {
    const r = estimate([
      { ...sb(['Hullbreaker Horror', 'Sol Ring'], 'E'), comboId: '513-5034--46' },
    ]);
    expect(r.breakdown.loopEngineCount).toBe(0);
    expect(r.breakdown.lowPowerComboCount).toBe(0);
  });

  it('a combo that sets a floor is not also an engine', () => {
    const r = estimate([sb(['Lightning Runner', 'Aetherwind Basker'], 'S')]);
    expect(r.bracket).toBe(3);
    expect(r.breakdown.loopEngineCount).toBe(0);
  });
});
