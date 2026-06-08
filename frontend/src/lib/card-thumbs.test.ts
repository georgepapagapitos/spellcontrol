// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';

const getCardsByNames = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: (names: string[]) => getCardsByNames(names),
}));

import {
  imageFromCard,
  loadCard,
  useCardThumb,
  __resetCardThumbCacheForTests,
} from './card-thumbs';

function card(name: string, normal: string): ScryfallCard {
  return {
    name,
    image_uris: { normal, small: `${normal}-s`, large: `${normal}-l` },
  } as ScryfallCard;
}

beforeEach(() => {
  __resetCardThumbCacheForTests();
  getCardsByNames.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('imageFromCard', () => {
  it('reads the requested version off image_uris', () => {
    expect(imageFromCard(card('Bolt', 'http://cdn/bolt.png'), 'normal')).toBe(
      'http://cdn/bolt.png'
    );
    expect(imageFromCard(card('Bolt', 'http://cdn/bolt.png'), 'small')).toBe(
      'http://cdn/bolt.png-s'
    );
  });

  it('falls back to the front face for double-faced cards', () => {
    const dfc = {
      name: 'Front // Back',
      card_faces: [{ image_uris: { normal: 'http://cdn/front.png' } }],
    } as ScryfallCard;
    expect(imageFromCard(dfc, 'normal')).toBe('http://cdn/front.png');
  });

  it('returns undefined when no art is present', () => {
    expect(imageFromCard({ name: 'Mystery' } as ScryfallCard, 'normal')).toBeUndefined();
  });
});

describe('loadCard', () => {
  it('resolves a name to its card and caches the result (no second fetch)', async () => {
    getCardsByNames.mockResolvedValue(
      new Map([['Moggcatcher', card('Moggcatcher', 'http://cdn/mog.png')]])
    );
    const first = await loadCard('Moggcatcher');
    expect(first?.image_uris?.normal).toBe('http://cdn/mog.png');
    const second = await loadCard('Moggcatcher');
    expect(second?.image_uris?.normal).toBe('http://cdn/mog.png');
    expect(getCardsByNames).toHaveBeenCalledTimes(1);
  });

  it('coalesces names requested in the same tick into one batched call', async () => {
    getCardsByNames.mockResolvedValue(
      new Map([
        ['Young Pyromancer', card('Young Pyromancer', 'http://cdn/yp.png')],
        ['Moggcatcher', card('Moggcatcher', 'http://cdn/mog.png')],
      ])
    );
    const [a, b] = await Promise.all([loadCard('Young Pyromancer'), loadCard('Moggcatcher')]);
    expect(a?.name).toBe('Young Pyromancer');
    expect(b?.name).toBe('Moggcatcher');
    expect(getCardsByNames).toHaveBeenCalledTimes(1);
    expect(getCardsByNames).toHaveBeenCalledWith(['Young Pyromancer', 'Moggcatcher']);
  });

  it('caches a miss as null so it never re-hits the network', async () => {
    getCardsByNames.mockResolvedValue(new Map());
    expect(await loadCard('Nonexistent Card')).toBeNull();
    expect(await loadCard('Nonexistent Card')).toBeNull();
    expect(getCardsByNames).toHaveBeenCalledTimes(1);
  });

  it('degrades to null (not a throw) when the batch fetch fails', async () => {
    getCardsByNames.mockRejectedValue(new Error('429'));
    expect(await loadCard('Boom')).toBeNull();
  });
});

describe('useCardThumb', () => {
  it('resolves a name to a CDN url', async () => {
    getCardsByNames.mockResolvedValue(new Map([['Bolt', card('Bolt', 'http://cdn/bolt.png')]]));
    const { result } = renderHook(() => useCardThumb('Bolt', 'normal'));
    await waitFor(() => expect(result.current).toBe('http://cdn/bolt.png'));
  });

  it('returns undefined for an empty name and never fetches', () => {
    const { result } = renderHook(() => useCardThumb(undefined));
    expect(result.current).toBeUndefined();
    expect(getCardsByNames).not.toHaveBeenCalled();
  });

  it('serves a warm-cache hit synchronously on mount', async () => {
    getCardsByNames.mockResolvedValue(
      new Map([['Sol Ring', card('Sol Ring', 'http://cdn/sol.png')]])
    );
    await loadCard('Sol Ring'); // warm the cache
    const { result } = renderHook(() => useCardThumb('Sol Ring', 'normal'));
    expect(result.current).toBe('http://cdn/sol.png');
  });
});
