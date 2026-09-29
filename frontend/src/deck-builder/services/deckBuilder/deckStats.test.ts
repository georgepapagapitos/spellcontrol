import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateStats, cardManaValue } from './deckStats';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';

// E527: the real Secret Lair reversible printing the art-theme-goblin row
// seated. Scryfall gives it no top-level cmc; each face carries cmc 2.
const KRARKS_THUMB_SLD = (
  JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '__fixtures__',
        'commander-cards.fixture.json'
      ),
      'utf8'
    )
  ) as { cards: ScryfallCard[] }
).cards.find((c) => c.name === "Krark's Thumb // Krark's Thumb")!;

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

function categories(
  partial: Partial<Record<DeckCategory, ScryfallCard[]>>
): Record<DeckCategory, ScryfallCard[]> {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
    ...partial,
  };
}

describe('calculateStats', () => {
  it('counts total cards across every category', () => {
    const stats = calculateStats(
      categories({
        creatures: [makeCard(), makeCard()],
        lands: [makeCard({ type_line: 'Land', colors: [] })],
      })
    );
    expect(stats.totalCards).toBe(3);
  });

  it('excludes lands from the mana curve and average CMC', () => {
    const stats = calculateStats(
      categories({
        creatures: [makeCard({ cmc: 2 }), makeCard({ cmc: 4 })],
        lands: [makeCard({ cmc: 0, type_line: 'Land', colors: [] })],
      })
    );
    expect(stats.averageCmc).toBe(3); // (2 + 4) / 2, land ignored
    expect(stats.manaCurve[2]).toBe(1);
    expect(stats.manaCurve[4]).toBe(1);
    expect(stats.manaCurve[0]).toBeUndefined();
  });

  it('caps the mana curve bucket at 7+', () => {
    const stats = calculateStats(
      categories({ creatures: [makeCard({ cmc: 9 }), makeCard({ cmc: 12 })] })
    );
    expect(stats.manaCurve[7]).toBe(2);
  });

  it('buckets colorless cards under "C"', () => {
    const stats = calculateStats(
      categories({ ramp: [makeCard({ colors: [], type_line: 'Artifact' })] })
    );
    expect(stats.colorDistribution['C']).toBe(1);
  });

  it('classifies type distribution by front face', () => {
    const stats = calculateStats(
      categories({
        creatures: [makeCard({ type_line: 'Creature' })],
        singleRemoval: [makeCard({ type_line: 'Instant', colors: ['U'] })],
        lands: [makeCard({ type_line: 'Land', colors: [] })],
      })
    );
    expect(stats.typeDistribution['Creature']).toBe(1);
    expect(stats.typeDistribution['Instant']).toBe(1);
    expect(stats.typeDistribution['Land']).toBe(1);
  });

  // E78 item 7: typeDistribution buckets creature-first, so an "Enchantment
  // Creature" (Sanctum Weaver, Heliod) reads only as Creature — a real
  // enchantress-deck report ("Sythis") undercounted its 22 true enchantment
  // permanents as 10 this way. enchantmentPermanentCount is the non-exclusive
  // total for surfaces that need the real number.
  it('surfaces the true enchantment-permanent count separately from the primary-type bucket', () => {
    const stats = calculateStats(
      categories({
        creatures: [
          makeCard({ name: 'Sanctum Weaver', type_line: 'Enchantment Creature — Dryad' }),
          makeCard({ name: 'Vanilla Bear', type_line: 'Creature' }),
        ],
        synergy: [makeCard({ name: 'Sphere of Safety', type_line: 'Enchantment' })],
      })
    );
    expect(stats.typeDistribution['Creature']).toBe(2); // Enchantment Creature buckets here
    expect(stats.typeDistribution['Enchantment']).toBe(1);
    expect(stats.enchantmentPermanentCount).toBe(2); // Sanctum Weaver + Sphere of Safety
  });

  it('counts a spell-front MDFC once, under its actual category — not double-booked into Land', () => {
    // Fell the Profane-shaped: "Instant // Land", filed under singleRemoval by
    // the generator. isMdfcLand is stamped true on every MDFC in the spell
    // pool regardless of where it lands — category membership must win.
    const mdfc = makeCard({
      type_line: 'Instant // Land',
      card_faces: [
        { name: 'Front', type_line: 'Instant' },
        { name: 'Back', type_line: 'Land' },
      ],
      isMdfcLand: true,
      cmc: 2,
      colors: ['G'],
    });
    const stats = calculateStats(categories({ singleRemoval: [mdfc] }));
    expect(stats.typeDistribution['Instant']).toBe(1);
    expect(stats.typeDistribution['Land']).toBeUndefined();
  });

  it('counts a land-picked MDFC once as Land, not leaked into the nonland curve', () => {
    // Jwari Disruption-shaped: front face is "Sorcery" (not literally "Land"),
    // but the generator placed it in categories.lands as a manabase pick.
    const mdfc = makeCard({
      type_line: 'Sorcery // Land',
      card_faces: [
        { name: 'Front', type_line: 'Sorcery' },
        { name: 'Back', type_line: 'Land' },
      ],
      isMdfcLand: true,
      cmc: 2,
      colors: ['G'],
    });
    const stats = calculateStats(categories({ creatures: [makeCard({ cmc: 3 })], lands: [mdfc] }));
    expect(stats.typeDistribution['Land']).toBe(1);
    expect(stats.typeDistribution['Sorcery']).toBeUndefined();
    // Curve total must equal the nonland card count (1 creature) — the MDFC's
    // front-face CMC must not leak in as a phantom curve entry.
    const curveTotal = Object.values(stats.manaCurve).reduce((s, n) => s + n, 0);
    expect(curveTotal).toBe(1);
    expect(stats.manaCurve[2]).toBeUndefined();
  });

  it('buckets a card with no top-level mana value by its front face, never as NaN (E527)', () => {
    expect(KRARKS_THUMB_SLD.cmc).toBeUndefined();
    const stats = calculateStats(
      categories({ synergy: [KRARKS_THUMB_SLD], creatures: [makeCard({ cmc: 4 })] })
    );
    expect(stats.manaCurve).toEqual({ 2: 1, 4: 1 });
    expect(stats.averageCmc).toBe(3);
  });
});

describe('cardManaValue', () => {
  it('reads the top-level mana value first', () => {
    expect(cardManaValue(makeCard({ cmc: 5 }))).toBe(5);
    expect(cardManaValue(makeCard({ cmc: 0 }))).toBe(0);
  });

  it("reads a reversible printing's front face", () => {
    expect(cardManaValue(KRARKS_THUMB_SLD)).toBe(2);
  });

  it('is 0, not NaN, for a card with no mana value anywhere', () => {
    expect(cardManaValue(makeCard({ cmc: undefined as unknown as number }))).toBe(0);
  });
});
