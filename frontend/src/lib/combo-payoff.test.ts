import { describe, it, expect } from 'vitest';
import { PAYOFF_TIER, classifyPayoffResult, comboPayoffScore } from './combo-payoff';

describe('classifyPayoffResult', () => {
  it('classifies WIN results', () => {
    expect(classifyPayoffResult('Win the game')).toBe(PAYOFF_TIER.WIN);
    expect(classifyPayoffResult('Each opponent loses the game')).toBe(PAYOFF_TIER.WIN);
  });

  it('classifies LETHAL results', () => {
    expect(classifyPayoffResult('Infinite combat damage')).toBe(PAYOFF_TIER.LETHAL);
    expect(classifyPayoffResult('Infinite damage to any target')).toBe(PAYOFF_TIER.LETHAL);
    expect(classifyPayoffResult("Mill each opponent's library")).toBe(PAYOFF_TIER.LETHAL);
  });

  it('classifies ENGINE results', () => {
    expect(classifyPayoffResult('Infinite colorless mana')).toBe(PAYOFF_TIER.ENGINE);
    expect(classifyPayoffResult('Infinite card draw')).toBe(PAYOFF_TIER.ENGINE);
    expect(classifyPayoffResult('Infinite creature tokens')).toBe(PAYOFF_TIER.ENGINE);
    expect(classifyPayoffResult('Near-infinite turns')).toBe(PAYOFF_TIER.ENGINE);
  });

  it('classifies VALUE results', () => {
    expect(classifyPayoffResult('Lock the opponent out of their turn')).toBe(PAYOFF_TIER.VALUE);
    expect(classifyPayoffResult('Gain infinite life')).toBe(PAYOFF_TIER.VALUE);
  });

  it('classifies FORCED_DRAW results', () => {
    expect(classifyPayoffResult('Draw the game')).toBe(PAYOFF_TIER.FORCED_DRAW);
    expect(classifyPayoffResult('The game ends in a draw')).toBe(PAYOFF_TIER.FORCED_DRAW);
  });

  it('defaults unknown produces text to NEUTRAL', () => {
    expect(classifyPayoffResult('Some brand new Spellbook wording')).toBe(PAYOFF_TIER.NEUTRAL);
  });
});

describe('comboPayoffScore', () => {
  it('takes the MAX tier across all results', () => {
    expect(comboPayoffScore(['Infinite colorless mana', 'Win the game'])).toBe(PAYOFF_TIER.WIN);
    expect(comboPayoffScore(['Infinite creature tokens', 'Infinite combat damage'])).toBe(
      PAYOFF_TIER.LETHAL
    );
  });

  it('is negative only when EVERY result is a forced draw', () => {
    expect(comboPayoffScore(['Draw the game'])).toBe(PAYOFF_TIER.FORCED_DRAW);
    // A combo that also wins some other way isn't punished for a draw line.
    expect(comboPayoffScore(['Draw the game', 'Win the game'])).toBe(PAYOFF_TIER.WIN);
  });

  it('defaults to NEUTRAL for an empty produces list', () => {
    expect(comboPayoffScore([])).toBe(PAYOFF_TIER.NEUTRAL);
  });

  // Real-world Commander Spellbook combos (public produces text) spanning
  // every tier, proving the ladder actually discriminates rather than
  // dumping everything into one bucket.
  it('discriminates across a realistic fixture of Spellbook combos', () => {
    const fixture: Array<{ name: string; produces: string[] }> = [
      { name: 'Thassa’s Oracle + Demonic Consultation', produces: ['Win the game'] },
      {
        name: 'Kiki-Jiki, Mirror Breaker + Restoration Angel',
        produces: ['Infinite combat damage', 'Infinite creature tokens'],
      },
      { name: 'Basalt Monolith + Rings of Brighthearth', produces: ['Infinite colorless mana'] },
      {
        name: 'Isochron Scepter + Dramatic Reversal',
        produces: ['Infinite mana', 'Infinite card draw'],
      },
      {
        name: 'Mikaeus, the Unhallowed + Triskelion',
        produces: ['Infinite damage to any target', 'Infinite colorless mana'],
      },
      { name: 'Peregrin Took + Wound Reflection', produces: ['Gain infinite life'] },
      { name: 'Obscure lock combo', produces: ['Lock the opponent out of their turn'] },
      { name: 'Two-player draw loop', produces: ['The game ends in a draw'] },
    ];

    const byTier = new Map<number, number>();
    for (const { produces } of fixture) {
      const tier = comboPayoffScore(produces);
      byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
    }

    // At least three distinct tiers show up across this small fixture.
    expect(byTier.size).toBeGreaterThanOrEqual(3);
    expect(byTier.get(PAYOFF_TIER.WIN)).toBe(1);
    expect(byTier.get(PAYOFF_TIER.LETHAL)).toBe(2);
    expect(byTier.get(PAYOFF_TIER.ENGINE)).toBe(2);
    expect(byTier.get(PAYOFF_TIER.VALUE)).toBe(2);
    expect(byTier.get(PAYOFF_TIER.FORCED_DRAW)).toBe(1);
  });
});
