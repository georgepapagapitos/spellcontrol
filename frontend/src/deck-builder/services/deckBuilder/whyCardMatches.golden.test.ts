import { describe, it, expect } from 'vitest';
import { type CommanderKeyword, type CommanderProfile } from './commanderProfile';
import { PILL_REASONS, whyCardMatches } from './whyCardMatches';
import type { ScryfallCard } from '@/deck-builder/types';
import golden from './__fixtures__/why-pills.golden.fixture.json';

// Guard for the "why it fits your commander" pills. The fixture is a golden set
// of 1,994 card × check pairs from real Oracle text, each rated by two blind
// raters against __fixtures__/why-pills.golden.md. Before this guard, 46% of
// the pills on the 500 most-played cards were right (Wild Growth read as
// "Suits up / protects your commander"; every fetchland read as a tutor).
//
// The test is a ratchet in both directions: a new miss fails, and so does
// fixing a known one until its knownMisses entry is deleted. To change what a
// pill means, edit the .md and re-rate the affected items first.

type Item = { check: string; name: string; truth: boolean; stratum: 'top500' | 'sample' };
type Fixture = {
  knownMisses: string[];
  cards: Record<string, Omit<ScryfallCard, 'name'>>;
  items: Item[];
};
const fixture = golden as unknown as Fixture;

const REASON = PILL_REASONS as Record<string, string>;

const profileFor = (keyword: string): CommanderProfile => ({
  commanderName: 'Test',
  colorIdentity: [],
  abilities: [
    { keyword: keyword as CommanderKeyword, label: '', evidence: '', wants: [], themes: [] },
  ],
  primaryArchetype: 'goodstuff' as CommanderProfile['primaryArchetype'],
  suggestedThemes: [],
  summary: '',
  tribes: [],
});

const results = fixture.items.map((item) => {
  const card = { name: item.name, ...fixture.cards[item.name] } as ScryfallCard;
  const fired = whyCardMatches(card, profileFor(item.check), 99).includes(REASON[item.check]);
  return { ...item, fired };
});
const misses = results
  .filter((r) => r.fired !== r.truth)
  .map((r) => `${r.fired ? 'FP' : 'FN'} ${r.check}: ${r.name}`);

function rates(stratum: Item['stratum']) {
  const rs = results.filter((r) => r.stratum === stratum);
  const tp = rs.filter((r) => r.fired && r.truth).length;
  return {
    precision: tp / rs.filter((r) => r.fired).length,
    recall: tp / rs.filter((r) => r.truth).length,
  };
}

describe('why-it-fits pills against the golden set', () => {
  it('covers every check with a reason string', () => {
    expect(new Set(fixture.items.map((i) => i.check)).size).toBe(Object.keys(REASON).length);
  });

  it('misses no card the golden set does not already list as a known miss', () => {
    const known = new Set(fixture.knownMisses);
    expect(misses.filter((m) => !known.has(m))).toEqual([]);
  });

  it('lists only misses that still happen (delete fixed ones from knownMisses)', () => {
    const now = new Set(misses);
    expect(fixture.knownMisses.filter((m) => !now.has(m))).toEqual([]);
  });

  it('keeps precision and recall at their measured floors', () => {
    const top = rates('top500');
    const sample = rates('sample');
    expect(top.precision).toBeGreaterThanOrEqual(0.99);
    expect(top.recall).toBeGreaterThanOrEqual(0.99);
    expect(sample.precision).toBeGreaterThanOrEqual(0.95);
    expect(sample.recall).toBeGreaterThanOrEqual(0.87);
  });
});
