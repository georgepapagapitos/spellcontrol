// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { EDHRECCombo } from '@/deck-builder/types';

const fetchCommanderCombos = vi.fn();
const fetchCommanderData = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderCombos: (...a: unknown[]) => fetchCommanderCombos(...a),
  fetchCommanderData: (...a: unknown[]) => fetchCommanderData(...a),
}));

import { comboNameKey, buildComboOverlay, useEdhrecComboOverlay } from './edhrec-combo-overlay';

function combo(over: Partial<EDHRECCombo> & Pick<EDHRECCombo, 'cards'>): EDHRECCombo {
  return {
    comboId: 'x',
    results: [],
    deckCount: 0,
    rank: 0,
    bracket: null,
    prereqCount: 0,
    cardCount: over.cards.length,
    href: null,
    ...over,
  };
}

describe('comboNameKey', () => {
  it('is order- and case-insensitive', () => {
    expect(comboNameKey(['Thassa, Deep-Dwelling', 'Thassa'])).toBe(
      comboNameKey(['THASSA', 'thassa, deep-dwelling '])
    );
  });
});

describe('buildComboOverlay', () => {
  it('derives percent from the deck total and clamps to 100', () => {
    const map = buildComboOverlay(
      [combo({ cards: [{ name: 'A', id: 'a' }], deckCount: 30, rank: 2, href: '/c/1' })],
      120
    );
    const stat = map.get(comboNameKey(['A']));
    expect(stat).toEqual({ rank: 2, deckCount: 30, percent: 25, href: '/c/1' });
  });

  it('leaves percent null when the deck total is unknown', () => {
    const map = buildComboOverlay([combo({ cards: [{ name: 'A', id: 'a' }], deckCount: 9 })], 0);
    expect(map.get(comboNameKey(['A']))?.percent).toBeNull();
  });

  it('keeps the more-popular entry on a name-key collision', () => {
    const map = buildComboOverlay(
      [
        combo({ cards: [{ name: 'A', id: 'a' }], deckCount: 50, rank: 1 }),
        combo({ cards: [{ name: 'A', id: 'a' }], deckCount: 5, rank: 9 }),
      ],
      100
    );
    expect(map.get(comboNameKey(['A']))?.rank).toBe(1);
  });
});

describe('useEdhrecComboOverlay', () => {
  beforeEach(() => {
    fetchCommanderCombos.mockReset();
    fetchCommanderData.mockReset();
  });

  it('returns an empty map and never fetches without a commander', () => {
    const { result } = renderHook(() => useEdhrecComboOverlay(null));
    expect(result.current.size).toBe(0);
    expect(fetchCommanderCombos).not.toHaveBeenCalled();
  });

  it('builds the overlay from the two fetches', async () => {
    fetchCommanderCombos.mockResolvedValue([
      combo({ cards: [{ name: 'A', id: 'a' }], deckCount: 40, rank: 3, href: '/c/2' }),
    ]);
    fetchCommanderData.mockResolvedValue({ stats: { numDecks: 80 } });
    const { result } = renderHook(() => useEdhrecComboOverlay('Atraxa'));
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get(comboNameKey(['A']))).toEqual({
      rank: 3,
      deckCount: 40,
      percent: 50,
      href: '/c/2',
    });
  });

  it('degrades to percent-less stats when the commander fetch fails', async () => {
    fetchCommanderCombos.mockResolvedValue([
      combo({ cards: [{ name: 'A', id: 'a' }], deckCount: 9 }),
    ]);
    fetchCommanderData.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useEdhrecComboOverlay('Atraxa'));
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get(comboNameKey(['A']))?.percent).toBeNull();
  });
});
