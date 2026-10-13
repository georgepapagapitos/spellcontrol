import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import landFixture from './__fixtures__/land-budget.fixture.json';
import { fetchPassingWindows } from './fetchPassingWindows';

// Recorded lands, priciest first: a $0.50 cap fails the whole first window.
const LANDS = [...landFixture.lands].sort((a, b) => Number(b.price_usd) - Number(a.price_usd));
const card = (name: string): ScryfallCard => {
  const l = LANDS.find((x) => x.name === name)!;
  return { name, prices: { usd: l.price_usd } } as unknown as ScryfallCard;
};
const cheap = (c: ScryfallCard) => Number(c.prices?.usd) <= 0.5;

describe('fetchPassingWindows', () => {
  it('walks past a window the gate fails entirely, until enough cards pass', async () => {
    const fetchWindow = vi.fn(async (names: string[]) => new Map(names.map((n) => [n, card(n)])));
    const out = await fetchPassingWindows(
      LANDS.map((l) => l.name),
      5,
      4,
      fetchWindow,
      cheap
    );
    expect([...out.values()].filter(cheap).length).toBeGreaterThanOrEqual(5);
    expect(fetchWindow.mock.calls.length).toBeGreaterThan(1);
    // The expensive head is in the result too: the caller's own gates still decide.
    expect(out.has(LANDS[0].name)).toBe(true);
  });

  it('stops at the first window when it already holds enough', async () => {
    const fetchWindow = vi.fn(async (names: string[]) => new Map(names.map((n) => [n, card(n)])));
    await fetchPassingWindows(
      LANDS.map((l) => l.name),
      2,
      4,
      fetchWindow,
      () => true
    );
    expect(fetchWindow).toHaveBeenCalledTimes(1);
  });

  it('gives up when the names run out', async () => {
    const out = await fetchPassingWindows(
      ['Sol Ring'],
      10,
      4,
      async (names) => new Map(names.map((n) => [n, { name: n } as ScryfallCard])),
      () => false
    );
    expect(out.size).toBe(1);
  });
});
