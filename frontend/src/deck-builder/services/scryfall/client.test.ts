import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pending } from '@/test/pending';
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

import {
  isPlayableCard,
  getCardById,
  getCardByName,
  getCardsByNames,
  getCardsByIds,
  getOwnedPrinting,
  getCardByNameResilient,
  searchCards,
  searchTokenArt,
  commanderSearchIdentity,
  upgradeCardPrintings,
  validateScryfallFilter,
} from './client';
import { resetScryfallRateLimit } from '@/lib/scryfall-fetch';

// The Scryfall limiter is a module singleton with a shared cooldown. A test that
// serves `Retry-After: 60` under fake timers would otherwise leave a cooldown
// stamped ~60s into the future and stall whatever runs next.
beforeEach(() => {
  resetScryfallRateLimit();
});

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

describe('searchTokenArt (E139 playtest token art)', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strips a "N/N [keywords]" suffix and searches t:token by base name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [makeCard({ layout: 'token' })] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const url = await searchTokenArt('Soldier 1/1');

    expect(url).toBeTruthy();
    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(requestedUrl)).toContain('t:token Soldier');
    expect(decodeURIComponent(requestedUrl)).not.toContain('1/1');
  });

  it('resolves image_uris.normal from the first match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            makeCard({
              layout: 'token',
              image_uris: { normal: 'https://cards.scryfall.io/normal/treasure.jpg' } as never,
            }),
          ],
        }),
      })
    );

    expect(await searchTokenArt('Treasure')).toBe('https://cards.scryfall.io/normal/treasure.jpg');
  });

  it('returns null when the search has no results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    );
    expect(await searchTokenArt('Some Made Up Token')).toBeNull();
  });

  it('returns null (never throws) on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })
    );
    expect(await searchTokenArt('Clue')).toBeNull();
  });

  it('short-circuits with no network call when the offline bundle is active', async () => {
    gate.offline = true;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await searchTokenArt('Food')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for a blank display name', async () => {
    expect(await searchTokenArt('   ')).toBeNull();
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

    await expect(getCardById('art-1')).rejects.toThrow(/can't be played/);
  });
});

// Color-identity filter semantics. Two callers, two meanings for []:
//  - Generic surfaces (collection add, lists, scanner, binder-rule preview)
//    pass [] to mean "unrestricted". An implicit []→id<=c fallback (defect A's
//    first fix) made all of them colorless-only, 404-ing every non-colorless
//    search in prod ("bolas's citadel" from the collection add panel).
//  - Deck generation means "colorless commander" (Kozilek) — that intent is
//    expressed explicitly via commanderSearchIdentity, which keeps the original
//    defect-A fix (Omniscience seated in a colorless deck through the
//    unfiltered gap; scryfallFill has no client-side identity check).
describe('searchCards color-identity query', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies no color filter for an empty colorIdentity (generic search is unrestricted)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) });
    vi.stubGlobal('fetch', fetchMock);

    await searchCards('t:enchantment', []);

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).not.toContain('id<=');
  });

  it('filters to colorless via commanderSearchIdentity for a colorless commander', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) });
    vi.stubGlobal('fetch', fetchMock);

    await searchCards('t:enchantment', commanderSearchIdentity([]));

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain('id<=C');
  });

  it('passes a colored commander identity through unchanged', () => {
    expect(commanderSearchIdentity(['U', 'B'])).toEqual(['U', 'B']);
  });

  it('still filters normally for a nonempty colorIdentity', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) });
    vi.stubGlobal('fetch', fetchMock);

    await searchCards('t:enchantment', ['U', 'B']);

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain('id<=UB');
  });
});

// Scryfall answers /cards/search with 404 when the query matched nothing. That
// is an empty result set, not an error — surfacing it as one printed "Scryfall
// API error: 404 Not Found" at the user in every search box.
describe('search 404 = no matches', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves to an empty result set instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    );

    const resp = await searchCards('t:zzzznothingmatchesthis', []);

    expect(resp.data).toEqual([]);
    expect(resp.has_more).toBe(false);
  });

  it('still throws on a real failure (500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' })
    );

    await expect(searchCards('t:zzzzserverdown', [])).rejects.toThrow(/temporarily unavailable/);
  });
});

