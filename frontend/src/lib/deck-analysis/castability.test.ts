import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { analyzeCastability, costChangingCommander, wilsonUpper } from './castability';
import { brago, BRAGO_TAPPED_DUALS, card, cards } from '@/lib/mana-sim/__fixtures__/decks';

/**
 * Karsten's own test deck shape over real Scryfall records: `islands` blue
 * sources, the rest of 41 lands Plains, and 58 copies of a {U}{U} two-drop.
 * His table puts {U}{U} on turn 2 at 30 sources for the 91% bar.
 */
function lordDeck(islands: number) {
  return cards([
    ['Island', islands],
    ['Plains', 41 - islands],
    ['Lord of Atlantis', 58],
  ]);
}

describe('wilsonUpper', () => {
  it('bounds a well-measured rate tightly and a thin one loosely', () => {
    // Incinerator of the Guilty on a real Henzie list: 89.8% over ~1,600 games.
    expect(wilsonUpper(0.898, 1600)).toBeLessThan(0.95);
    // Massacre Wurm on the same list: 94.7% over ~1,200 games is not under 95%.
    expect(wilsonUpper(0.947, 1200)).toBeGreaterThan(0.95);
    expect(wilsonUpper(0.5, 0)).toBe(1);
  });
});

describe('costChangingCommander', () => {
  // Henzie's real Oracle text (Scryfall, 2026-10-10).
  const henzie = {
    name: 'Henzie "Toolbox" Torre',
    oracle_text:
      'Each creature spell you cast with mana value 4 or greater has blitz. The blitz cost is equal to its mana cost. (You may choose to cast that spell for its blitz cost. If you do, it gains haste and "When this creature dies, draw a card." Sacrifice it at the beginning of the next end step.)\nBlitz costs you pay cost {1} less for each time you\'ve cast your commander from the command zone this game.',
  } as ScryfallCard;

  it('names a commander that changes what spells cost', () => {
    expect(costChangingCommander([henzie])).toBe('Henzie "Toolbox" Torre');
  });

  it('stays quiet for commanders that leave costs alone', () => {
    expect(costChangingCommander([card('Brago, King Eternal'), card('Jodah, the Unifier')])).toBe(
      null
    );
    expect(costChangingCommander([])).toBeNull();
  });

  it('reads a double-faced commander face by face', () => {
    const dfc = {
      name: 'Front // Back',
      card_faces: [{ oracle_text: 'Flying' }, { oracle_text: 'Spells you cast cost {1} less.' }],
    } as unknown as ScryfallCard;
    expect(costChangingCommander([dfc])).toBe('Front // Back');
  });
});

describe('analyzeCastability', () => {
  it('lists a {U}{U} two-drop at half the sources it needs, and blames blue', () => {
    const report = analyzeCastability([], lordDeck(15));
    expect(report.measured).toBe(1);
    expect(report.under).toHaveLength(1);
    const [lord] = report.under;
    expect(lord).toMatchObject({ name: 'Lord of Atlantis', mv: 2, commander: false });
    // Karsten's table reads 49.2% at 15 sources.
    expect(lord.rate).toBeGreaterThan(0.4);
    expect(lord.rate).toBeLessThan(0.6);
    expect(lord.bar).toBeCloseTo(0.91);
    expect(lord.short?.symbol).toBe('U');
    expect(report.tightSymbol).toBe('U');
    expect(report.atBar).toEqual([]);
  });

  it('lists nothing when every land makes the color', () => {
    const report = analyzeCastability([], lordDeck(41));
    expect(report.under).toEqual([]);
    expect(report.atBar).toEqual([]);
    expect(report.tightSymbol).toBeNull();
    expect(report.average).toBeGreaterThan(0.99);
  });

  it('lists a card the deck can never cast at 0%', () => {
    const report = analyzeCastability([], lordDeck(0));
    expect(report.under).toHaveLength(1);
    expect(report.under[0].rate).toBe(0);
    expect(report.under[0].short).toEqual({ symbol: 'U', share: 1 });
  });

  it('measures the commander alongside the library and marks it', () => {
    const deck = brago(BRAGO_TAPPED_DUALS);
    const report = analyzeCastability(deck.commanders, deck.library, 1000);
    expect(report.games).toBe(1000);
    // Brago plus the measurable spells; every listed row is a real card in the deck.
    expect(report.measured).toBeGreaterThan(1);
    const names = new Set([card('Brago, King Eternal'), ...deck.library].map((c) => c.name));
    for (const row of [...report.under, ...report.atBar]) {
      expect(names.has(row.name)).toBe(true);
      expect(row.rate).toBeLessThan(row.bar);
      expect(row.commander).toBe(row.name === 'Brago, King Eternal');
    }
    // The gap ordering holds: the worst shortfall leads.
    for (let i = 1; i < report.under.length; i++) {
      const prev = report.under[i - 1];
      const cur = report.under[i];
      expect(prev.bar - prev.rate).toBeGreaterThanOrEqual(cur.bar - cur.rate);
    }
  });

  it('gives the same answer for the same list', () => {
    const a = analyzeCastability([], lordDeck(22), 1000);
    const b = analyzeCastability([], lordDeck(22), 1000);
    expect(b).toEqual(a);
  });
});
