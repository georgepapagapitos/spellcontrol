import { describe, it, expect } from 'vitest';
import { analyzeDeckSynergy } from './deckSynergy';
import { deriveNeeds, suggestOffMeta, type SynergyCandidate } from './suggest';
import { CORPUS, type CorpusCard } from './classify.fixtures';

const pick = (...names: string[]): CorpusCard[] =>
  names.map((n) => CORPUS.find((c) => c.name === n)!);
const cand = (name: string, inclusion?: number): SynergyCandidate => ({
  card: CORPUS.find((c) => c.name === name)!,
  inclusion,
});

describe('deriveNeeds', () => {
  it('flags a payoff need for a producer-heavy token engine', () => {
    // 5 token producers, 1 payoff → invested + lopsided toward producers.
    const deck = analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Grave Titan',
        'Bitterblossom',
        'Impact Tremors' // the lone payoff
      )
    );
    const needs = deriveNeeds(deck);
    expect(needs).toContainEqual(expect.objectContaining({ axis: 'tokens', side: 'payoff' }));
  });

  it('returns no needs for a balanced engine', () => {
    const deck = analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Impact Tremors',
        "Cathars' Crusade",
        'Intangible Virtue'
      )
    );
    expect(deriveNeeds(deck)).toEqual([]);
  });
});

describe('suggestOffMeta', () => {
  const producerHeavyTokens = () =>
    analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Grave Titan',
        'Bitterblossom',
        'Impact Tremors'
      )
    );

  it('suggests off-meta payoffs that fill the gap, with a reason', () => {
    const deck = producerHeavyTokens();
    const candidates = [
      cand("Cathars' Crusade", 12),
      cand('Intangible Virtue', 9),
      cand('Mirror Entity', 6),
      cand('Sol Ring', 80), // not a token payoff — must not appear
      cand('Counterspell', 4), // off-meta inclusion but no token payoff
    ];
    const suggestions = suggestOffMeta(deck, candidates);
    const names = suggestions.map((s) => s.cardName);
    expect(names).toContain("Cathars' Crusade");
    expect(names).toContain('Intangible Virtue');
    expect(names).not.toContain('Sol Ring');
    expect(names).not.toContain('Counterspell');
    for (const s of suggestions) {
      expect(s).toMatchObject({ axis: 'tokens', side: 'payoff' });
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });

  it('excludes consensus (too-high inclusion) and pure-jank (too-low) cards', () => {
    const deck = producerHeavyTokens();
    const candidates = [
      cand("Cathars' Crusade", 90), // consensus → excluded
      cand('Intangible Virtue', 0.5), // below the off-meta floor → excluded
      cand('Mirror Entity', 15), // in the window → kept
    ];
    const names = suggestOffMeta(deck, candidates).map((s) => s.cardName);
    expect(names).toEqual(['Mirror Entity']);
  });

  it('returns nothing when there are no needs', () => {
    const balanced = analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Impact Tremors',
        "Cathars' Crusade",
        'Intangible Virtue'
      )
    );
    expect(suggestOffMeta(balanced, [cand('Mirror Entity', 10)])).toEqual([]);
  });
});
