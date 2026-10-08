// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '@/store/collection';
import { useDecksStore, type Deck } from '@/store/decks';
import type { EnrichedCard } from '@/types';
import { isApplyingServer } from '@/lib/sync/applying-server';
import { _resetForTests as resetVersions, setImageVersions } from './card-image-versions';
import {
  _resetForTests,
  applyImageVersionsToStores,
  refreshDeckImageVersions,
} from './refresh-image-versions';

const CHIMERA = '81cea94d-e8a2-4c88-b121-9806eb7cc210';
const url = (stamp: number) => `https://cards.scryfall.io/normal/front/8/1/${CHIMERA}.jpg?${stamp}`;
const OLD = 1790000000;
const NEW = 1791120518;
const T = 1_791_200_000_000; // a real clock: a day past the swap

const deck = (): Deck =>
  ({
    id: 'd1',
    commander: null,
    partnerCommander: null,
    cards: [{ slotId: 's1', card: { id: CHIMERA, image_uris: { normal: url(OLD) } } }],
    sideboard: [],
    considering: [],
  }) as unknown as Deck;

beforeEach(() => {
  localStorage.clear();
  resetVersions();
  _resetForTests();
  useDecksStore.setState({ decks: [deck()] });
  useCollectionStore.setState({
    cards: [{ scryfallId: CHIMERA, imageNormal: url(OLD) } as unknown as EnrichedCard],
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const sync = await import('@/lib/sync');
  await sync.flushSync();
});

const deckImage = () => useDecksStore.getState().decks[0].cards[0].card.image_uris?.normal;

describe('applyImageVersionsToStores', () => {
  // A fresher URL is reference data, not an edit: the decks subscriber must see
  // it as server-applied, or every deck would re-save and re-push.
  it('applies stamps to both stores as server state', () => {
    setImageVersions({ [CHIMERA]: String(NEW) });
    const seen: boolean[] = [];
    const unsub = useDecksStore.subscribe(() => seen.push(isApplyingServer()));
    applyImageVersionsToStores();
    unsub();
    expect(deckImage()).toBe(url(NEW));
    expect(useCollectionStore.getState().cards[0].imageNormal).toBe(url(NEW));
    expect(seen).toEqual([true]);
    expect(isApplyingServer()).toBe(false);
  });

  it('does nothing when no stamp moved', () => {
    const decks = useDecksStore.getState().decks;
    applyImageVersionsToStores();
    expect(useDecksStore.getState().decks).toBe(decks);
  });
});

describe('refreshDeckImageVersions', () => {
  const stubFetch = (body: unknown, ok = true) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('asks for the deck printings and moves their images', async () => {
    const fetch = stubFetch({ imageVersions: { [CHIMERA]: String(NEW) } });
    await refreshDeckImageVersions(T);
    expect(fetch).toHaveBeenCalledOnce();
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toContain('/api/cards/image-versions');
    expect(JSON.parse(init.body as string)).toEqual({ scryfallIds: [CHIMERA] });
    expect(deckImage()).toBe(url(NEW));
  });

  it('runs at most once a day', async () => {
    const fetch = stubFetch({ imageVersions: {} });
    await refreshDeckImageVersions(T);
    await refreshDeckImageVersions(T + 60_000);
    expect(fetch).toHaveBeenCalledOnce();
    await refreshDeckImageVersions(T + 25 * 60 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries next time after a failed check, leaving images as stored', async () => {
    const failing = stubFetch({ error: 'down' }, false);
    await refreshDeckImageVersions(T);
    expect(failing).toHaveBeenCalledOnce();
    expect(deckImage()).toBe(url(OLD));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    await refreshDeckImageVersions(T + 1);
    expect(deckImage()).toBe(url(OLD));

    const fetch = stubFetch({ imageVersions: { [CHIMERA]: String(NEW) } });
    await refreshDeckImageVersions(T + 2);
    expect(fetch).toHaveBeenCalledOnce();
    expect(deckImage()).toBe(url(NEW));
  });

  it('skips the request when there are no deck cards', async () => {
    useDecksStore.setState({ decks: [] });
    const fetch = stubFetch({ imageVersions: {} });
    await refreshDeckImageVersions(T);
    expect(fetch).not.toHaveBeenCalled();
  });
});
