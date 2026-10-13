import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/plan-conflict.golden.fixture.json';

interface Item {
  id: string;
  set: string;
  deck: string;
  wipe: string;
  raterA: string;
  raterB: string;
  truth: string;
  ruling: string | null;
}
interface Fixture {
  cards: Record<string, { t: string; o: string }>;
  decks: { id: string; set: string; commanders: string[]; cards: Record<string, number> }[];
  items: Item[];
}
const F = fixture as unknown as Fixture;

/** Cohen's kappa over the three labels. */
function kappa(items: Item[]): number {
  const labels = ['NOTWIPE', 'FINE', 'CONFLICT'];
  const n = items.length;
  const po = items.filter((i) => i.raterA === i.raterB).length / n;
  const pe = labels.reduce(
    (s, l) =>
      s +
      (items.filter((i) => i.raterA === l).length / n) *
        (items.filter((i) => i.raterB === l).length / n),
    0
  );
  return (po - pe) / (1 - pe);
}

// The adjudicated plan-conflict set (E356 slice E): the definition and rulings are in
// `__fixtures__/plan-conflict.golden.md`. A rule built on it is measured against `truth`.
describe('plan-conflict golden fixture', () => {
  it('holds two disjoint 30-deck sets with real oracle text for every card', () => {
    expect(F.decks.filter((d) => d.set === 'tuned')).toHaveLength(30);
    expect(F.decks.filter((d) => d.set === 'heldout')).toHaveLength(30);
    expect(new Set(F.decks.map((d) => d.id)).size).toBe(60);
    for (const d of F.decks) {
      for (const n of [...Object.keys(d.cards), ...d.commanders]) {
        expect(F.cards[n]?.o, `${d.id} ${n}`).toBeTruthy();
      }
    }
  });

  it('has every rated wipe inside its deck', () => {
    for (const i of F.items) {
      const d = F.decks.find((x) => x.id === i.deck);
      expect(d?.cards[i.wipe], i.id).toBeGreaterThan(0);
    }
  });

  it('keeps the rater agreement and positives it was adjudicated at', () => {
    const tuned = F.items.filter((i) => i.set === 'tuned');
    const held = F.items.filter((i) => i.set === 'heldout');
    expect([tuned.length, held.length]).toEqual([98, 90]);
    expect(kappa(tuned)).toBeCloseTo(0.694, 2);
    expect(kappa(held)).toBeCloseTo(0.595, 2);
    expect(tuned.filter((i) => i.truth === 'CONFLICT')).toHaveLength(8);
    expect(held.filter((i) => i.truth === 'CONFLICT')).toHaveLength(9);
  });

  it('settles every rater split with a written ruling, and only splits', () => {
    for (const i of F.items) {
      if (i.raterA === i.raterB) expect(i.truth, i.id).toBe(i.raterA);
      else expect(i.ruling, i.id).toMatch(/^R\d$/);
    }
  });
});
