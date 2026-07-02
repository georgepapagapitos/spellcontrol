import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildManaData } from './build-mana-data';

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'x',
    oracle_id: 'ox',
    name: 'Test',
    cmc: 0,
    type_line: 'Instant',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    legalities: { commander: 'legal' },
    prices: {},
    ...overrides,
  } as unknown as ScryfallCard;
}

const ZERO = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

describe('buildManaData', () => {
  it('returns zeros for an empty deck', () => {
    const r = buildManaData([], null);
    expect(r.manaCurve).toEqual({});
    expect(r.averageCmc).toBe(0);
    expect(r.colorDist).toEqual({ counts: ZERO, total: 0 });
    expect(r.manaProduction.counts).toEqual(ZERO);
    expect(r.manaProduction.total).toBe(0);
  });

  it('buckets the curve and caps CMC at 7+', () => {
    const r = buildManaData(
      [
        card({ cmc: 1, type_line: 'Creature' }),
        card({ cmc: 3, type_line: 'Sorcery' }),
        card({ cmc: 8, type_line: 'Sorcery' }),
      ],
      null
    );
    expect(r.manaCurve).toEqual({ 1: 1, 3: 1, 7: 1 });
    expect(r.manaCurve[8]).toBeUndefined();
  });

  it('averageCmc is the mean over nonland cards only', () => {
    const r = buildManaData(
      [
        card({ cmc: 1, type_line: 'Creature' }),
        card({ cmc: 3, type_line: 'Instant' }),
        card({ cmc: 0, type_line: 'Basic Land — Forest', color_identity: ['G'] }),
      ],
      null
    );
    expect(r.averageCmc).toBe(2); // (1 + 3) / 2 — the land is excluded
  });

  it('colorDist counts nonland cards per identity color, with a colorless bucket; lands excluded', () => {
    const r = buildManaData(
      [
        card({ cmc: 2, type_line: 'Creature', color_identity: ['W', 'U'] }),
        card({ cmc: 1, type_line: 'Artifact', color_identity: [] }),
        card({ cmc: 0, type_line: 'Basic Land — Forest', color_identity: ['G'] }),
      ],
      null
    );
    expect(r.colorDist.counts).toEqual({ W: 1, U: 1, B: 0, R: 0, G: 0, C: 1 });
    expect(r.colorDist.total).toBe(3); // WU card = 2, colorless = 1; the land is excluded
  });

  it('manaProduction tallies mana sources (rocks via produced_mana, basics via subtype) and skips rituals', () => {
    const r = buildManaData(
      [
        card({ name: 'Rock', cmc: 2, type_line: 'Artifact', produced_mana: ['W', 'U'] }),
        card({ name: 'Forest', cmc: 0, type_line: 'Basic Land — Forest' }),
        card({
          name: 'Ritual',
          cmc: 1,
          type_line: 'Instant',
          produced_mana: ['B', 'B', 'B'],
        }),
      ],
      null
    );
    expect(r.manaProduction.counts.W).toBe(1);
    expect(r.manaProduction.counts.U).toBe(1);
    expect(r.manaProduction.counts.G).toBe(1); // Forest resolved by subtype fallback
    expect(r.manaProduction.counts.B).toBe(0); // the instant ritual is not a mana source
    expect(r.manaProduction.total).toBe(2); // rock + forest, not the ritual
    expect(r.manaProduction.sourcesByColor?.G?.[0]?.name).toBe('Forest');
  });

  it('clamps a "color identity" fixer to the deck identity from the commander', () => {
    const commander = card({ name: 'Cmd', type_line: 'Legendary Creature', color_identity: ['G'] });
    const cmdTower = card({
      name: 'Command Tower',
      type_line: 'Land',
      oracle_text: 'Add one mana of any color in your commander’s color identity.',
    });
    const r = buildManaData([commander, cmdTower], commander);
    expect(r.manaProduction.counts.G).toBe(1);
    expect(r.manaProduction.counts.W).toBe(0); // clamped to the {G} identity
  });

  it('tolerates missing cmc / type_line / color_identity', () => {
    // type_line '' matches no group → classify default (Artifact); cmc/identity absent.
    const bare = {
      id: 'b',
      oracle_id: 'ob',
      name: 'Bare',
      type_line: '',
    } as unknown as ScryfallCard;
    const r = buildManaData([bare], null);
    expect(r.manaCurve).toEqual({ 0: 1 }); // cmc ?? 0
    expect(r.colorDist.counts.C).toBe(1); // color_identity ?? [] → colorless
    expect(r.typeBreakdown.Artifact).toBe(1); // classify fallback
    expect(r.manaProduction.total).toBe(0); // produces nothing
  });

  it('skips a mana-source-type card that produces no colors', () => {
    const dud = card({ name: 'Dud', cmc: 2, type_line: 'Artifact' }); // source type, no production
    const r = buildManaData([dud], null);
    expect(r.manaProduction.total).toBe(0);
    expect(r.manaProduction.counts).toEqual(ZERO);
  });

  it('classifies the type breakdown (first matching type wins)', () => {
    const r = buildManaData(
      [
        card({ type_line: 'Legendary Creature — God' }),
        card({ type_line: 'Artifact Creature — Golem' }), // Creature wins over Artifact
        card({ type_line: 'Basic Land — Island' }),
        card({ type_line: 'Instant' }),
      ],
      null
    );
    expect(r.typeBreakdown.Creature).toBe(2);
    expect(r.typeBreakdown.Land).toBe(1);
    expect(r.typeBreakdown.Instant).toBe(1);
    expect(r.typeBreakdown.Artifact).toBe(0);
  });

  it('uses the first face type line for reversible cards with no top-level type line', () => {
    const bloodCrypt = card({
      name: 'Blood Crypt // Blood Crypt',
      layout: 'reversible_card',
      type_line: undefined as unknown as string,
      cmc: undefined as unknown as number,
      color_identity: ['B', 'R'],
      produced_mana: ['B', 'R'],
      card_faces: [
        { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
        { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
      ] as ScryfallCard['card_faces'],
    });

    const r = buildManaData([bloodCrypt], null);

    expect(r.manaCurve).toEqual({});
    expect(r.averageCmc).toBe(0);
    expect(r.colorDist.total).toBe(0);
    expect(r.typeBreakdown.Land).toBe(1);
    expect(r.typeBreakdown.Artifact).toBe(0);
    expect(r.cardsByType?.Land?.[0]?.name).toBe('Blood Crypt // Blood Crypt');
  });

  it('treats a spell//land MDFC as a spell in the curve (front-face only)', () => {
    // type_line contains "land" after the // but the front face is a spell.
    const mdfc = card({
      name: 'Valakut Awakening // Valakut Stoneforge',
      cmc: 3,
      type_line: 'Instant // Land — Mountain',
      color_identity: ['R'],
    });
    const r = buildManaData([mdfc], null);
    // The card must appear in the curve at cmc-3 (front-face is a spell, so
    // isLand() returns false) even though the back face is a land.
    expect(r.manaCurve[3]).toBe(1);
    // classifyType() checks the full type_line and finds "Land" first in
    // CLASSIFY_PRIORITY, so the type-breakdown bucket is Land — that is correct
    // behaviour for the type panel; what matters here is that the curve sees it.
    expect(r.typeBreakdown.Land).toBe(1);
    expect(r.typeBreakdown.Instant).toBe(0);
  });
});
