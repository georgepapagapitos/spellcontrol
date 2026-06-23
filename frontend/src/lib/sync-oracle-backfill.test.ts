// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// sync.ts imports these at module load — stub them so importing it doesn't blow up.
vi.mock('./platform', () => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));
// The network leaf under test.
vi.mock('./api/combos', () => ({ fetchOracleIds: vi.fn() }));

import { backfillOracleIds, getPendingCount } from './sync';
import { fetchOracleIds } from './api/combos';
import * as estore from './entity-store';
import { useCollectionStore } from '../store/collection';
import type { EnrichedCard } from '../types';

const mockFetch = fetchOracleIds as unknown as ReturnType<typeof vi.fn>;

const setCards = (cards: EnrichedCard[]) =>
  useCollectionStore.setState({ cards } as unknown as Parameters<
    typeof useCollectionStore.setState
  >[0]);

function card(partial: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: 'copy-' + (partial.scryfallId ?? 'x'),
    name: 'Card',
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'sf-1',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    ...partial,
  } as EnrichedCard;
}

beforeEach(async () => {
  localStorage.clear();
  mockFetch.mockReset();
  await estore.wipeAll();
  setCards([]);
});

afterEach(() => vi.clearAllMocks());

describe('backfillOracleIds', () => {
  it('resolves missing oracleId into the store + IDB (preserving rev), no push, marks done', async () => {
    const stale = card({ scryfallId: 'sf-1', oracleId: undefined });
    const fresh = card({ scryfallId: 'sf-2', oracleId: 'already' });
    setCards([stale, fresh]);
    // Seed the IDB row with a non-zero rev to prove it's preserved.
    await estore.putMany('card', [
      { id: stale.copyId, data: { ...stale }, rev: 7, syncedRev: 7, deletedAt: null },
      { id: fresh.copyId, data: { ...fresh }, rev: 3, syncedRev: 3, deletedAt: null },
    ]);
    mockFetch.mockResolvedValue({ 'sf-1': 'oracle-1' });

    await backfillOracleIds();

    // Store reflects the resolved id; the already-resolved card is untouched.
    const cards = useCollectionStore.getState().cards;
    expect(cards.find((c) => c.scryfallId === 'sf-1')?.oracleId).toBe('oracle-1');
    expect(cards.find((c) => c.scryfallId === 'sf-2')?.oracleId).toBe('already');

    // IDB row patched in place with rev preserved (not bumped to a local marker).
    const row = await estore.getById('card', stale.copyId);
    expect((row?.data as { oracleId?: string }).oracleId).toBe('oracle-1');
    expect(row?.rev).toBe(7);

    // Local-only: nothing was queued for push.
    expect(getPendingCount()).toBe(0);
    // One-shot marker set.
    expect(localStorage.getItem('spellcontrol:oracleIdBackfillDone')).toBe('1');
    // Only the stale card's scryfallId was requested.
    expect(mockFetch).toHaveBeenCalledWith(['sf-1']);
  });

  it('no-ops once the marker is set (does not re-hit the network)', async () => {
    setCards([card({ oracleId: undefined })]);
    localStorage.setItem('spellcontrol:oracleIdBackfillDone', '1');

    await backfillOracleIds();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('marks done without a request when every card already has an oracleId', async () => {
    setCards([card({ oracleId: 'has-it' })]);

    await backfillOracleIds();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('spellcontrol:oracleIdBackfillDone')).toBe('1');
  });

  it('leaves the marker unset on network failure so it retries next boot', async () => {
    setCards([card({ oracleId: undefined })]);
    mockFetch.mockRejectedValue(new Error('offline'));

    await backfillOracleIds();

    expect(localStorage.getItem('spellcontrol:oracleIdBackfillDone')).toBeNull();
  });

  it('does nothing while the collection is still empty (re-fires later on hasCards)', async () => {
    await backfillOracleIds();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('spellcontrol:oracleIdBackfillDone')).toBeNull();
  });
});
