import { describe, it, expect } from 'vitest';
import { buildCommanderProfile } from './commanderProfile';
import type { ScryfallCard } from '@/deck-builder/types';
import golden from './__fixtures__/commander-profile.golden.fixture.json';

// Guard for the commander side of the profile: which themes and keywords
// buildCommanderProfile claims for a commander. The fixture is 670 real
// commanders (real Oracle text), each tagged with every keyword by two blind
// raters against __fixtures__/commander-profile.golden.md. Before this guard the
// bare-word detectors profiled a vanilla Human as tribal (11% precise), any
// flyer as voltron (12%) and every "you lose 1 life" as a drain (81%).
//
// A ratchet in both directions: a new miss fails, and so does fixing a known
// one until its knownMisses entry is deleted. To change what a keyword means,
// edit the .md and re-rate the affected commanders first.

type Item = { name: string; stratum: 'top' | 'sample' | 'extra'; truth: string[] };
type Fixture = {
  keywords: string[];
  knownMisses: string[];
  cards: Record<string, Omit<ScryfallCard, 'name'>>;
  items: Item[];
};
const fixture = golden as unknown as Fixture;

const results = fixture.items.map((item) => {
  const card = { name: item.name, ...fixture.cards[item.name] } as ScryfallCard;
  const fired = new Set<string>(buildCommanderProfile(card).abilities.map((a) => a.keyword));
  return { ...item, fired };
});

const misses = results.flatMap((r) =>
  fixture.keywords.flatMap((k) => {
    const f = r.fired.has(k);
    const t = r.truth.includes(k);
    return f === t ? [] : [`${f ? 'FP' : 'FN'} ${k}: ${r.name}`];
  })
);

/** Micro-averaged over every keyword, on the two unbiased strata. */
function rates(strata: Item['stratum'][]) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of results.filter((x) => strata.includes(x.stratum))) {
    for (const k of fixture.keywords) {
      const f = r.fired.has(k);
      const t = r.truth.includes(k);
      if (f && t) tp++;
      else if (f) fp++;
      else if (t) fn++;
    }
  }
  return { precision: tp / (tp + fp), recall: tp / (tp + fn) };
}

describe('commander profile against the golden set', () => {
  it('rates every keyword the profile emits', () => {
    const emitted = new Set(results.flatMap((r) => [...r.fired]));
    for (const k of emitted) expect(fixture.keywords).toContain(k);
  });

  it('misses no commander the golden set does not already list as a known miss', () => {
    const known = new Set(fixture.knownMisses);
    expect(misses.filter((m) => !known.has(m))).toEqual([]);
  });

  it('lists only misses that still happen (delete fixed ones from knownMisses)', () => {
    const now = new Set(misses);
    expect(fixture.knownMisses.filter((m) => !now.has(m))).toEqual([]);
  });

  it('keeps micro precision and recall at their measured floors', () => {
    const { precision, recall } = rates(['top', 'sample']);
    expect(precision).toBeGreaterThanOrEqual(0.88);
    expect(recall).toBeGreaterThanOrEqual(0.88);
  });

  it('keeps the two keywords that were worst at their measured floors', () => {
    const per = (k: string) => {
      const rs = results.filter((r) => r.stratum !== 'extra');
      const tp = rs.filter((r) => r.fired.has(k) && r.truth.includes(k)).length;
      const fired = rs.filter((r) => r.fired.has(k)).length;
      return tp / fired;
    };
    expect(per('tribal')).toBeGreaterThanOrEqual(0.6);
    expect(per('voltron')).toBeGreaterThanOrEqual(0.7);
  });
});