// Three search surfaces render a thrown error's `.message` verbatim, so the
// message IS the UI copy. Raw HTTP/browser strings ("Scryfall API error: 503
// Service Unavailable", "NetworkError when attempting to fetch resource")
// used to reach players directly.
describe('user-facing failure messages', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns a rejected fetch into a connection message, not a raw TypeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.'))
    );

    await expect(searchCards('t:zzzzoffline', [])).rejects.toThrow(
      /Couldn't reach Scryfall\. Check your connection/
    );
  });

  it('explains an unparseable query instead of printing "400 Bad Request"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' })
    );

    await expect(searchCards('t:zzzzbadsyntax', [])).rejects.toThrow(/couldn't read that search/);
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

describe('getCardByNameResilient', () => {
  beforeEach(() => {
    gate.offline = false;
    offlineLib.getCardByName.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offline hit: returns the offline card with no network call', async () => {
    gate.offline = true;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    offlineLib.getCardByName.mockResolvedValue(
      makeCard({ name: 'Resilient Offline Hit', layout: 'normal' })
    );

    const result = await getCardByNameResilient('Resilient Offline Hit');

    expect(result?.name).toBe('Resilient Offline Hit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offline miss → falls back to a live fetch when online', async () => {
    gate.offline = true;
    offlineLib.getCardByName.mockResolvedValue(undefined); // name not in the offline store
    const live = makeCard({ name: 'Resilient Live Fallback', layout: 'normal' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => live }));

    const result = await getCardByNameResilient('Resilient Live Fallback');

    expect(result?.name).toBe('Resilient Live Fallback');
  });

  it('offline stall → times out and falls back to live (no infinite hang)', async () => {
    gate.offline = true;
    // Offline read never settles — simulates the IDB write-lock stall while the
    // bulk cache ingests. Must NOT hang; the cap should kick it to live.
    offlineLib.getCardByName.mockReturnValue(pending(undefined));
    const live = makeCard({ name: 'Resilient Stall Fallback', layout: 'normal' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => live }));

    // Tiny timeout so the test is fast.
    const result = await getCardByNameResilient('Resilient Stall Fallback', 20);

    expect(result?.name).toBe('Resilient Stall Fallback');
  });

  it('returns null (never throws) when both offline and live miss', async () => {
    gate.offline = true;
    offlineLib.getCardByName.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    );

    await expect(getCardByNameResilient('Resilient Total Miss')).resolves.toBeNull();
  });

  it('live-primary (offline inactive): a miss is terminal — no pointless second attempt', async () => {
    gate.offline = false;
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardByNameResilient('Resilient Live Miss');

    expect(result).toBeNull();
    // Two calls: the bulk probe at our own backend, then exactly ONE live
    // Scryfall attempt. The point of the test is the latter — a live miss is
    // terminal, with no pointless retry against the same endpoint.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.startsWith('/api/cards/named'))).toHaveLength(1);
    expect(urls.filter((u) => !u.startsWith('/api/'))).toHaveLength(1);
  });
});

