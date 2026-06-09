// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDeckTokens } from './use-deck-tokens';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(),
}));

const slim = (name: string): ScryfallCard => ({ name }) as unknown as ScryfallCard;

beforeEach(() => vi.clearAllMocks());

describe('useDeckTokens', () => {
  it('re-resolves slimmed deck cards and derives tokens from all_parts', async () => {
    vi.mocked(getCardsByNames).mockResolvedValue(
      new Map<string, ScryfallCard>([
        [
          'Krenko, Mob Boss',
          {
            name: 'Krenko, Mob Boss',
            all_parts: [
              { component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' },
            ],
          } as unknown as ScryfallCard,
        ],
        ['Mountain', { name: 'Mountain' } as unknown as ScryfallCard],
      ])
    );

    const { result } = renderHook(() =>
      useDeckTokens([slim('Krenko, Mob Boss'), slim('Mountain')])
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toEqual({
      name: 'Goblin',
      typeLine: 'Token Creature — Goblin',
      producers: ['Krenko, Mob Boss'],
    });
  });

  it('uses in-hand token data without a round-trip', async () => {
    const card = {
      name: 'Dockside Extortionist',
      tokens: [{ name: 'Treasure', typeLine: 'Token Artifact — Treasure' }],
    } as unknown as ScryfallCard;

    const { result } = renderHook(() => useDeckTokens([card]));

    expect(result.current.map((t) => t.name)).toEqual(['Treasure']);
    expect(getCardsByNames).not.toHaveBeenCalled();
  });

  it('stays empty (no throw) when resolution fails', async () => {
    vi.mocked(getCardsByNames).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDeckTokens([slim('Some Card')]));
    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
