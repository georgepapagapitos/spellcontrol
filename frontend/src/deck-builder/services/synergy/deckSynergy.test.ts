import { describe, it, expect } from 'vitest';
import { analyzeDeckSynergy, isLoadBearing } from './deckSynergy';
import { CORPUS, type CorpusCard } from './classify.fixtures';

const pick = (...names: string[]): CorpusCard[] =>
  names.map((n) => CORPUS.find((c) => c.name === n)!);

describe('analyzeDeckSynergy', () => {
  it('identifies a token engine and ranks it first', () => {
    const deck = pick(
      'Krenko, Mob Boss',
      'Secure the Wastes',
      'Hornet Queen',
      'Grave Titan',
      'Bitterblossom',
      "Cathars' Crusade",
      'Impact Tremors',
      'Intangible Virtue',
      'Craterhoof Behemoth',
      'Divine Visitation'
    );
    const res = analyzeDeckSynergy(deck);
    expect(res.invested).toContain('tokens');
    expect(res.axes[0].axis).toBe('tokens');
    expect(res.axes[0].producers.length).toBeGreaterThanOrEqual(4);
    expect(res.axes[0].payoffs.length).toBeGreaterThanOrEqual(4);
    expect(res.headline).toMatch(/Tokens/);
  });

  it('warns when an axis is payoff-starved', () => {
    // 5 payoffs, 0 producers on tokens.
    const deck = pick(
      'Impact Tremors',
      "Cathars' Crusade",
      'Intangible Virtue',
      'Craterhoof Behemoth',
      'Mirror Entity'
    );
    const res = analyzeDeckSynergy(deck);
    expect(res.warnings.some((w) => /payoff/i.test(w) && /producer/i.test(w))).toBe(true);
  });

  it('flags a load-bearing token card in an invested token deck', () => {
    const deck = pick(
      'Krenko, Mob Boss',
      'Secure the Wastes',
      'Hornet Queen',
      'Bitterblossom',
      'Impact Tremors',
      'Intangible Virtue'
    );
    const res = analyzeDeckSynergy(deck);
    // Scute Swarm (a low-inclusion token producer) is load-bearing here…
    expect(isLoadBearing(pick('Scute Swarm')[0], res)).toBe(true);
    // …but Sol Ring (no axis) is not.
    expect(isLoadBearing(pick('Sol Ring')[0], res)).toBe(false);
  });

  it('returns no engine for a pile of unrelated goodstuff', () => {
    const deck = pick('Sol Ring', 'Counterspell', 'Lightning Bolt', 'Cultivate', 'Rhystic Study');
    const res = analyzeDeckSynergy(deck);
    expect(res.invested).toEqual([]);
    expect(res.headline).toMatch(/No clear/);
  });
});