describe('getCardByName foil-only-default fallback', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-resolves to the cheapest nonfoil printing when /cards/named is foil-only', async () => {
    // Unique name to dodge the module-level cardCache leaking across tests.
    const name = 'Foilonly Test Elf';
    // Default printing (e.g. a Secret Lair): no nonfoil USD, only a $89 foil.
    const foilDefault = makeCard({
      id: 'sld-foil',
      name,
      layout: 'normal',
      prices: { usd: null, usd_foil: '89.28' },
    });
    // Cheapest nonfoil printing returned by the price-ordered prints search.
    const cheapest = makeCard({
      id: 'cheap-nonfoil',
      name,
      layout: 'normal',
      prices: { usd: '1.28' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/cards/named')) return { ok: true, json: async () => foilDefault };
        if (url.includes('/cards/search'))
          return { ok: true, json: async () => ({ data: [cheapest], has_more: false }) };
        return { ok: false, status: 404, statusText: 'Not Found' };
      })
    );

    const result = await getCardByName(name);

    expect(result.id).toBe('cheap-nonfoil');
    expect(result.prices.usd).toBe('1.28');
  });

  it('keeps the default printing when no nonfoil printing exists anywhere', async () => {
    const name = 'Truly Foil Exclusive';
    const foilOnly = makeCard({
      id: 'foil-exclusive',
      name,
      layout: 'normal',
      prices: { usd: null, usd_foil: '12.00' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/cards/named')) return { ok: true, json: async () => foilOnly };
        // Prints search finds no nonfoil-priced printing.
        if (url.includes('/cards/search'))
          return { ok: true, json: async () => ({ data: [foilOnly], has_more: false }) };
        return { ok: false, status: 404, statusText: 'Not Found' };
      })
    );

    const result = await getCardByName(name);

    expect(result.id).toBe('foil-exclusive');
  });
});

// `/cards/named` was the last high-frequency Scryfall call the browser made on
// every card add, and a client 429 is invisible to us (Scryfall omits CORS
// headers on 429s). Our backend already holds every printing from the nightly
// bulk dump, so a hit means the browser never touches Scryfall at all.
describe('getCardByName bulk-first resolve', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves an exact name from our backend without touching Scryfall', async () => {
    const name = 'Bulkfirst Test Rector';
    const bulk = makeCard({ id: 'bulk-hit', name, layout: 'normal', prices: { usd: '18.99' } });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/cards/named'))
        return { ok: true, json: async () => ({ card: bulk }) };
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardByName(name);

    expect(result.id).toBe('bulk-hit');
    // The backend already resolved the cheapest nonfoil, so the foil-only
    // follow-up search must not fire either.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.startsWith('/api/'))).toBe(true);
  });

  it('falls through to the live path when the bulk dump has no such card', async () => {
    const name = 'Bulkfirst Brandnew Spoiler';
    const live = makeCard({ id: 'live-hit', name, layout: 'normal', prices: { usd: '3.00' } });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      // A miss is `{ card: null }`, NOT an error — the backend never goes live.
      if (url.startsWith('/api/cards/named'))
        return { ok: true, json: async () => ({ card: null }) };
      if (url.includes('/cards/named')) return { ok: true, json: async () => live };
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    expect((await getCardByName(name)).id).toBe('live-hit');

    // Never `?fuzzy=`. Scryfall's fuzzy matcher fails OPEN, not closed — it
    // answers `sol rng` with Oathsworn Giant rather than an error — and every
    // caller here feeds an already-canonical name, so a silent wrong card is
    // strictly worse than a miss.
    const liveUrl = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => !u.startsWith('/api/'));
    expect(liveUrl).toContain('exact=');
    expect(liveUrl).not.toContain('fuzzy');
  });

  it('falls through to the live path when our backend is unreachable', async () => {
    const name = 'Bulkfirst Backend Down';
    const live = makeCard({ id: 'live-hit-2', name, layout: 'normal', prices: { usd: '3.00' } });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/cards/named')) throw new TypeError('Failed to fetch');
      if (url.includes('/cards/named')) return { ok: true, json: async () => live };
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    expect((await getCardByName(name)).id).toBe('live-hit-2');
  });
});

