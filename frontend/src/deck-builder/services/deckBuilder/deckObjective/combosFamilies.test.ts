// @vitest-environment node
//
// E1059: the combos term ranks DISTINCT lines before near-duplicate variants.
// The rows are Kozilek, the Great Distortion's real Commander Spellbook lines
// (__fixtures__/kozilek-combos.fixture.json): ~19 complete lines, most of them
// one Sensei's Divining Top loop with a different third piece. On main the decay
// saturated at 4 before Karn + Mycosynth Lattice (22,882 decks, a 'Lock') earned
// a slot, so the Lattice was worth ~0 to the objective.
import { describe, expect, it } from 'vitest';
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { combosTerm } from './terms/combos';
import { merenCtx } from './__fixtures__/objectiveFixture';
import KOZ from './__fixtures__/kozilek-combos.fixture.json';

const rows: DetectedCombo[] = KOZ.combos.map((c) => ({
  ...c,
  isComplete: true,
  missingCards: [],
  bracket: null,
  bracketTag: null,
  cardCount: c.cards.length,
}));
const stub = (name: string) => ({ name }) as unknown as ScryfallCard;
const deckOf = (names: string[]) => ({
  commanders: [stub('Kozilek, the Great Distortion')],
  cards: names.map(stub),
});
const ctx = merenCtx({ combos: rows, colorIdentity: [] });
const piecesOf = (names: string[]) => [...new Set(names)];

// Every piece of the first N rows that are the Top / Forge / Echoes loop.
const topLoop = piecesOf(
  rows.filter((r) => r.cards.includes("Sensei's Divining Top")).flatMap((r) => r.cards)
);
const manaAndKeys = piecesOf(
  rows.filter((r) => !r.cards.includes("Sensei's Divining Top")).flatMap((r) => r.cards)
).filter((n) => n !== 'Karn, the Great Creator' && n !== 'Mycosynth Lattice');
const LATTICE = ['Karn, the Great Creator', 'Mycosynth Lattice'];

describe('combos: families (E1059)', () => {
  it('a deck holding the Top loop variants still credits Karn + Mycosynth Lattice', () => {
    const without = combosTerm(deckOf(topLoop), ctx).value;
    const withLock = combosTerm(deckOf([...topLoop, ...LATTICE]), ctx).value;
    expect(withLock - without).toBeGreaterThan(0.4);
  });

  it('a Top-loop variant adds far less than a different line', () => {
    const fewer = topLoop.filter((n) => n !== 'Cloud Key' && n !== "Jhoira's Familiar");
    const variantGain =
      combosTerm(deckOf(topLoop), ctx).value - combosTerm(deckOf(fewer), ctx).value;
    const lockGain =
      combosTerm(deckOf([...topLoop, ...LATTICE]), ctx).value -
      combosTerm(deckOf(topLoop), ctx).value;
    expect(lockGain).toBeGreaterThan(variantGain * 4);
  });

  it('keeps the ceiling: the whole set never exceeds twice the first weight', () => {
    const all = piecesOf(rows.flatMap((r) => r.cards));
    expect(combosTerm(deckOf(all), ctx).value).toBeLessThanOrEqual(4);
    expect(manaAndKeys.length).toBeGreaterThan(0);
  });
});
