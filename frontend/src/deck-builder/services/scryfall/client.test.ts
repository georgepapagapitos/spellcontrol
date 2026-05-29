import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

// Controllable offline gate + offline-lib stubs. `getOwnedPrinting` forks on
// `offlineActive()` and, on the offline/fallback path, resolves by name through
// the offline repository — so both the store gate and `@/lib/offline` are mocked.
const gate = vi.hoisted(() => ({ offline: false }));
const offlineLib = vi.hoisted(() => ({ getCardByName: vi.fn() }));

vi.mock('@/store/offline', () => ({
  useOfflineStore: { getState: () => ({}) },
  offlineDataAvailable: () => gate.offline,
}));

vi.mock('@/lib/offline', () => ({
  offlineGetCardByName: (name: string) => offlineLib.getCardByName(name),
  offlineGetCardsByNames: vi.fn(),
  offlineSearchCards: vi.fn(),
}));

import { isPlayableCard, getCardById, getOwnedPrinting } from './client';

function makeCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'x',
    oracle_id: 'x',
    name: 'Arcane Signet',
    cmc: 2,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'cmm',
    set_name: 'Commander Masters',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

describe('isPlayableCard', () => {
  it('accepts a normal printing', () => {
    expect(isPlayableCard(makeCard({ layout: 'normal' }))).toBe(true);
  });

  it('accepts a card with no layout field (defensive)', () => {
    expect(isPlayableCard(makeCard({}))).toBe(true);
  });

  it('rejects art_series — the Commander Masters Art Series Arcane Signet case', () => {
    expect(
      isPlayableCard(
        makeCard({
          layout: 'art_series',
          set: 'acmm',
          set_name: 'Commander Masters Art Series',
          legalities: { commander: 'not_legal' },
        })
      )
    ).toBe(false);
  });

  it('rejects tokens, emblems, schemes, planes, and vanguards', () => {
    for (const layout of [
      'token',
      'double_faced_token',
      'emblem',
      'scheme',
      'planar',
      'vanguard',
    ]) {
      expect(isPlayableCard(makeCard({ layout }))).toBe(false);
    }
  });

  it('accepts DFC-ish layouts that ARE real cards', () => {
    for (const layout of ['transform', 'modal_dfc', 'split', 'flip', 'adventure', 'meld']) {
      expect(isPlayableCard(makeCard({ layout }))).toBe(true);
    }
  });
});

describe('getCardById', () => {
  beforeEach(() => {
    gate.offline = false;
    offlineLib.getCardByName.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the exact printing by id and preserves that id', async () => {
    const card = makeCard({
      id: 'foil-print-1',
      name: 'Korvold, Fae-Cursed King',
      layout: 'normal',
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => card });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardById('foil-print-1');

    expect(result.id).toBe('foil-print-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/cards/foil-print-1');
  });

  it('throws when the printing resolves to a non-playable layout', async () => {
    const artCard = makeCard({
      id: 'art-1',
      layout: 'art_series',
      legalities: { commander: 'not_legal' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => artCard }));

    await expect(getCardById('art-1')).rejects.toThrow(/non-playable/);
  });
});

describe('getOwnedPrinting', () => {
  beforeEach(() => {
    gate.offline = false;
    offlineLib.getCardByName.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('live: returns the owned printing straight from /cards/:id', async () => {
    const card = makeCard({ id: 'owned-print', name: 'Atraxa, Praetors’ Voice', layout: 'normal' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => card }));

    const result = await getOwnedPrinting('owned-print', 'Atraxa, Praetors’ Voice');

    expect(result.id).toBe('owned-print');
  });

  it('falls back to name resolution + id override when the id is unknown to Scryfall', async () => {
    // /cards/:id 404s, then liveGetCardByName succeeds via /cards/named.
    const named = makeCard({
      id: 'cheapest-print',
      name: 'Edgar Markov',
      layout: 'normal',
    });
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) return { ok: false, status: 404, statusText: 'Not Found' };
        return { ok: true, json: async () => named };
      })
    );

    const result = await getOwnedPrinting('owned-but-stale', 'Edgar Markov');

    // Full card data from the name lookup, but the id is the owned printing so
    // the allocator binds the physical copy.
    expect(result.name).toBe('Edgar Markov');
    expect(result.id).toBe('owned-but-stale');
  });

  it('offline: resolves by name and overrides the id with the owned printing', async () => {
    gate.offline = true;
    offlineLib.getCardByName.mockResolvedValue(
      makeCard({ id: 'oracle-representative', name: 'Muldrotha, the Gravetide', layout: 'normal' })
    );

    const result = await getOwnedPrinting('my-foil-muldrotha', 'Muldrotha, the Gravetide');

    expect(result.name).toBe('Muldrotha, the Gravetide');
    expect(result.id).toBe('my-foil-muldrotha');
    // Never hit the network in offline mode.
    expect(offlineLib.getCardByName).toHaveBeenCalledWith('Muldrotha, the Gravetide');
  });
});