describe('scryfallFetch 429 handling (F26)', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up after a capped number of retries on a sustained 429 instead of recursing forever', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('rate limited', { status: 429 }));

    // Unique id so a prior test's cache can't short-circuit the network call.
    const pending = getCardById('f26-sustained-429');
    const assertion = expect(pending).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await assertion;

    // 1 initial attempt + MAX_RETRIES (4) retries = 5 calls, then it stops.
    expect(fetchSpy.mock.calls.length).toBe(5);
  });

  // Observed in the wild: a well-formed search 503'd once and the raw status
  // hit the user, while the identical query succeeded on replay.
  it('retries a transient 503 and succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify(makeCard({ id: 'recovered-503', layout: 'normal' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const pending = getCardById('transient-503');
    await vi.runAllTimersAsync();
    expect((await pending).id).toBe('recovered-503');
    expect(calls).toBe(2);
  });

  // The batched /cards/collection loops used to hand-roll their own 429 branch
  // (sleep 1500ms, retry the SAME batch, no cap, Retry-After ignored). Against
  // Scryfall's 60s throttle that fired ~40 more requests per cooldown and never
  // terminated — cube generation, which enriches a whole collection, hung.
  it('caps retries on a sustained 429 batch instead of retrying it forever', async () => {
    vi.useFakeTimers();
    let collectionCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/cards/collection')) collectionCalls += 1;
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    });

    const pending = getCardsByNames(['Sustained Throttle Card']);
    await vi.runAllTimersAsync();
    expect((await pending).size).toBe(0);

    // 1 attempt + MAX_RETRIES (4), then it gives up on the batch.
    expect(collectionCalls).toBe(5);
  });

  // The per-card follow-up passes (price sharpening + not-found rescue) cost one
  // request each. On a collection-sized resolve that tail is what got us 429'd.
  it('bounds the per-card follow-up pass on a collection-sized resolve', async () => {
    vi.useFakeTimers();
    const names = Array.from({ length: 250 }, (_, i) => `Followup Budget Card ${i}`);
    let searchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/cards/collection')) {
          const body = JSON.parse(String(init?.body)) as { identifiers: Array<{ name: string }> };
          // Everything resolves, but with no usd price — so every single card is
          // a candidate for the price re-fetch pass.
          return new Response(
            JSON.stringify({
              data: body.identifiers.map(({ name }) =>
                makeCard({ id: name, name, layout: 'normal' })
              ),
              not_found: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/cards/search')) searchCalls += 1;
        return new Response('not found', { status: 404 });
      }
    );

    const pending = getCardsByNames(names);
    await vi.runAllTimersAsync();
    expect((await pending).size).toBe(250);

    // Bounded — unbounded, this was one request per unpriced name (250 here,
    // thousands for a real collection).
    expect(searchCalls).toBe(100);
  });

  // Deck analysis resolves ~100 EDHREC recommendations for prices it can live
  // without sharpening; the tail alone (100 searches at 10/s) earned the 429
  // that stalled the whole analysis. Opting out must fire ZERO searches.
  it('skips the price-sharpening tail when priceTail is false', async () => {
    vi.useFakeTimers();
    const names = Array.from({ length: 120 }, (_, i) => `No Tail Card ${i}`);
    let searchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/cards/collection')) {
          const body = JSON.parse(String(init?.body)) as { identifiers: Array<{ name: string }> };
          return new Response(
            JSON.stringify({
              data: body.identifiers.map(({ name }) =>
                makeCard({ id: name, name, layout: 'normal' })
              ),
              not_found: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/cards/search')) searchCalls += 1;
        return new Response('not found', { status: 404 });
      }
    );

    const pending = getCardsByNames(names, undefined, undefined, { priceTail: false });
    await vi.runAllTimersAsync();
    expect((await pending).size).toBe(120);
    expect(searchCalls).toBe(0);
  });

  it('retries a transient 429 and succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return new Response('rate limited', { status: 429 });
      return new Response(JSON.stringify(makeCard({ id: 'f26-recovered', layout: 'normal' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const pending = getCardById('f26-transient-429');
    await vi.runAllTimersAsync();
    const card = await pending;
    expect(card.id).toBe('f26-recovered');
    expect(calls).toBe(2);
  });
});

describe('429 storm amplification', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // A throttled batch is "no answer", not "these names don't exist". Retrying
  // its names one by one turned one blocked batch of 75 into 75 single-card
  // `unique=prints` searches fired into the active cooldown.
  it('does not retry the names of a throttled batch one by one', async () => {
    vi.useFakeTimers();
    let searchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/cards/search')) searchCalls += 1;
      return new Response('rate limited', { status: 429, headers: { 'Retry-After': '60' } });
    });

    const pending = getCardsByNames(['Storm Batch A', 'Storm Batch B', 'Storm Batch C']);
    await vi.runAllTimersAsync();
    expect((await pending).size).toBe(0);
    expect(searchCalls).toBe(0);
  });

  it('shares one request between concurrent lookups of the same name', async () => {
    const name = 'Storm Dedupe Forest';
    const live = makeCard({ id: 'dedupe-hit', name, layout: 'normal', prices: { usd: '0.10' } });
    let namedCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/cards/named'))
        return { ok: true, json: async () => ({ card: null }) };
      if (url.includes('/cards/named')) {
        namedCalls += 1;
        return { ok: true, json: async () => live };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([
      getCardByName(name),
      getCardByName(name),
      getCardByName(name),
    ]);

    expect(namedCalls).toBe(1);
    expect([a.id, b.id, c.id]).toEqual(['dedupe-hit', 'dedupe-hit', 'dedupe-hit']);
    // Each caller still gets its own copy — deck-generation flags must not leak
    // between two callers that happened to share the request.
    expect(a).not.toBe(b);
  });
});

// An invalid scryfallQuery (bad search syntax) must fail generation loudly,
// not get silently treated like "no matching printings" — that used to strip
// every card from the map in strict mode and ship a nearly-all-basic-lands
// deck with no explanation (LIVE-CONFIRMED).
describe('upgradeCardPrintings', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws with Scryfall's own message on a 400 (invalid search syntax)", async () => {
    const cards = new Map([['Sol Ring', makeCard({ name: 'Sol Ring' })]]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          object: 'error',
          status: 400,
          details: "Invalid syntax near 'garbage(('.",
        }),
      })
    );

    await expect(upgradeCardPrintings(cards, 'garbage((', true)).rejects.toThrow(
      /Your Scryfall filter isn't valid: Invalid syntax near/
    );
  });

  it('still treats a 404 as "no matching printings" (strict mode drops the card, no throw)', async () => {
    const cards = new Map([['Sol Ring', makeCard({ name: 'Sol Ring' })]]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    );

    await expect(upgradeCardPrintings(cards, 'is:full-art', true)).resolves.toBeUndefined();
    expect(cards.has('Sol Ring')).toBe(false);
  });
});

