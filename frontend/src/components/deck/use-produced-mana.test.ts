// @vitest-environment happy-dom
//
// The seam between "which names need production" and "hand the analysis cards
// that carry it". The pure halves are guarded in `lib/produced-mana.test.ts`;
// what is only testable here is WHEN the lookup happens — and the one that
// matters is that a deck already carrying production makes no request, so this
// costs a modern deck nothing.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { useProducedMana } from './use-produced-mana';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(),
}));

const solRing = (extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({
    id: 'sol-ring',
    name: 'Sol Ring',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    ...extra,
  }) as ScryfallCard;

beforeEach(() => vi.clearAllMocks());

describe('useProducedMana', () => {
  it('hands back cards carrying the resolved production', async () => {
    vi.mocked(getCardsByNames).mockResolvedValue(
      new Map([['Sol Ring', solRing({ produced_mana: ['C'] })]])
    );
    const cards = [solRing()];

    const { result } = renderHook(() => useProducedMana(cards));

    await waitFor(() => expect(result.current[0].produced_mana).toEqual(['C']));
  });

  it('asks for nothing when every card already carries production', () => {
    renderHook(() => useProducedMana([solRing({ produced_mana: ['C'] })]));
    expect(getCardsByNames).not.toHaveBeenCalled();
  });

  it('returns the input untouched when the lookup fails', async () => {
    vi.mocked(getCardsByNames).mockRejectedValue(new Error('offline'));
    const cards = [solRing()];

    const { result } = renderHook(() => useProducedMana(cards));

    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    expect(result.current).toBe(cards);
  });
});
