// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { _resetForTests, setImageVersions } from '@/lib/cards/card-image-versions';

// Perplexing Chimera (SLD 7039): cached on disk while Scryfall still served
// the preview phone photo, then re-scanned under stamp 1791120518.
const CHIMERA = '81cea94d-e8a2-4c88-b121-9806eb7cc210';
const url = (stamp: number, id = CHIMERA) =>
  `https://cards.scryfall.io/normal/front/8/1/${id}.jpg?${stamp}`;
// A second printing, so the no-stamp case below is not served from the memory
// cache the first test fills.
const OTHER = '11111111-e8a2-4c88-b121-9806eb7cc210';

const webp = (stamp: number, id = CHIMERA) =>
  `https://cards.scryfall.io/grid/front/8/1/${id}.webp?${stamp}`;

vi.mock('./cache', () => ({
  readCachedCards: async (keys: string[]) =>
    new Map(
      keys
        .filter((k) => k === CHIMERA || k === OTHER)
        .map((k) => [
          k,
          {
            id: k,
            name: 'Perplexing Chimera',
            legalities: { commander: 'legal' },
            image_uris: { normal: url(1790000000, k) },
          } as unknown as ScryfallCard,
        ])
    ),
  persistCard: () => {},
  flushPersistedCards: async () => {},
}));

import { getCardById } from './client';

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
});

afterEach(() => vi.unstubAllGlobals());

describe('disk-cached cards and image stamps', () => {
  it('serves a disk-cached card on the newest known image stamp, without a fetch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    setImageVersions({ [CHIMERA]: '1791120518' });
    const card = await getCardById(CHIMERA);
    expect(card.image_uris?.normal).toBe(webp(1791120518));
    expect(fetch).not.toHaveBeenCalled();
  });

  // E1088: a card cached on disk with JPEG URLs reads as WebP even on a device
  // that has never fetched a stamp map (the freshen seam no longer bails on an
  // empty map).
  it('serves a disk-cached JPEG card as WebP when no stamp is known', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const card = await getCardById(OTHER);
    expect(card.image_uris?.normal).toBe(webp(1790000000, OTHER));
    expect(fetch).not.toHaveBeenCalled();
  });
});