// Primary, unbatched check — meant to run at the very start of generation
// before any pool work. LIVE-CONFIRMED the batched upgradeCardPrintings check
// above didn't reliably surface a 400 in a live rerun (queued behind a 429
// retry), so this runs independent of any card names or batching.
describe('validateScryfallFilter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws with Scryfall's own message on a 400 (invalid search syntax)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ object: 'error', status: 400, details: "Invalid syntax near '(('." }),
      })
    );

    await expect(validateScryfallFilter('garbage((')).rejects.toThrow(
      /Your Scryfall filter isn't valid: Invalid syntax near/
    );
  });

  it('throws an actionable error on a 404 (the filter matches nothing this deck can use)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    );

    await expect(validateScryfallFilter('t:nonexistenttype', ['R'])).rejects.toThrow(
      /matches no cards this deck can use/
    );
  });

  it('throws when the identity-scoped pool is too small to build from (a VALID but over-narrow query)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: 'list', total_cards: 7, has_more: false, data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // `garbage((` is a legitimate Scryfall name search (LIVE: 7 cards), not a
    // syntax error, so only the pool-size ceiling can catch it.
    await expect(validateScryfallFilter('garbage((', ['R'])).rejects.toThrow(
      /matches only 7 cards this deck can use/
    );
    const url = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain('garbage(( f:commander id<=R');
  });

  it('resolves when the scoped pool is large enough', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ object: 'list', total_cards: 512, has_more: true, data: [] }),
      })
    );

    await expect(
      validateScryfallFilter('year<=2012', ['W', 'U', 'B', 'G'])
    ).resolves.toBeUndefined();
  });

  it('does not throw on a network failure — a validation-only request never blocks generation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('NetworkError')));

    await expect(validateScryfallFilter('t:creature')).resolves.toBeUndefined();
  });

  it('is a no-op for an empty query (never calls fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await validateScryfallFilter('   ');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// E271: `notOnArena` used to reject Command Tower, basics, Impact Tremors,
// etc. under arenaOnly because resolution always picked the CHEAPEST paper
// printing, and that printing often isn't the one on Arena. arenaOnly now
// prefers an Arena-legal printing without disturbing the plain (cheapest
// paper) cache entry for the same name.
describe('getCardByName arenaOnly (E271)', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-resolves to an Arena printing when the cheapest paper printing is not on Arena', async () => {
    const name = 'Arena Leak Test Tower';
    const paperCheapest = makeCard({
      id: 'paper-cheapest',
      name,
      layout: 'normal',
      games: ['paper'],
      prices: { usd: '0.25' },
    });
    const arenaPrint = makeCard({
      id: 'arena-print',
      name,
      layout: 'normal',
      games: ['paper', 'arena'],
      prices: { usd: '2.00' },
    });
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/cards/named'))
        return { ok: true, json: async () => ({ card: null }) };
      if (url.includes('/cards/search')) {
        if (url.includes('game%3Aarena')) {
          return { ok: true, json: async () => ({ data: [arenaPrint], has_more: false }) };
        }
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      if (url.includes('/cards/named')) return { ok: true, json: async () => paperCheapest };
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardByName(name, true);

    expect(result.id).toBe('arena-print');
    expect(result.games).toContain('arena');
    const searchUrl = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('/cards/search'));
    expect(searchUrl).toContain('game%3Aarena');
  });

  it('falls back to the plain cheapest-printing query when no Arena printing exists', async () => {
    const name = 'Arena Leak Test Paperonly';
    const paperCheapest = makeCard({
      id: 'paper-cheapest-2',
      name,
      layout: 'normal',
      games: ['paper'],
      prices: { usd: '0.25' },
    });
    const fallbackCheapest = makeCard({
      id: 'fallback-cheapest',
      name,
      layout: 'normal',
      games: ['paper', 'mtgo'],
      prices: { usd: '0.10' },
    });
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/cards/named'))
        return { ok: true, json: async () => ({ card: null }) };
      if (url.includes('/cards/search')) {
        // The arena-scoped query 404s (no Arena printing exists at all) —
        // must fall back to the plain query rather than giving up.
        if (url.includes('game%3Aarena')) {
          return { ok: false, status: 404, statusText: 'Not Found' };
        }
        return { ok: true, json: async () => ({ data: [fallbackCheapest], has_more: false }) };
      }
      if (url.includes('/cards/named')) return { ok: true, json: async () => paperCheapest };
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardByName(name, true);

    expect(result.id).toBe('fallback-cheapest');
  });

  it('never overwrites the plain (non-arena) cache entry with the Arena-preferred printing', async () => {
    const name = 'Arena Leak Test Cache Isolation';
    const paperCheapest = makeCard({
      id: 'paper-cheapest-3',
      name,
      layout: 'normal',
      games: ['paper'],
      prices: { usd: '0.25' },
    });
    const arenaPrint = makeCard({
      id: 'arena-print-3',
      name,
      layout: 'normal',
      games: ['paper', 'arena'],
      prices: { usd: '2.00' },
    });
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/cards/named'))
        return { ok: true, json: async () => ({ card: null }) };
      if (url.includes('/cards/search')) {
        return { ok: true, json: async () => ({ data: [arenaPrint], has_more: false }) };
      }
      if (url.includes('/cards/named')) return { ok: true, json: async () => paperCheapest };
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const arenaResult = await getCardByName(name, true);
    expect(arenaResult.id).toBe('arena-print-3');

    const callsAfterFirst = fetchMock.mock.calls.length;

    // A plain (non-arena) lookup for the SAME name must still return the
    // cheapest paper printing from cache — not the Arena-preferred one — and
    // must not need another network round-trip (the plain resolve was cached
    // during the first call above).
    const plainResult = await getCardByName(name, false);
    expect(plainResult.id).toBe('paper-cheapest-3');
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    // And a second Arena-preferred lookup must be served from the `|arena`
    // cache entry rather than re-issuing the search.
    const arenaResultAgain = await getCardByName(name, true);
    expect(arenaResultAgain.id).toBe('arena-print-3');
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

// The batched resolves ask our own bulk-backed `/api/cards/lookup` before
// Scryfall. A hit there is the card's cheapest paper printing already, so it
// must also stay out of the per-name price-sharpening tail — that tail is the
// per-name `/cards/search` E333 counted 23 of, all 429s, after one cube build.
describe('getCardsByNames / getCardsByIds bulk-first resolve', () => {
  const resolved = makeCard({
    id: 'bulk-batch-hit',
    name: 'Bulk Batch Hit',
    layout: 'normal',
    prices: { usd: null },
  });

  function stubFetch(lookup: (body: { names?: string[]; ids?: string[] }) => unknown) {
    const seen = { lookups: 0, collections: 0, searches: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/cards/lookup')) {
          seen.lookups += 1;
          const answer = lookup(JSON.parse(String(init?.body)));
          if (answer instanceof Error) throw answer;
          return { ok: true, json: async () => answer };
        }
        if (url.includes('/cards/collection')) {
          seen.collections += 1;
          const body = JSON.parse(String(init?.body)) as {
            identifiers: Array<{ name?: string; id?: string }>;
          };
          return {
            ok: true,
            json: async () => ({
              data: body.identifiers.map(({ name, id }) =>
                makeCard({
                  id: id ?? `live-${name}`,
                  name: name ?? 'Live By Id',
                  layout: 'normal',
                  prices: { usd: '1.00' },
                })
              ),
              not_found: [],
            }),
          };
        }
        if (url.includes('/cards/search')) seen.searches += 1;
        return { ok: false, status: 404, statusText: 'Not Found' };
      })
    );
    return seen;
  }

  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers from the bulk lookup, keyed as requested, with no Scryfall traffic at all', async () => {
    const seen = stubFetch(({ names }) => ({ byName: { [names![0]]: resolved }, byId: {} }));

    const progress: Array<[number, number]> = [];
    const result = await getCardsByNames(['bulk batch hit'], (n, total) =>
      progress.push([n, total])
    );

    expect(result.get('bulk batch hit')?.id).toBe('bulk-batch-hit');
    expect(result.get('Bulk Batch Hit')?.id).toBe('bulk-batch-hit');
    expect(seen).toEqual({ lookups: 1, collections: 0, searches: 0 });
    // The caller's progress bar still reaches its total with Scryfall never asked.
    expect(progress.at(-1)).toEqual([1, 1]);
  });

  it('sends only the names the bulk lookup lacked to Scryfall', async () => {
    const seen = stubFetch(() => ({ byName: { 'Bulk Batch Hit': resolved }, byId: {} }));

    const result = await getCardsByNames(['Bulk Batch Hit', 'Bulk Batch Miss']);

    expect(result.get('Bulk Batch Hit')?.id).toBe('bulk-batch-hit');
    expect(result.get('Bulk Batch Miss')?.id).toBe('live-Bulk Batch Miss');
    expect(seen.collections).toBe(1);
    expect(seen.searches).toBe(0);
  });

  it('falls through to the live batch when the lookup fails', async () => {
    const seen = stubFetch(() => new Error('backend down'));

    const result = await getCardsByNames(['Bulk Batch Fallthrough']);

    expect(result.get('Bulk Batch Fallthrough')?.id).toBe('live-Bulk Batch Fallthrough');
    expect(seen.collections).toBe(1);
  });

  it('resolves ids from the bulk lookup before the collection endpoint', async () => {
    const byIdCard = makeCard({ id: 'bulk-id-hit', name: 'Bulk Id Hit', layout: 'normal' });
    const seen = stubFetch(({ ids }) =>
      ids?.includes('bulk-id-hit') ? { byName: {}, byId: { 'bulk-id-hit': byIdCard } } : {}
    );

    const result = await getCardsByIds(['bulk-id-hit', 'live-id-miss']);

    expect(result.get('bulk-id-hit')?.name).toBe('Bulk Id Hit');
    expect(result.get('live-id-miss')?.name).toBe('Live By Id');
    expect(seen).toEqual({ lookups: 1, collections: 1, searches: 0 });
  });
});

