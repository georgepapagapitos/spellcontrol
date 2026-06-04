import { describe, it, expect } from 'vitest';
import {
  scoreSimilarity,
  computeSimilarCards,
  type SimilarInput,
  type SimilarTarget,
} from './similar-cards';
import type { ScryfallCard } from '@/deck-builder/types';

/** Minimal ScryfallCard factory — only the fields the scorer reads matter. */
function card(p: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: p.name,
    oracle_id: p.name,
    cmc: 0,
    type_line: '',
    color_identity: [],
    keywords: [],
    ...p,
  } as ScryfallCard;
}

// A card that classifies as a token *producer* (real oracle templating).
const tokenMaker = (name: string, extra: Partial<ScryfallCard> = {}) =>
  card({
    name,
    type_line: 'Creature — Soldier',
    oracle_text: 'Create a 1/1 white Soldier creature token.',
    cmc: 3,
    ...extra,
  });

// A vanilla card with no synergy axes at all.
const vanilla = (name: string, extra: Partial<ScryfallCard> = {}) =>
  card({
    name,
    type_line: 'Artifact',
    oracle_text: 'Whenever this is tapped, nothing happens.',
    ...extra,
  });

describe('scoreSimilarity', () => {
  it('rewards shared synergy axes (Jaccard) as the dominant signal', () => {
    const target: SimilarTarget = { card: tokenMaker('Target') };
    const alike: SimilarInput = { card: tokenMaker('Alike') };
    const { score, sharedAxes } = scoreSimilarity(target, alike);
    // Same single axis:side on both → Jaccard 1.0 × 0.5, plus cmc(0)=0.15 + type match 0.10.
    expect(sharedAxes).toContain('tokens');
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('adds exactly 0.25 for a matching tagger role', () => {
    const target: SimilarTarget = { card: vanilla('T', { cmc: 2 }), role: 'ramp' };
    const same: SimilarInput = { card: vanilla('A', { cmc: 2 }), role: 'ramp' };
    const diff: SimilarInput = { card: vanilla('B', { cmc: 2 }), role: 'removal' };
    expect(scoreSimilarity(target, same).score - scoreSimilarity(target, diff).score).toBeCloseTo(
      0.25,
      5
    );
  });

  it('contributes 0.15 for an exact CMC match vs a 3+ gap', () => {
    const target: SimilarTarget = { card: vanilla('T', { cmc: 3 }), role: 'ramp' };
    const near: SimilarInput = { card: vanilla('A', { cmc: 3 }), role: 'ramp' };
    const far: SimilarInput = { card: vanilla('B', { cmc: 6 }), role: 'ramp' };
    expect(scoreSimilarity(target, near).score - scoreSimilarity(target, far).score).toBeCloseTo(
      0.15,
      5
    );
  });

  it('steps CMC contribution down by band (0 → 0.15, 1 → 0.10, 2 → 0.05)', () => {
    // Target is an Instant; candidates are Artifacts → no type/role/axis overlap,
    // isolating the CMC layer.
    const target: SimilarTarget = { card: card({ name: 'T', type_line: 'Instant', cmc: 4 }) };
    const d1 = scoreSimilarity(target, { card: vanilla('A', { cmc: 5 }) }).score;
    const d2 = scoreSimilarity(target, { card: vanilla('B', { cmc: 6 }) }).score;
    expect(d1).toBeCloseTo(0.1, 5);
    expect(d2).toBeCloseTo(0.05, 5);
  });

  it('contributes 0.10 for a matching primary type', () => {
    const target: SimilarTarget = {
      card: card({ name: 'T', type_line: 'Creature — Elf', cmc: 1 }),
    };
    const creature: SimilarInput = {
      card: card({ name: 'A', type_line: 'Creature — Goblin', cmc: 9 }),
    };
    const instant: SimilarInput = { card: card({ name: 'B', type_line: 'Instant', cmc: 9 }) };
    expect(
      scoreSimilarity(target, creature).score - scoreSimilarity(target, instant).score
    ).toBeCloseTo(0.1, 5);
  });
});

describe('computeSimilarCards', () => {
  it('ranks an axis-sharing card above an unrelated one', () => {
    const target: SimilarTarget = { card: tokenMaker('Commander Token') };
    const out = computeSimilarCards(target, [
      { card: vanilla('Random Rock', { cmc: 3 }) },
      { card: tokenMaker('Another Maker') },
    ]);
    expect(out[0]?.name).toBe('Another Maker');
    expect(out[0]?.sharedAxes).toContain('tokens');
  });

  it('excludes the target card itself from the pool', () => {
    const target: SimilarTarget = { card: tokenMaker('Self') };
    const out = computeSimilarCards(target, [
      { card: tokenMaker('Self') },
      { card: tokenMaker('Other') },
    ]);
    expect(out.map((c) => c.name)).toEqual(['Other']);
  });

  it('drops candidates below the noise floor', () => {
    const target: SimilarTarget = { card: tokenMaker('T', { cmc: 1 }) };
    // No shared axis, different role, far cmc, different type → score ~0 < 0.15.
    const out = computeSimilarCards(target, [
      { card: card({ name: 'Noise', type_line: 'Instant', oracle_text: 'Draw a card.', cmc: 7 }) },
    ]);
    expect(out).toEqual([]);
  });

  it('filters candidates outside the commander color identity', () => {
    const target: SimilarTarget = { card: tokenMaker('Mono White'), role: 'ramp' };
    const out = computeSimilarCards(
      target,
      [
        { card: tokenMaker('White Ally', { color_identity: ['W'] }) },
        { card: tokenMaker('Blue Splash', { color_identity: ['U'] }) },
        { card: tokenMaker('Colorless', { color_identity: [] }) },
      ],
      { identity: ['W'] }
    );
    const names = out.map((c) => c.name);
    expect(names).toContain('White Ally');
    expect(names).toContain('Colorless');
    expect(names).not.toContain('Blue Splash');
  });

  it('returns [] for an empty pool', () => {
    expect(computeSimilarCards({ card: tokenMaker('T') }, [])).toEqual([]);
  });

  it('ranks a card with no axes purely on role + cmc + type', () => {
    const target: SimilarTarget = { card: vanilla('Signet', { cmc: 2 }), role: 'ramp' };
    const out = computeSimilarCards(target, [
      { card: vanilla('Mind Stone', { cmc: 2 }), role: 'ramp' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.sharedAxes).toEqual([]);
    // role 0.25 + cmc 0.15 + type 0.10.
    expect(out[0]?.score).toBeCloseTo(0.5, 5);
  });

  it('caps results at maxResults', () => {
    const target: SimilarTarget = { card: tokenMaker('T') };
    const pool: SimilarInput[] = Array.from({ length: 8 }, (_, i) => ({
      card: tokenMaker(`Maker ${i}`),
    }));
    expect(computeSimilarCards(target, pool, { maxResults: 3 })).toHaveLength(3);
  });

  it('sorts owned candidates ahead of higher-scoring unowned ones', () => {
    const target: SimilarTarget = { card: tokenMaker('T', { cmc: 3 }), role: 'ramp' };
    const out = computeSimilarCards(target, [
      // Higher score (shares the tokens axis), but unowned.
      { card: tokenMaker('Unowned Twin', { cmc: 9 }), ownership: 'unowned' },
      // Lower score (role match only), but owned.
      { card: vanilla('Owned Rock', { cmc: 9 }), role: 'ramp', ownership: 'owned' },
    ]);
    expect(out[0]?.name).toBe('Owned Rock');
    expect(out[0]?.score).toBeLessThan(out[1]?.score ?? 0);
  });

  it('breaks score ties by EDHREC inclusion', () => {
    const target: SimilarTarget = { card: vanilla('T', { cmc: 3 }), role: 'ramp' };
    const out = computeSimilarCards(target, [
      { card: vanilla('Niche', { cmc: 9 }), role: 'ramp', inclusion: 8 },
      { card: vanilla('Popular', { cmc: 9 }), role: 'ramp', inclusion: 42 },
    ]);
    expect(out.map((c) => c.name)).toEqual(['Popular', 'Niche']);
  });
});
