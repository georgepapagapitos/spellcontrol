import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { budgetTradeLoss, pickTrade, stapleTarget, type BudgetTrade } from './budgetTradeLoss';

const card = (name: string, usd: number) =>
  ({ name, prices: { usd: String(usd) } }) as ScryfallCard;
const priceOf = (c: ScryfallCard) => Number(c.prices?.usd);

describe('budgetTradeLoss', () => {
  // E1046's first gate: read on the budget page alone, Hobgoblin Bandit Lord
  // (62% standard, 17% budget) traded evenly for Sarpadian Simulacrum.
  it("reads each card's best figure on either page", () => {
    const { leastLossPick } = budgetTradeLoss(
      new Map([['Bandit Lord', 62]]),
      new Map([
        ['Bandit Lord', 17],
        ['Simulacrum', 17],
        ['Played Goblin', 40],
      ]),
      priceOf
    );
    const pairs = [{ sc: card('Simulacrum', 0.1) }, { sc: card('Played Goblin', 1) }];
    // Simulacrum gives up 45 points for $3.40 (13.2 a dollar), Played Goblin 22 for $2.50 (8.8).
    expect(leastLossPick(card('Bandit Lord', 3.5), 3.5, pairs).sc.name).toBe('Played Goblin');
  });

  // Tatyova: a cut card played less than every candidate loses nothing to any
  // of them, and price alone took Divert Disaster (6%) over Grow from the Ashes (29%).
  it('breaks a tie on the more played candidate, then the cheaper', () => {
    const { leastLossPick } = budgetTradeLoss(
      new Map([
        ['Waterskin', 5],
        ['Grow from the Ashes', 29],
        ['Divert Disaster', 6],
        ['Also Played', 29],
      ]),
      new Map(),
      priceOf
    );
    const pairs = [
      { sc: card('Divert Disaster', 0.1) },
      { sc: card('Also Played', 0.5) },
      { sc: card('Grow from the Ashes', 0.3) },
    ];
    expect(leastLossPick(card('Waterskin', 1), 1, pairs).sc.name).toBe('Grow from the Ashes');
  });

  describe('pickTrade', () => {
    const trade = (card: string, lost: number, saved: number): BudgetTrade<string> => ({
      card,
      price: saved + 0.1,
      replacement: `${card} swap`,
      saved,
      lost,
    });

    it('follows the least play lost per dollar', () => {
      // B then C closes $3 for 10 points; A alone would give up 40.
      const pick = pickTrade([trade('A', 40, 4), trade('B', 5, 2), trade('C', 5, 2)], 3);
      expect(pick?.card).toBe('B');
    });

    it('takes one trade that closes the gap when the order would overshoot past it', () => {
      // By rate B goes first (5 a dollar), but B alone leaves $2 open and A
      // then closes it: 45 points against 40 for A alone.
      const pick = pickTrade([trade('A', 40, 4), trade('B', 5, 1)], 3);
      expect(pick?.card).toBe('A');
    });

    it('prefers the larger saving when two trades lose nothing', () => {
      expect(pickTrade([trade('A', 0, 1), trade('B', 0, 3)], 5)?.card).toBe('B');
    });

    it('has nothing to pick from an empty list', () => {
      expect(pickTrade([], 1)).toBeNull();
    });
  });

  describe('stapleTarget', () => {
    const trade = (saved: number): BudgetTrade<string> => ({
      card: 'A',
      price: saved + 1,
      replacement: 'B',
      saved,
      lost: 10,
    });

    // Yuriko $100: trading to the bare gap left a later pass $3 short of Temporal Trespass.
    it('trades a budget step under the budget when the trades can reach it', () => {
      expect(stapleTarget([trade(6), trade(6)], 110, 100)).toBe(99);
      expect(stapleTarget([trade(3)], 27, 25)).toBe(24.5);
    });

    // User ruling 2026-10-28: a deck that can't fit keeps its staples up to 25% over.
    it('keeps the staples up to 25% over when the trades cannot reach the budget', () => {
      expect(stapleTarget([trade(1)], 30, 25)).toBe(31.25);
    });
  });
});
