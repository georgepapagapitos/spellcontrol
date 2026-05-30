import { describe, it, expect } from 'vitest';
import { analyzeDeckSynergy } from './deckSynergy';
import { buildSynergyAnalysis } from './analysis';
import type { SynergyCandidate } from './suggest';
import { CORPUS } from './classify.fixtures';

const pick = (...names: string[]) => names.map((n) => CORPUS.find((c) => c.name === n)!);
const cand = (name: string, inclusion?: number): SynergyCandidate => ({
  card: CORPUS.find((c) => c.name === name)!,
  inclusion,
});

describe('buildSynergyAnalysis', () => {
  it('composes headline, axis counts, warnings and suggestions', () => {
    // Producer-heavy token engine → payoff-starved warning + payoff suggestions.
    const deck = analyzeDeckSynergy(
      pick(
        'Krenko, Mob Boss',
        'Secure the Wastes',
        'Hornet Queen',
        'Grave Titan',
        'Bitterblossom',
        'Impact Tremors'
      )
    );
    const analysis = buildSynergyAnalysis(deck, [
      cand("Cathars' Crusade", 12),
      cand('Mirror Entity', 8),
    ]);

    expect(analysis.headline).toMatch(/Tokens/);
    const tokens = analysis.axes.find((a) => a.axis === 'tokens')!;
    expect(tokens.producers).toBeGreaterThanOrEqual(4);
    expect(tokens.payoffs).toBe(1);
    // 5 producers : 1 payoff trips the suggester's 3:1 need → payoff fills.
    expect(analysis.suggestions.map((s) => s.cardName)).toContain("Cathars' Crusade");
    expect(analysis.suggestions.every((s) => s.side === 'payoff')).toBe(true);
  });

  it('returns empty suggestions when there are no candidates', () => {
    const deck = analyzeDeckSynergy(pick('Sol Ring', 'Counterspell', 'Lightning Bolt'));
    const analysis = buildSynergyAnalysis(deck, []);
    expect(analysis.suggestions).toEqual([]);
  });
});