describe('getCardsByNames arenaOnly batch post-process (E271)', () => {
  beforeEach(() => {
    gate.offline = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-resolves a batch-returned non-Arena printing through the Arena-preferred search', async () => {
    const name = 'Arena Leak Test Batch Card';
    const batchPrinting = makeCard({
      id: 'batch-non-arena',
      name,
      layout: 'normal',
      games: ['paper'],
      prices: { usd: '0.25' },
    });
    const arenaPrint = makeCard({
      id: 'batch-arena-print',
      name,
      layout: 'normal',
      games: ['paper', 'arena'],
      prices: { usd: '2.00' },
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/cards/collection')) {
          const body = JSON.parse(String(init?.body)) as { identifiers: Array<{ name: string }> };
          return {
            ok: true,
            json: async () => ({
              data: body.identifiers.map(() => batchPrinting),
              not_found: [],
            }),
          };
        }
        if (url.includes('/cards/search') && url.includes('game%3Aarena')) {
          return { ok: true, json: async () => ({ data: [arenaPrint], has_more: false }) };
        }
        return { ok: false, status: 404, statusText: 'Not Found' };
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardsByNames([name], undefined, undefined, { arenaOnly: true });

    expect(result.get(name)?.id).toBe('batch-arena-print');
    expect(result.get(name)?.games).toContain('arena');
  });

  it('re-resolves many non-Arena names in ONE chunked search and keeps the batch printing for a card with no Arena printing', async () => {
    const onArena = 'Chunk Arena Card';
    const paperOnly = 'Chunk Paper Only Card';
    const batchPrinting = (name: string) =>
      makeCard({
        id: `batch-${name}`,
        name,
        layout: 'normal',
        games: ['paper'],
        prices: { usd: '0.25' },
      });
    const arenaPrint = makeCard({
      id: 'chunk-arena-print',
      name: onArena,
      layout: 'normal',
      games: ['paper', 'arena'],
      prices: { usd: '1.00' },
    });
    const searches: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/cards/collection')) {
          const body = JSON.parse(String(init?.body)) as { identifiers: Array<{ name: string }> };
          return {
            ok: true,
            json: async () => ({
              data: body.identifiers.map((id) => batchPrinting(id.name)),
              not_found: [],
            }),
          };
        }
        if (url.includes('/cards/search') && url.includes('game%3Aarena')) {
          searches.push(decodeURIComponent(url));
          return { ok: true, json: async () => ({ data: [arenaPrint], has_more: false }) };
        }
        return { ok: false, status: 404, statusText: 'Not Found' };
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardsByNames([onArena, paperOnly], undefined, undefined, {
      arenaOnly: true,
    });

    expect(searches).toHaveLength(1);
    expect(searches[0]).toContain(`!"${onArena}" or !"${paperOnly}"`);
    expect(result.get(onArena)?.id).toBe('chunk-arena-print');
    expect(result.get(paperOnly)?.id).toBe(`batch-${paperOnly}`);

    // Both answers are remembered: a second arenaOnly ask is a pure cache hit.
    const again = await getCardsByNames([onArena, paperOnly], undefined, undefined, {
      arenaOnly: true,
    });
    expect(searches).toHaveLength(1);
    expect(again.get(onArena)?.id).toBe('chunk-arena-print');
    expect(again.get(paperOnly)?.id).toBe(`batch-${paperOnly}`);
  });
});
