// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { _resetForTests, setImageVersions } from '@/lib/cards/card-image-versions';

// Perplexing Chimera (SLD 7039): cached on disk while Scryfall still served
// the preview phone photo, then re-scanned under stamp 1791120518.
const CHIMERA = '81cea94d-e8a2-4c88-b121-9806eb7cc210';
const url = (stamp: number) => `https://cards.scryfall.io/normal/front/8/1/${CHIMERA}.jpg?${stamp}`;

vi.mock('./cache', () => ({
  readCachedCards: async (keys: string[]) =>
    new Map(
      keys
        .filter((k) => k === CHIMERA)
        .map((k) => [
          k,
          {
            id: CHIMERA,
            name: 'Perplexing Chimera',
            legalities: { commander: 'legal' },
            image_uris: { normal: url(1790000000) },
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
    expect(card.image_uris?.normal).toBe(url(1791120518));
    expect(fetch).not.toHaveBeenCalled();
  });
});
