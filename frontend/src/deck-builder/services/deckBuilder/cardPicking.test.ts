import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  calculateCardPriority,
  isHighSynergyCard,
  mergeWithAllNonLand,
  pickFromPrefetched,
  pickFromPrefetchedWithCurve,
  OWNED_PRIORITY_BOOST,
  OWNED_PRIORITY_BOOST_THEME_TIER,
  wipeQualityPenalty,
  WIPE_QUALITY_SYMMETRIC_PENALTY,
  WIPE_QUALITY_COLLATERAL_BASE,
  WIPE_QUALITY_COLLATERAL_SCALE,
  SYNERGY_STRENGTH_POINTS,
} from './cardPicking';
import { synergyStrength } from './synergyLift';
import { BracketGuard, bracketCeilings } from './bracketGuard';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import { isOneSidedWipe, getWipeScope, type RoleKey } from '@/deck-builder/services/tagger/client';

function ec(overrides: Partial<EDHRECCard> = {}): EDHRECCard {
  return {
    name: 'Card',
    sanitized: 'card',
    primary_type: 'Creature',
    inclusion: 10,
    num_decks: 100,
    ...overrides,
  };
}

function sc(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

// Real EDHREC rows (json.edhrec.com, cached 2026-09-29), built the way
// edhrec/client.ts parseCard builds them: `n` = num_decks, `N` =
// potential_decks, synergy verbatim. Meren of Clan Nel Toth unless noted;
// isThemeSynergyCard marks the rows EDHREC lists as highsynergycards/topcards.
function edhrecRow(
  name: string,
  n: number,
  N: number,
  synergy: number,
  overrides: Partial<EDHRECCard> = {}
): EDHRECCard {
  return ec({
    name,
    inclusion: (n / N) * 100,
    num_decks: n,
    potential_decks: N,
    synergy,
    ...overrides,
  });
}
const theme = { isThemeSynergyCard: true };
const SPORE_FROG = edhrecRow('Spore Frog', 16855, 22305, 0.7009745070406005, theme);
const GRIM_HARUSPEX = edhrecRow('Grim Haruspex', 11022, 22305, 0.4571132790947646, theme);
const SAKURA_TRIBE_ELDER = edhrecRow('Sakura-Tribe Elder', 18523, 22305, 0.5470536716623432, theme);
const BLOOD_ARTIST = edhrecRow('Blood Artist', 12167, 22305, 0.33493362872713894, theme);
const PROTEAN_HULK = edhrecRow('Protean Hulk', 10245, 22305, 0.4153820889704169);
const RAZAKETH = edhrecRow('Razaketh, the Foulblooded', 2967, 22305, 0.11960339495693278);
const SOL_RING = edhrecRow('Sol Ring', 19037, 22305, 0.06115836069838243);
const HEROIC_INTERVENTION = edhrecRow('Heroic Intervention', 3789, 22305, -0.1513924847323302);
// Sythis, Harvest's Hand
const OVERGROWTH = edhrecRow('Overgrowth', 4519, 14250, 0.28031627345224963);
const RELIQUARY_TOWER = edhrecRow('Reliquary Tower', 8495, 14250, 0.315);
const CULTIVATE = edhrecRow('Cultivate', 2238, 14250, -0.25957261349878713);
// Edgar Markov x Vampires (6,006 decks), topcards list: 64% vs 29.3%, 2.2x.
// A high-play, moderate-lift core the first E510 cut shipped without.
const SKULLCLAMP = edhrecRow('Skullclamp', 3845, 6006, 0.3471333891245901, theme);
// Gisa, Glorious Resurrector (1,638 decks): 12.5% vs 1.0% and 41.9% vs 18.7%.
const ERADICATOR_VALKYRIE = edhrecRow('Eradicator Valkyrie', 204, 1638, 0.11460148181266158);
const TRAGIC_SLIP = edhrecRow('Tragic Slip', 687, 1638, 0.2322126487214503);

const ALL_ROWS = [
  SPORE_FROG,
  GRIM_HARUSPEX,
  SAKURA_TRIBE_ELDER,
  BLOOD_ARTIST,
  PROTEAN_HULK,
  RAZAKETH,
  SOL_RING,
  HEROIC_INTERVENTION,
  OVERGROWTH,
  RELIQUARY_TOWER,
  CULTIVATE,
  SKULLCLAMP,
  ERADICATOR_VALKYRIE,
  TRAGIC_SLIP,
];
const DIAL = [0, 0.25, 0.5, 0.75, 1];

// The formula calculateCardPriority used before E510, verbatim.
function priorityBeforeE510(card: EDHRECCard, brewLevel: number): number {
  const synergy = card.synergy ?? 0;
  const inclusionMul = brewLevel <= 0.5 ? 1 + 2 * (0.5 - brewLevel) : 1 - 1.5 * (brewLevel - 0.5);
  const synergyMul = brewLevel <= 0.5 ? 2 * brewLevel : 1 + 2.4 * (brewLevel - 0.5);
  const floor = 100 * Math.min(1, 2 * brewLevel);
  if (card.isThemeSynergyCard)
    return floor + synergy * 50 * synergyMul + card.inclusion * inclusionMul;
  const newCardBoost = card.isNewCard ? 25 : 0;
  if (synergy > 0.3)
    return synergy * 100 * synergyMul + card.inclusion * inclusionMul + newCardBoost;
  return card.inclusion * inclusionMul + newCardBoost;
}

const ratioTerm = (card: EDHRECCard) => SYNERGY_STRENGTH_POINTS * synergyStrength(card);

describe('calculateCardPriority', () => {
  it('(a) never scores a card the old formula ranked below its old priority, at any dial stop', () => {
    const oldTier = ALL_ROWS.filter((c) => c.isThemeSynergyCard || (c.synergy ?? 0) > 0.3);
    expect(oldTier.length).toBeGreaterThanOrEqual(7);
    for (const card of oldTier) {
      for (const b of DIAL) {
        expect(calculateCardPriority(card, b)).toBeGreaterThanOrEqual(
          priorityBeforeE510(card, b) - 1e-9
        );
      }
    }
  });

  it('keeps Skullclamp-shaped cores (64% vs 29%) exactly where they were', () => {
    // Half its ratio reading (30 x 0.72 / 2 = 10.8) is below the old theme
    // term (0.347 x 50 = 17.4), which stays the floor.
    expect(ratioTerm(SKULLCLAMP) / 2).toBeLessThan(SKULLCLAMP.synergy! * 50);
    expect(calculateCardPriority(SKULLCLAMP)).toBeCloseTo(priorityBeforeE510(SKULLCLAMP, 0.5), 10);
  });

  it('lifts an old-tier card whose ratio reads higher than its subtraction', () => {
    // Protean Hulk: 45.9% vs 4.4%, 10.5x: 30 x 1.56 = 47 against the old 41.5.
    expect(calculateCardPriority(PROTEAN_HULK)).toBeCloseTo(
      ratioTerm(PROTEAN_HULK) + PROTEAN_HULK.inclusion,
      10
    );
    expect(calculateCardPriority(PROTEAN_HULK)).toBeGreaterThan(
      priorityBeforeE510(PROTEAN_HULK, 0.5)
    );
  });

  it('(b) no longer buries a 12%-vs-1% card: a positive term where it had none', () => {
    // Eradicator Valkyrie (+0.11, 12.4x its colours) sat under the old +0.3
    // bar, so the old formula gave it no synergy term at all.
    expect(priorityBeforeE510(ERADICATOR_VALKYRIE, 0.5)).toBeCloseTo(
      ERADICATOR_VALKYRIE.inclusion,
      10
    );
    expect(ratioTerm(ERADICATOR_VALKYRIE)).toBeGreaterThan(10);
    expect(calculateCardPriority(ERADICATOR_VALKYRIE)).toBeCloseTo(
      ERADICATOR_VALKYRIE.inclusion + ratioTerm(ERADICATOR_VALKYRIE),
      10
    );
    // And it ranks higher than before at every stop past Staples, most at Synergy.
    for (const b of [0.25, 0.5, 0.75, 1]) {
      expect(calculateCardPriority(ERADICATOR_VALKYRIE, b)).toBeGreaterThan(
        priorityBeforeE510(ERADICATOR_VALKYRIE, b)
      );
    }
    expect(
      calculateCardPriority(ERADICATOR_VALKYRIE, 1) - priorityBeforeE510(ERADICATOR_VALKYRIE, 1)
    ).toBeGreaterThan(25);
  });

  it('has no cliff below the old tier: a +0.28 card gets its full ratio term', () => {
    // Overgrowth (+0.28, 8.6×) scored nothing under the old formula.
    expect(calculateCardPriority(OVERGROWTH) - OVERGROWTH.inclusion).toBeCloseTo(
      ratioTerm(OVERGROWTH),
      10
    );
    expect(ratioTerm(OVERGROWTH)).toBeGreaterThan(25);
  });

  it('pulls a card the commander’s players avoid below its play rate, only below the old tier', () => {
    // Cultivate in Sythis: 15.7% vs 41.7% in the colours.
    expect(calculateCardPriority(CULTIVATE)).toBeLessThan(CULTIVATE.inclusion);
    expect(calculateCardPriority(HEROIC_INTERVENTION)).toBeLessThan(HEROIC_INTERVENTION.inclusion);
  });

  it('is never negative, however hard a card is avoided', () => {
    // At full Synergy, Cultivate's amplified term (30 x -0.22 x 2.2 = -14.6)
    // outweighs its damped 15.7% play rate (3.9). Budget convergence
    // shortlists by `priority >= best x band`, which picked nothing (and
    // crashed a live build) when the best candidate went negative.
    expect(ratioTerm(CULTIVATE) * 2.2 + CULTIVATE.inclusion * 0.25).toBeLessThan(0);
    for (const c of ALL_ROWS) {
      for (const b of DIAL) expect(calculateCardPriority(c, b)).toBeGreaterThanOrEqual(0);
    }
    expect(calculateCardPriority(CULTIVATE, 1)).toBe(0);
  });

  it('falls back to inclusion for a row with no synergy, plus a new-card boost', () => {
    const synthesized = ec({ name: 'Arcane Signet', inclusion: 20, num_decks: 0 });
    expect(calculateCardPriority(synthesized)).toBe(20);
    expect(calculateCardPriority({ ...synthesized, isNewCard: true })).toBe(45);
  });

  it('keeps the theme-list floor and the half-weight theme term', () => {
    // Spore Frog: half its ratio reading (30 x 2.86 / 2 = 43) beats the old
    // term (0.70 x 50 = 35).
    expect(calculateCardPriority(SPORE_FROG)).toBeCloseTo(
      100 + Math.max(SPORE_FROG.synergy! * 50, ratioTerm(SPORE_FROG) / 2) + SPORE_FROG.inclusion,
      10
    );
    expect(calculateCardPriority(SPORE_FROG)).toBeGreaterThan(calculateCardPriority(SOL_RING));
  });
});

describe('calculateCardPriority — Staples <-> Synergy dial', () => {
  it('brewLevel=0.5 (Balanced) is byte-identical to omitting the param', () => {
    for (const c of ALL_ROWS) {
      expect(calculateCardPriority(c, 0.5)).toBe(calculateCardPriority(c));
    }
  });

  it('(c) Staples (0) ranks by play rate alone: no synergy term, no theme-list floor', () => {
    for (const c of ALL_ROWS) {
      expect(calculateCardPriority(c, 0)).toBeCloseTo(c.inclusion * 2, 10);
    }
    // So at Staples the 40%-vs-20% card leads on play rate alone.
    expect(calculateCardPriority(TRAGIC_SLIP, 0)).toBeGreaterThan(
      calculateCardPriority(ERADICATOR_VALKYRIE, 0)
    );
  });

  it('Synergy (1) leads with synergy and keeps play rate as a small tie-breaker', () => {
    expect(calculateCardPriority(PROTEAN_HULK, 1)).toBeCloseTo(
      ratioTerm(PROTEAN_HULK) * 2.2 + PROTEAN_HULK.inclusion * 0.25,
      10
    );
    expect(calculateCardPriority(SPORE_FROG, 1)).toBeCloseTo(
      100 +
        Math.max(SPORE_FROG.synergy! * 50, ratioTerm(SPORE_FROG) / 2) * 2.2 +
        SPORE_FROG.inclusion * 0.25,
      10
    );
  });

  it('halfway stops sit between Balanced and the ends', () => {
    expect(calculateCardPriority(ERADICATOR_VALKYRIE, 0.25)).toBeCloseTo(
      ratioTerm(ERADICATOR_VALKYRIE) * 0.5 + ERADICATOR_VALKYRIE.inclusion * 1.5,
      10
    );
    expect(calculateCardPriority(ERADICATOR_VALKYRIE, 0.75)).toBeCloseTo(
      ratioTerm(ERADICATOR_VALKYRIE) * 1.6 + ERADICATOR_VALKYRIE.inclusion * 0.625,
      10
    );
  });

  it('is monotonic: a synergy card gains ground on a same-inclusion no-synergy card as brewLevel rises', () => {
    const noSynergy = ec({
      name: 'Arcane Signet',
      inclusion: PROTEAN_HULK.inclusion,
      num_decks: 0,
    });
    let prevGap = -Infinity;
    for (const b of DIAL) {
      const gap = calculateCardPriority(PROTEAN_HULK, b) - calculateCardPriority(noSynergy, b);
      expect(gap).toBeGreaterThan(prevGap);
      prevGap = gap;
    }
  });

  it('never lets a genuinely dead card beat a staple that is also the best synergy pick, even at full Brew', () => {
    const deadCard = ec({ synergy: 0, inclusion: 10, isNewCard: true }); // best-case dead card
    expect(calculateCardPriority(SPORE_FROG, 1)).toBeGreaterThan(
      calculateCardPriority(deadCard, 1)
    );
  });

  it('never rewards obscurity for its own sake: among two zero-synergy cards, lower inclusion still loses at every dial position', () => {
    const moreIncluded = ec({ synergy: 0, inclusion: 30 });
    const lessIncluded = ec({ synergy: 0, inclusion: 10 });
    for (const b of DIAL) {
      expect(calculateCardPriority(moreIncluded, b)).toBeGreaterThan(
        calculateCardPriority(lessIncluded, b)
      );
    }
  });
});

describe('isHighSynergyCard', () => {
  it('is true for theme-list cards, every old-tier card, and ratio signature cards', () => {
    expect(isHighSynergyCard(ec({ isThemeSynergyCard: true }))).toBe(true);
    expect(isHighSynergyCard(PROTEAN_HULK)).toBe(true);
    // +0.315 and only 2.1× its colours: stays on the old bar.
    expect(isHighSynergyCard(RELIQUARY_TOWER)).toBe(true);
    expect(isHighSynergyCard(SKULLCLAMP)).toBe(true);
    // +0.28 but 8.6× its colours: a Sythis signature card the old bar missed.
    expect(isHighSynergyCard(OVERGROWTH)).toBe(true);
  });
  it('is false for a colour staple and for no synergy', () => {
    expect(isHighSynergyCard(SOL_RING)).toBe(false);
    expect(isHighSynergyCard(TRAGIC_SLIP)).toBe(false);
    expect(isHighSynergyCard(ec({}))).toBe(false);
  });
});

describe('mergeWithAllNonLand', () => {
  it('adds only Unknown allNonLand cards not already present, sorted by priority', () => {
    const typed = [ec({ name: 'A', inclusion: 10 })];
    const allNonLand = [
      ec({ name: 'A', primary_type: 'Unknown', inclusion: 99 }), // dup name — skipped
      ec({ name: 'B', primary_type: 'Unknown', inclusion: 50 }),
      ec({ name: 'C', primary_type: 'Creature', inclusion: 80 }), // not Unknown — skipped
    ];
    const merged = mergeWithAllNonLand(typed, allNonLand);
    expect(merged.map((c) => c.name)).toEqual(['B', 'A']); // B (50) outranks A (10)
  });

  it('threads the Staples <-> Brew dial into its sort', () => {
    const pool = [SOL_RING, RAZAKETH];
    // Balanced (default): Sol Ring's play rate (85%) beats Razaketh's 13% plus
    // its ratio term (9.9x its colours, strength 0.44: 13 points).
    expect(mergeWithAllNonLand(pool, []).map((c) => c.name)).toEqual([
      'Sol Ring',
      'Razaketh, the Foulblooded',
    ]);
    // Full Synergy: damped play rate (21) loses to the amplified ratio term.
    expect(mergeWithAllNonLand(pool, [], 1).map((c) => c.name)).toEqual([
      'Razaketh, the Foulblooded',
      'Sol Ring',
    ]);
  });
});

describe('pickFromPrefetched', () => {
  it('respects count, color identity, and bans while mutating usedNames', () => {
    const cards = [
      ec({ name: 'InColor', inclusion: 90 }),
      ec({ name: 'OffColor', inclusion: 80 }),
      ec({ name: 'Banned', inclusion: 70 }),
    ];
    const map = new Map<string, ScryfallCard>([
      ['InColor', sc({ name: 'InColor', color_identity: ['G'] })],
      ['OffColor', sc({ name: 'OffColor', color_identity: ['R'] })],
      ['Banned', sc({ name: 'Banned', color_identity: ['G'] })],
    ]);
    const used = new Set<string>();
    const picked = pickFromPrefetched(cards, map, 5, used, ['G'], new Set(['Banned']));
    expect(picked.map((c) => c.name)).toEqual(['InColor']);
    expect(used.has('InColor')).toBe(true);
  });

  it('stops once the requested count is reached', () => {
    const cards = [ec({ name: 'A' }), ec({ name: 'B' }), ec({ name: 'C' })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const picked = pickFromPrefetched(cards, map, 2, new Set(), []);
    expect(picked).toHaveLength(2);
  });

  it('treats available-only as a hard collection constraint', () => {
    const cards = [
      ec({ name: 'Unowned Bomb', inclusion: 99 }),
      ec({ name: 'Owned Free', inclusion: 10 }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const used = new Set<string>();
    const picked = pickFromPrefetched(
      cards,
      map,
      2,
      used,
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['Owned Free']),
      undefined,
      'USD',
      new Set(),
      false,
      'available'
    );

    expect(picked.map((c) => c.name)).toEqual(['Owned Free']);
    expect(used.has('Unowned Bomb')).toBe(false);
  });

  it('rejects a card that is not Commander-legal (the main filter never checked this)', () => {
    const cards = [
      ec({ name: 'Banned Staple', inclusion: 99 }),
      ec({ name: 'Legal Pick', inclusion: 10 }),
    ];
    const map = new Map<string, ScryfallCard>([
      ['Banned Staple', sc({ name: 'Banned Staple', legalities: { commander: 'banned' } })],
      ['Legal Pick', sc({ name: 'Legal Pick' })],
    ]);
    const picked = pickFromPrefetched(cards, map, 2, new Set(), []);
    expect(picked.map((c) => c.name)).toEqual(['Legal Pick']);
  });

  it('respects the optional card dependency guard', () => {
    const cards = [
      ec({ name: 'Orphan Payoff', inclusion: 99 }),
      ec({ name: 'Plain Draw', inclusion: 10 }),
    ];
    const map = new Map<string, ScryfallCard>([
      ['Orphan Payoff', sc({ name: 'Orphan Payoff' })],
      ['Plain Draw', sc({ name: 'Plain Draw' })],
    ]);

    const picked = pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      'full',
      100,
      false,
      false,
      (card) => card.name !== 'Orphan Payoff'
    );

    expect(picked.map((c) => c.name)).toEqual(['Plain Draw']);
  });

  it('treats available-only as a hard collection constraint in curve-aware picks', () => {
    const cards = [
      ec({ name: 'Unowned Bomb', inclusion: 99, primary_type: 'Creature' }),
      ec({ name: 'Owned Free', inclusion: 10, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const used = new Set<string>();
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      2,
      used,
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['Owned Free']),
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'available'
    );

    expect(picked.map((c) => c.name)).toEqual(['Owned Free']);
    expect(used.has('Unowned Bomb')).toBe(false);
  });

  it('respects the optional dependency guard in curve-aware picks', () => {
    const cards = [
      ec({ name: 'Orphan Payoff', inclusion: 99, primary_type: 'Creature' }),
      ec({ name: 'Plain Creature', inclusion: 10, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));

    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      1,
      new Set(),
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      (card) => card.name !== 'Orphan Payoff'
    );

    expect(picked.map((c) => c.name)).toEqual(['Plain Creature']);
  });

  it('rejects a card that is not Commander-legal (the main filter never checked this)', () => {
    const cards = [
      ec({ name: 'Banned Staple', inclusion: 99, primary_type: 'Creature' }),
      ec({ name: 'Legal Pick', inclusion: 10, primary_type: 'Creature' }),
    ];
    const map = new Map<string, ScryfallCard>([
      [
        'Banned Staple',
        sc({ name: 'Banned Staple', type_line: 'Creature', legalities: { commander: 'banned' } }),
      ],
      ['Legal Pick', sc({ name: 'Legal Pick', type_line: 'Creature' })],
    ]);
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      2,
      new Set(),
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature'
    );
    expect(picked.map((c) => c.name)).toEqual(['Legal Pick']);
  });
});

describe("owned-first ('prefer' strategy)", () => {
  const ownedInc = 10;

  // Owned 'O' (inclusion=ownedInc) vs unowned 'U' (inclusion=unownedInc); pick 1
  // in 'prefer' mode. Neither is high-synergy, so they sit in the filler tier
  // where the owned bias operates.
  function pickOnePreferred(unownedInc: number) {
    const cards = [
      ec({ name: 'U', inclusion: unownedInc }),
      ec({ name: 'O', inclusion: ownedInc }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    return pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['O']), // collectionNames — 'O' is owned
      undefined,
      'USD',
      new Set(),
      false,
      'prefer'
    );
  }

  it('picks the owned card when the inclusion gap is within the boost', () => {
    expect(pickOnePreferred(ownedInc + OWNED_PRIORITY_BOOST - 5).map((c) => c.name)).toEqual(['O']);
  });

  it('does NOT override a clearly-better unowned card — the bias is bounded', () => {
    expect(pickOnePreferred(ownedInc + OWNED_PRIORITY_BOOST + 20).map((c) => c.name)).toEqual([
      'U',
    ]);
  });

  it('applies the same bounded owned-first bias in curve-aware picks', () => {
    const cards = [
      ec({ name: 'U', inclusion: ownedInc + OWNED_PRIORITY_BOOST - 5, primary_type: 'Creature' }),
      ec({ name: 'O', inclusion: ownedInc, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      1,
      new Set(),
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['O']),
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'prefer'
    );
    expect(picked.map((c) => c.name)).toEqual(['O']);
  });
});

describe('owned-first bias in the theme/high-synergy tier (E122)', () => {
  const ownedInc = 10;

  // Both cards are theme-synergy (isThemeSynergyCard), so they land in the
  // >=100 tier where OWNED_PRIORITY_BOOST_THEME_TIER (not the filler-tier
  // OWNED_PRIORITY_BOOST) applies.
  function pickOnePreferredTheme(unownedInc: number) {
    const cards = [
      ec({ name: 'U', inclusion: unownedInc, isThemeSynergyCard: true }),
      ec({ name: 'O', inclusion: ownedInc, isThemeSynergyCard: true }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    return pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['O']), // collectionNames — 'O' is owned
      undefined,
      'USD',
      new Set(),
      false,
      'prefer'
    );
  }

  it('picks the owned theme card when the gap is within the theme-tier boost', () => {
    expect(
      pickOnePreferredTheme(ownedInc + OWNED_PRIORITY_BOOST_THEME_TIER - 5).map((c) => c.name)
    ).toEqual(['O']);
  });

  it('does NOT override a clearly-higher-synergy unowned theme card — still bounded', () => {
    expect(
      pickOnePreferredTheme(ownedInc + OWNED_PRIORITY_BOOST_THEME_TIER + 20).map((c) => c.name)
    ).toEqual(['U']);
  });

  it('the theme-tier boost is sized independently of (larger than) the filler-tier one', () => {
    // A gap that clears the theme boost but not the filler one proves this
    // is a genuinely separate constant, not OWNED_PRIORITY_BOOST reused —
    // guards against ever collapsing the two back into one shared value.
    expect(OWNED_PRIORITY_BOOST_THEME_TIER).toBeGreaterThan(OWNED_PRIORITY_BOOST);
    const gap = ownedInc + OWNED_PRIORITY_BOOST_THEME_TIER - 5;
    expect(pickOnePreferredTheme(gap).map((c) => c.name)).toEqual(['O']);
  });

  it('no collection: theme-tier ranking is untouched (byte-identical to today)', () => {
    const cards = [
      ec({ name: 'U', inclusion: ownedInc + 5, isThemeSynergyCard: true }),
      ec({ name: 'O', inclusion: ownedInc, isThemeSynergyCard: true }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const picked = pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined, // no collectionNames at all — no strategy can bias anything
      undefined,
      'USD',
      new Set(),
      false,
      'full'
    );
    // Higher raw inclusion wins outright — no owned bias is possible without
    // a collection, regardless of collectionStrategy.
    expect(picked.map((c) => c.name)).toEqual(['U']);
  });
});

describe('lift tie-break (E71 slice 2)', () => {
  it('breaks an EXACT priority tie in pickFromPrefetched', () => {
    const cards = [ec({ name: 'A', inclusion: 10 }), ec({ name: 'B', inclusion: 10 })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const liftTieBreak = new Map([['b', 5]]);
    const picked = pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      'full',
      100,
      false,
      false,
      undefined,
      liftTieBreak
    );
    expect(picked.map((c) => c.name)).toEqual(['B']);
  });

  it('never outranks a card with strictly higher priority, even with a huge lift score', () => {
    const cards = [ec({ name: 'Better', inclusion: 90 }), ec({ name: 'Worse', inclusion: 10 })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const liftTieBreak = new Map([['worse', 999]]);
    const picked = pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      'full',
      100,
      false,
      false,
      undefined,
      liftTieBreak
    );
    expect(picked.map((c) => c.name)).toEqual(['Better']);
  });

  it('applies the same exact-tie break in the curve-aware picker', () => {
    const cards = [
      ec({ name: 'A', inclusion: 10, primary_type: 'Creature' }),
      ec({ name: 'B', inclusion: 10, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const liftTieBreak = new Map([['b', 5]]);
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      1,
      new Set(),
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      undefined,
      liftTieBreak
    );
    expect(picked.map((c) => c.name)).toEqual(['B']);
  });

  it('an absent lift map leaves pick order unchanged (equivalence with pre-lift behavior)', () => {
    const cards = [ec({ name: 'A', inclusion: 10 }), ec({ name: 'B', inclusion: 10 })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const picked = pickFromPrefetched(cards, map, 1, new Set(), []);
    expect(picked.map((c) => c.name)).toEqual(['A']); // stable sort keeps input order on a tie
  });
});

describe('bracket guardrail in picking', () => {
  it('skips a card that would push a floor signal past the target-bracket ceiling', () => {
    const cards = [
      ec({ name: 'Mana Crypt', inclusion: 99, primary_type: 'Creature' }), // higher priority
      ec({ name: 'Plain Bear', inclusion: 50, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    // Bracket 2 → Game-Changer ceiling 0. Treat 'Mana Crypt' as a GC via the
    // guard's own name set. maxGameChangers stays Infinity and the picker's GC
    // set is empty, so this proves the guard is an INDEPENDENT gate.
    const guard = new BracketGuard(bracketCeilings(2), new Set(['Mana Crypt']));
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      2,
      new Set(),
      [],
      { 3: 5 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      guard
    );
    expect(picked.map((c) => c.name)).toEqual(['Plain Bear']);
  });
});

describe('pickFromPrefetched game-changer cap (E71 controls audit)', () => {
  const pickWithCap = (cap: number, gameChangerCount: { value: number }) => {
    const cards = [
      ec({ name: 'GC One', inclusion: 90 }),
      ec({ name: 'GC Two', inclusion: 80 }),
      ec({ name: 'Plain', inclusion: 70 }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    return pickFromPrefetched(
      cards,
      map,
      3,
      new Set(),
      [],
      new Set(),
      null,
      cap,
      gameChangerCount,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(['GC One', 'GC Two'])
    );
  };

  it('caps game changers at maxGameChangers with a shared running count', () => {
    const gameChangerCount = { value: 0 };
    const picked = pickWithCap(1, gameChangerCount);
    expect(picked.map((c) => c.name)).toEqual(['GC One', 'Plain']);
    expect(picked[0].isGameChanger).toBe(true);
    expect(gameChangerCount.value).toBe(1);
  });

  it('a pre-existing count from earlier phases blocks all further game changers', () => {
    const picked = pickWithCap(1, { value: 1 });
    expect(picked.map((c) => c.name)).toEqual(['Plain']);
  });
});

describe("pickFromPrefetched 'partial' owned-percentage quota (E71 controls audit)", () => {
  const cards = [
    ec({ name: 'Owned Hi', inclusion: 90 }),
    ec({ name: 'Owned Lo', inclusion: 80 }),
    ec({ name: 'Un Hi', inclusion: 70 }),
    ec({ name: 'Un Lo', inclusion: 60 }),
  ];
  const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
  const owned = new Set(['Owned Hi', 'Owned Lo']);

  const pickPartial = (count: number, ownedPercent: number, candidates = cards) =>
    pickFromPrefetched(
      candidates,
      map,
      count,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      owned,
      undefined,
      'USD',
      new Set(),
      false,
      'partial',
      ownedPercent
    );

  it('splits picks by the owned quota, not pure priority', () => {
    // 50% of 2 = 1 owned + 1 unowned: "Un Hi" gets the second slot even
    // though "Owned Lo" outranks it on priority — that's the quota working.
    const picked = pickPartial(2, 50);
    expect(picked.map((c) => c.name)).toEqual(['Owned Hi', 'Un Hi']);
  });

  it('relaxes the quota when the owned pool falls short', () => {
    // 100% of 3 = 3 owned wanted but only 1 owned candidate exists — the
    // shortfall fill tops up from the unowned pool instead of underfilling.
    const oneOwned = cards.filter((c) => c.name !== 'Owned Lo');
    const picked = pickPartial(3, 100, oneOwned);
    expect(picked.map((c) => c.name)).toEqual(['Owned Hi', 'Un Hi', 'Un Lo']);
  });
});

describe("pickFromPrefetchedWithCurve 'partial' owned quota vs curve gate (E128 audit)", () => {
  // Root cause traced from the live audit: an owned candidate's raw priority
  // is usually LOWER than an unowned staple's (no owned-priority boost exists
  // for 'partial' — only 'prefer' gets one), so unowned cards sort first and
  // claim the shared curve slots before the owned quota ever gets a turn. The
  // owned candidate then hits the curve gate with its typically-sub-40%
  // inclusion and gets skipped outright, silently under-delivering the
  // requested owned% even when a matching owned card exists.
  //
  // hasCurveRoom's own tolerance (Math.max(1, ceil(target*0.1))) means a
  // target of 1 actually allows 2 cards through — so this needs TWO unowned
  // cards ahead of the owned one to genuinely exhaust room (target 1 +
  // tolerance 1 = 2 slots), not one.
  const cards = [
    ec({ name: 'Un Hi 1', inclusion: 95, primary_type: 'Creature' }),
    ec({ name: 'Un Hi 2', inclusion: 90, primary_type: 'Creature' }),
    ec({ name: 'Owned Lo', inclusion: 20, primary_type: 'Creature' }), // <40% incl, would be curve-gated
  ];
  const map = new Map(
    cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature', cmc: 3 })])
  );

  it('lets an owned candidate the quota still needs break curve, same as a staple would', () => {
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      3, // count
      new Set(),
      [],
      { 3: 1 }, // target 1 + tolerance 1 = room for exactly 2 cmc-3 cards
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['Owned Lo']), // collectionNames
      undefined,
      'USD',
      new Set(),
      false,
      false, // strictCurve
      'partial',
      33 // collectionOwnedPercent -> ownedTarget=round(3*.33)=1, unownedTarget=2
    );
    expect(picked.map((c) => c.name)).toEqual(['Un Hi 1', 'Un Hi 2', 'Owned Lo']);
  });

  it('still respects strictCurve — the owned quota never overrides an explicit curve ask', () => {
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      3,
      new Set(),
      [],
      { 3: 1 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['Owned Lo']),
      undefined,
      'USD',
      new Set(),
      false,
      true, // strictCurve
      'partial',
      33
    );
    expect(picked.map((c) => c.name)).toEqual(['Un Hi 1', 'Un Hi 2']);
  });
});

describe('role-cap gate (E77 iter-4)', () => {
  // target=1 -> tolerance = max(2, round(1*0.2)) = 2 -> cap = target + tolerance = 3.
  const roleTargets: Record<RoleKey, number> = { ramp: 1, removal: 0, boardwipe: 0, cardDraw: 0 };

  function pickWithRoleCap(cards: EDHRECCard[], count: number, cardRoleMap: Map<string, RoleKey>) {
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const currentRoleCounts: Record<RoleKey, number> = {
      ramp: 0,
      removal: 0,
      boardwipe: 0,
      cardDraw: 0,
    };
    return pickFromPrefetchedWithCurve(
      cards,
      map,
      count,
      new Set(),
      [],
      { 3: 100 }, // generous curve room so the curve gate never interferes
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      undefined,
      undefined,
      { cardRoleMap, roleTargets, currentRoleCounts }
    );
  }

  it('caps a surplus role once at target+tolerance, freeing the slot for a role-null payoff', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Ramp2', inclusion: 85, primary_type: 'Creature' }),
      ec({ name: 'Ramp3', inclusion: 80, primary_type: 'Creature' }),
      ec({ name: 'Ramp4', inclusion: 75, primary_type: 'Creature' }), // would be picked #4 on pure priority
      ec({ name: 'Payoff', inclusion: 50, primary_type: 'Creature' }), // role-null, lowest priority
    ];
    const cardRoleMap = new Map<string, RoleKey>([
      ['Ramp1', 'ramp'],
      ['Ramp2', 'ramp'],
      ['Ramp3', 'ramp'],
      ['Ramp4', 'ramp'],
    ]);
    const picked = pickWithRoleCap(cards, 4, cardRoleMap);
    // Ramp4 hits the cap (3rd ramp already at count=3) — Payoff takes its slot
    // instead of shipping a 4th surplus ramp card.
    expect(picked.map((c) => c.name)).toEqual(['Ramp1', 'Ramp2', 'Ramp3', 'Payoff']);
  });

  it('never caps a role-null card even when every candidate outranks it', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Filler', inclusion: 10, primary_type: 'Creature' }),
    ];
    const cardRoleMap = new Map<string, RoleKey>([['Ramp1', 'ramp']]);
    const picked = pickWithRoleCap(cards, 2, cardRoleMap);
    expect(picked.map((c) => c.name)).toEqual(['Ramp1', 'Filler']); // both picked, no role-null gating
  });

  it('escape hatch: admits over-cap candidates rather than shipping the pass short', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Ramp2', inclusion: 85, primary_type: 'Creature' }),
      ec({ name: 'Ramp3', inclusion: 80, primary_type: 'Creature' }),
      ec({ name: 'Ramp4', inclusion: 75, primary_type: 'Creature' }),
      ec({ name: 'Ramp5', inclusion: 70, primary_type: 'Creature' }),
    ];
    const cardRoleMap = new Map<string, RoleKey>(cards.map((c) => [c.name, 'ramp']));
    // No role-null candidate exists to fill the freed slots — the pass MUST
    // fall back to admitting the capped candidates rather than shipping only 3/5.
    const picked = pickWithRoleCap(cards, 5, cardRoleMap);
    expect(picked).toHaveLength(5);
    expect(picked.map((c) => c.name).sort()).toEqual(['Ramp1', 'Ramp2', 'Ramp3', 'Ramp4', 'Ramp5']);
  });

  it('escape-hatch ceiling: admits at most ROLE_CAP_HATCH_MAX_PER_PASS over-cap candidates, then finishes short (iter-6 Slice B)', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 95, primary_type: 'Creature' }),
      ec({ name: 'Ramp2', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Ramp3', inclusion: 85, primary_type: 'Creature' }),
      ec({ name: 'Ramp4', inclusion: 80, primary_type: 'Creature' }),
      ec({ name: 'Ramp5', inclusion: 75, primary_type: 'Creature' }),
      ec({ name: 'Ramp6', inclusion: 70, primary_type: 'Creature' }),
      ec({ name: 'Ramp7', inclusion: 65, primary_type: 'Creature' }),
    ];
    const cardRoleMap = new Map<string, RoleKey>(cards.map((c) => [c.name, 'ramp']));
    // 3 admitted under cap (target=1, tolerance=2 -> cap=3); Ramp4-7 are all
    // over-cap and skipped. Uncapped, the hatch would admit all 4 to hit
    // count=7 — the ceiling caps it at 3 (Ramp4-6, in skip order), so the
    // pass ships 6/7 instead, leaving Ramp7's slot for a role-cap-gated
    // downstream fill to give to an under-target role.
    const picked = pickWithRoleCap(cards, 7, cardRoleMap);
    expect(picked).toHaveLength(6);
    expect(picked.map((c) => c.name).sort()).toEqual([
      'Ramp1',
      'Ramp2',
      'Ramp3',
      'Ramp4',
      'Ramp5',
      'Ramp6',
    ]);
  });
});

// This layer's `priceSanity` param is a plain boolean (defaults false here) —
// the E80 product ruling that it ships ON by default lives one level up, in
// deckGenerator.ts's resolvePriceSanity (see deckGenerator.notes.test.ts).
describe('price-sanity tie-break (E80)', () => {
  // Mox-Diamond-shaped fixture: ExpensiveRock outranks CheapRock on raw
  // inclusion alone (mirrors how the real generator's earlyRampMultiplier
  // boost lets a cmc-0 rock outrank a same-role cmc-2 rock with genuinely
  // higher inclusion) — both 'ramp', inclusion within the 15pt band, price
  // ratio 500x (well past the 20x threshold).
  const expensiveRock = ec({ name: 'ExpensiveRock', inclusion: 20, primary_type: 'Artifact' });
  const cheapRock = ec({ name: 'CheapRock', inclusion: 12, primary_type: 'Artifact' });
  const roleMap = new Map<string, RoleKey>([
    ['ExpensiveRock', 'ramp'],
    ['CheapRock', 'ramp'],
  ]);

  function pickPair(
    cards: EDHRECCard[],
    cardMap: Map<string, ScryfallCard>,
    priceSanity: boolean,
    cardRoleMap: Map<string, RoleKey> = roleMap,
    comboOnlyBoost?: Map<string, number>,
    priceSanityDecided?: Set<string>
  ) {
    return pickFromPrefetchedWithCurve(
      cards,
      cardMap,
      1, // only room for one — forces a real either/or choice
      new Set(),
      [],
      { 0: 100, 1: 100, 2: 100 }, // generous curve room, never gates this test
      {},
      new Set(),
      'Artifact',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      undefined,
      undefined,
      {
        cardRoleMap,
        roleTargets: { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 },
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      },
      priceSanity,
      comboOnlyBoost,
      priceSanityDecided
    );
  }

  it('flag off: today’s inclusion-driven order wins (expensive rock picked)', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const picked = pickPair([expensiveRock, cheapRock], cardMap, false);
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  it('flag on: flips to the dramatically cheaper, comparably-included rock', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const picked = pickPair([expensiveRock, cheapRock], cardMap, true);
    expect(picked.map((c) => c.name)).toEqual(['CheapRock']);
  });

  it('missing price data: inert even with the flag on', () => {
    const cardMap = new Map<string, ScryfallCard>([
      ['ExpensiveRock', sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: {} })], // no usd price
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const picked = pickPair([expensiveRock, cheapRock], cardMap, true);
    // Can't compute a ratio without both prices — falls back to raw priority.
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  it('inclusion gap beyond the band: a genuinely-better pick is not displaced', () => {
    const bigGapExpensive = ec({
      name: 'BigGapExpensive',
      inclusion: 30,
      primary_type: 'Artifact',
    });
    const bigGapCheap = ec({ name: 'BigGapCheap', inclusion: 5, primary_type: 'Artifact' }); // 25pt gap > 15pt band
    const cardMap = new Map<string, ScryfallCard>([
      [
        'BigGapExpensive',
        sc({ name: 'BigGapExpensive', cmc: 0, type_line: 'Artifact', prices: { usd: '1000.00' } }),
      ],
      [
        'BigGapCheap',
        sc({ name: 'BigGapCheap', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const cardRoleMap = new Map<string, RoleKey>([
      ['BigGapExpensive', 'ramp'],
      ['BigGapCheap', 'ramp'],
    ]);
    const picked = pickPair([bigGapExpensive, bigGapCheap], cardMap, true, cardRoleMap);
    expect(picked.map((c) => c.name)).toEqual(['BigGapExpensive']);
  });

  it('never reorders a candidate carrying a live combo boost', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const comboOnlyBoost = new Map([['ExpensiveRock', 50]]); // a real detected combo piece
    const picked = pickPair([expensiveRock, cheapRock], cardMap, true, roleMap, comboOnlyBoost);
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  it('different roles are never compared, even at an extreme price ratio', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRemoval',
        sc({ name: 'CheapRemoval', cmc: 2, type_line: 'Instant', prices: { usd: '1.00' } }),
      ],
    ]);
    const mixedRoleMap = new Map<string, RoleKey>([
      ['ExpensiveRock', 'ramp'],
      ['CheapRemoval', 'removal'],
    ]);
    const cheapRemoval = ec({ name: 'CheapRemoval', inclusion: 15, primary_type: 'Instant' });
    const picked = pickPair([expensiveRock, cheapRemoval], cardMap, true, mixedRoleMap);
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  describe('priceSanityDecided disclosure tracking', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);

    it('records the pair when the tie-break actually flips the winner', () => {
      const decided = new Set<string>();
      pickPair([expensiveRock, cheapRock], cardMap, true, roleMap, undefined, decided);
      expect(decided.size).toBe(1);
    });

    it('stays empty when the flag is off (order never flips)', () => {
      const decided = new Set<string>();
      pickPair([expensiveRock, cheapRock], cardMap, false, roleMap, undefined, decided);
      expect(decided.size).toBe(0);
    });

    it('stays empty when a combo boost keeps the tie-break from firing', () => {
      const decided = new Set<string>();
      const comboOnlyBoost = new Map([['ExpensiveRock', 50]]);
      pickPair([expensiveRock, cheapRock], cardMap, true, roleMap, comboOnlyBoost, decided);
      expect(decided.size).toBe(0);
    });

    it('stays empty when the inclusion gap exceeds the band (no comparable alternative)', () => {
      const decided = new Set<string>();
      const bigGapExpensive = ec({
        name: 'BigGapExpensive',
        inclusion: 30,
        primary_type: 'Artifact',
      });
      const bigGapCheap = ec({ name: 'BigGapCheap', inclusion: 5, primary_type: 'Artifact' });
      const cardRoleMap = new Map<string, RoleKey>([
        ['BigGapExpensive', 'ramp'],
        ['BigGapCheap', 'ramp'],
      ]);
      const bigGapCardMap = new Map<string, ScryfallCard>([
        [
          'BigGapExpensive',
          sc({
            name: 'BigGapExpensive',
            cmc: 0,
            type_line: 'Artifact',
            prices: { usd: '1000.00' },
          }),
        ],
        [
          'BigGapCheap',
          sc({ name: 'BigGapCheap', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
        ],
      ]);
      pickPair(
        [bigGapExpensive, bigGapCheap],
        bigGapCardMap,
        true,
        cardRoleMap,
        undefined,
        decided
      );
      expect(decided.size).toBe(0);
    });
  });
});

// E109: board-centric wipe-asymmetry preference. Real oracle text (Ruinous
// Ultimatum one-sided vs Farewell symmetric — see tagger/client.test.ts for
// the full ground-truth table verified against Scryfall) so this exercises
// the real isOneSidedWipe classifier, not a stub.
describe('wipe-asymmetry tie-break (E109)', () => {
  const oneSided = ec({ name: 'Ruinous Ultimatum', inclusion: 5, primary_type: 'Sorcery' });
  const symmetric = ec({ name: 'Farewell', inclusion: 40, primary_type: 'Sorcery' }); // outranks on raw priority
  const wipeRoleMap = new Map<string, RoleKey>([
    ['Ruinous Ultimatum', 'boardwipe'],
    ['Farewell', 'boardwipe'],
  ]);
  const wipeCardMap = new Map<string, ScryfallCard>([
    [
      'Ruinous Ultimatum',
      sc({
        name: 'Ruinous Ultimatum',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all nonland permanents your opponents control.',
      }),
    ],
    [
      'Farewell',
      sc({
        name: 'Farewell',
        type_line: 'Sorcery',
        oracle_text:
          'Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards.',
      }),
    ],
  ]);

  function pickWipe(preferAsymmetric: boolean, decided?: Set<string>) {
    return pickFromPrefetchedWithCurve(
      [oneSided, symmetric],
      wipeCardMap,
      1, // only room for one — forces a real either/or choice
      new Set(),
      [],
      { 3: 100, 4: 100, 5: 100 },
      {},
      new Set(),
      'Sorcery',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      undefined,
      undefined,
      {
        cardRoleMap: wipeRoleMap,
        roleTargets: { ramp: 0, removal: 0, boardwipe: 2, cardDraw: 0 },
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
        isOneSidedWipe: preferAsymmetric ? isOneSidedWipe : undefined,
        wipeAsymmetryDecided: decided,
      }
    );
  }

  it('disabled (not board-centric): the higher-inclusion symmetric staple wins as today', () => {
    const picked = pickWipe(false);
    expect(picked.map((c) => c.name)).toEqual(['Farewell']);
  });

  it('enabled (board-centric): the one-sided wipe wins despite a 35pt inclusion deficit', () => {
    const picked = pickWipe(true);
    expect(picked.map((c) => c.name)).toEqual(['Ruinous Ultimatum']);
  });

  it('two symmetric wipes: falls through to ordinary priority (no one-sided candidate to prefer)', () => {
    const otherSymmetric = ec({ name: 'Toxic Deluge', inclusion: 10, primary_type: 'Sorcery' });
    const cardMap = new Map(wipeCardMap);
    cardMap.set(
      'Toxic Deluge',
      sc({
        name: 'Toxic Deluge',
        type_line: 'Sorcery',
        oracle_text:
          'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
      })
    );
    const roleMap = new Map(wipeRoleMap);
    roleMap.set('Toxic Deluge', 'boardwipe');
    const picked = pickFromPrefetchedWithCurve(
      [symmetric, otherSymmetric],
      cardMap,
      1,
      new Set(),
      [],
      { 3: 100, 4: 100, 5: 100 },
      {},
      new Set(),
      'Sorcery',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      undefined,
      undefined,
      {
        cardRoleMap: roleMap,
        roleTargets: { ramp: 0, removal: 0, boardwipe: 2, cardDraw: 0 },
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
        isOneSidedWipe,
      }
    );
    expect(picked.map((c) => c.name)).toEqual(['Farewell']); // higher raw priority, tie-break didn't fire
  });

  it('records the pair when the tie-break actually decides the winner', () => {
    const decided = new Set<string>();
    pickWipe(true, decided);
    expect(decided.size).toBe(1);
  });

  it('stays empty when disabled', () => {
    const decided = new Set<string>();
    pickWipe(false, decided);
    expect(decided.size).toBe(0);
  });
});

// E112: own-board scope-collateral preference among boardwipe-role
// candidates. Real oracle text (Wrath of God vs Farewell — see
// tagger/client.test.ts's getWipeScope ground truth) so this exercises the
// real getWipeScope classifier, not a stub. Unlike the E109 block above,
// this is NOT gated on a board-centric preference — it fires purely off the
// deck's own planned type-target density (deckTypeTargets), independent of
// archetype/creature-density.
describe('wipe scope-collateral tie-break (E112)', () => {
  const lowCollateral = ec({ name: 'Wrath of God', inclusion: 20, primary_type: 'Sorcery' });
  const highCollateral = ec({ name: 'Farewell', inclusion: 60, primary_type: 'Sorcery' }); // outranks on raw priority
  const wipeRoleMap = new Map<string, RoleKey>([
    ['Wrath of God', 'boardwipe'],
    ['Farewell', 'boardwipe'],
  ]);
  const wipeCardMap = new Map<string, ScryfallCard>([
    [
      'Wrath of God',
      sc({
        name: 'Wrath of God',
        type_line: 'Sorcery',
        oracle_text: "Destroy all creatures. They can't be regenerated.",
      }),
    ],
    [
      'Farewell',
      sc({
        name: 'Farewell',
        type_line: 'Sorcery',
        oracle_text:
          'Choose one or more — Exile all creatures. Their controllers create that many 1/1 white Spirit creature tokens. Exile all artifacts and enchantments. Exile all graveyards.',
      }),
    ],
  ]);
  // Enchantment-heavy deck plan (a sythis-style enchantress build) — own
  // board mass is disproportionately enchantments, so Farewell's own-board
  // collateral (it also exiles the deck's own enchantments/artifacts)
  // should outweigh its higher raw priority/inclusion.
  const enchantressTypeTargets = {
    creature: 10,
    instant: 5,
    sorcery: 5,
    artifact: 5,
    enchantment: 20,
    planeswalker: 0,
  };

  function pickWipeByScope(deckTypeTargets: Record<string, number> | undefined) {
    return pickFromPrefetchedWithCurve(
      [highCollateral, lowCollateral],
      wipeCardMap,
      1, // only room for one — forces a real either/or choice
      new Set(),
      [],
      { 3: 100, 4: 100, 5: 100 },
      {},
      new Set(),
      'Sorcery',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      undefined,
      undefined,
      {
        cardRoleMap: wipeRoleMap,
        roleTargets: { ramp: 0, removal: 0, boardwipe: 2, cardDraw: 0 },
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
        getWipeScope,
        deckTypeTargets,
      }
    );
  }

  it('prefers the low-collateral wipe (Wrath of God) over the high-collateral one (Farewell) for an enchantment-heavy deck, despite a 40pt inclusion deficit', () => {
    const picked = pickWipeByScope(enchantressTypeTargets);
    expect(picked.map((c) => c.name)).toEqual(['Wrath of God']);
  });

  it('falls through to ordinary priority when no deck type-target context is available (deckTypeTargets undefined)', () => {
    const picked = pickWipeByScope(undefined);
    expect(picked.map((c) => c.name)).toEqual(['Farewell']);
  });

  it('falls through to ordinary priority for a creature-only deck (no non-creature collateral difference between the two)', () => {
    const creatureHeavyTypeTargets = {
      creature: 30,
      instant: 5,
      sorcery: 5,
      artifact: 0,
      enchantment: 0,
      planeswalker: 0,
    };
    const picked = pickWipeByScope(creatureHeavyTypeTargets);
    expect(picked.map((c) => c.name)).toEqual(['Farewell']); // both score 0 collateral -> raw priority wins
  });
});

// E112/E113 coordination fix: wipeQualityPenalty is the shared quality signal
// (asymmetry + own-board collateral) phaseRoleSurplusRebalance folds into its
// boardwipe eviction/replacement survival score — so a symmetric or
// high-collateral wipe ranks as the WORST wipe to keep even when its raw
// EDHREC priority is high. Exercises the REAL isOneSidedWipe/getWipeScope
// classifiers against real oracle text (same ground truth as the E112 block
// above). A hard tier by design (symmetric penalty >> calculateCardPriority's
// ~0-250 range), not a capped nudge.
describe('wipeQualityPenalty (E112/E113)', () => {
  const oneSided = sc({
    name: 'Ruinous Ultimatum',
    type_line: 'Sorcery',
    oracle_text:
      "Destroy all nonland permanents your opponents control. You can't lose the game this turn.",
  });
  const symmetricCreatureOnly = sc({
    name: 'Wrath of God',
    type_line: 'Sorcery',
    oracle_text: "Destroy all creatures. They can't be regenerated.",
  });
  const symmetricModal = sc({
    name: 'Farewell',
    type_line: 'Sorcery',
    oracle_text:
      'Choose one or more — Exile all creatures. Exile all artifacts and enchantments. Exile all graveyards.',
  });
  const enchantressTargets = { creature: 10, artifact: 5, enchantment: 20, instant: 5, sorcery: 5 };

  it('scores a one-sided wipe at zero penalty (best to keep)', () => {
    expect(wipeQualityPenalty(oneSided, isOneSidedWipe, getWipeScope, enchantressTargets)).toBe(0);
  });

  it('scores a symmetric creature-only wipe at exactly the symmetric tier (no non-creature collateral)', () => {
    // Wrath hits only creatures -> collateral term is 0 even on an enchantment-heavy board.
    expect(
      wipeQualityPenalty(symmetricCreatureOnly, isOneSidedWipe, getWipeScope, enchantressTargets)
    ).toBe(WIPE_QUALITY_SYMMETRIC_PENALTY);
  });

  it('penalizes a high-collateral symmetric modal wipe strictly more than a low-collateral one', () => {
    const modal = wipeQualityPenalty(
      symmetricModal,
      isOneSidedWipe,
      getWipeScope,
      enchantressTargets
    );
    const wrath = wipeQualityPenalty(
      symmetricCreatureOnly,
      isOneSidedWipe,
      getWipeScope,
      enchantressTargets
    );
    // Farewell exiles the enchantress's own enchantments+artifacts -> strictly worse to keep.
    expect(modal).toBeGreaterThan(wrath);
    // Collateral is a flat BASE tier (dominates priority) + a share-scaled term,
    // added on top of the symmetric tier.
    const nonLand = Object.values(enchantressTargets).reduce((s, v) => s + v, 0);
    const share = (enchantressTargets.enchantment + enchantressTargets.artifact) / nonLand;
    expect(modal).toBeCloseTo(
      WIPE_QUALITY_SYMMETRIC_PENALTY +
        WIPE_QUALITY_COLLATERAL_BASE +
        share * WIPE_QUALITY_COLLATERAL_SCALE
    );
  });

  it('drops the collateral term when no deck type-target context is available', () => {
    // Symmetric tier still applies; collateral is unknowable -> omitted.
    expect(wipeQualityPenalty(symmetricModal, isOneSidedWipe, getWipeScope, undefined)).toBe(
      WIPE_QUALITY_SYMMETRIC_PENALTY
    );
  });
});
