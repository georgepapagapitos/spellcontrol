// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_TTL_MS, pruneDrafts, useTradeDraftsStore } from './trade-drafts';
import { MAX_TRADE_LINES_PER_SIDE } from '@/lib/trade/trades-client';
import { MAX_COPIES_PER_LINE, atLineCap, bump } from '@/lib/trade/trade-basket';
import { emptyDraft, type TradeDraft } from '@/lib/trade/trade-draft';

const KEY = 'sc-trade-drafts:v1';
const withCard = (friendId: string, updatedAt = Date.now()): TradeDraft => ({
  ...emptyDraft(friendId, 'Ann', updatedAt),
  get: { 'o-a': { name: 'A', oracleId: 'o-a', quantity: 1 } },
});

beforeEach(() => {
  localStorage.clear();
  useTradeDraftsStore.setState({ drafts: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('trade drafts store', () => {
  it('scopes drafts per viewer so accounts never see each other', () => {
    const s = useTradeDraftsStore.getState();
    s.setDraft('u1', 'f1', withCard('f1'));
    expect(useTradeDraftsStore.getState().getDraft('u1', 'f1')).not.toBeNull();
    expect(useTradeDraftsStore.getState().getDraft('u2', 'f1')).toBeNull();
    s.setDraft('u2', 'f1', { ...withCard('f1'), note: 'mine' });
    s.clearDraft('u1', 'f1');
    expect(useTradeDraftsStore.getState().getDraft('u1', 'f1')).toBeNull();
    expect(useTradeDraftsStore.getState().getDraft('u2', 'f1')?.note).toBe('mine');
  });

  it('stamps updatedAt on save and clears instead of saving an empty draft', () => {
    const s = useTradeDraftsStore.getState();
    s.setDraft('u1', 'f1', withCard('f1', 5));
    expect(useTradeDraftsStore.getState().getDraft('u1', 'f1')!.updatedAt).toBeGreaterThan(5);
    s.setDraft('u1', 'f1', emptyDraft('f1', 'Ann'));
    expect(useTradeDraftsStore.getState().getDraft('u1', 'f1')).toBeNull();
    expect(useTradeDraftsStore.getState().drafts).toEqual({});
  });

  it('keeps a viewer bucket while other friends remain, and ignores clearing something absent', () => {
    const s = useTradeDraftsStore.getState();
    s.setDraft('u1', 'f1', withCard('f1'));
    s.setDraft('u1', 'f2', withCard('f2'));
    s.clearDraft('u1', 'f1');
    expect(Object.keys(useTradeDraftsStore.getState().drafts.u1)).toEqual(['f2']);
    const before = useTradeDraftsStore.getState().drafts;
    useTradeDraftsStore.getState().clearDraft('u1', 'nope');
    expect(useTradeDraftsStore.getState().drafts).toBe(before);
  });

  it('persists under the versioned key', () => {
    useTradeDraftsStore.getState().setDraft('u1', 'f1', withCard('f1'));
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    expect(raw.state.drafts.u1.f1.get['o-a'].quantity).toBe(1);
  });

  it('drops drafts older than 30 days on hydrate and keeps fresh ones', async () => {
    const now = Date.now();
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          drafts: {
            u1: {
              old: withCard('old', now - DRAFT_TTL_MS - 1000),
              fresh: withCard('fresh', now - 1000),
              junk: { v: 2 },
            },
            u2: 'nonsense',
          },
        },
        version: 0,
      })
    );
    await useTradeDraftsStore.persist.rehydrate();
    const drafts = useTradeDraftsStore.getState().drafts;
    expect(Object.keys(drafts.u1)).toEqual(['fresh']);
    expect(drafts.u2).toBeUndefined();
  });

  it('renders empty when storage is empty, corrupt, or throws', async () => {
    await useTradeDraftsStore.persist.rehydrate();
    expect(useTradeDraftsStore.getState().drafts).toEqual({});
    localStorage.setItem(KEY, '{not json');
    await useTradeDraftsStore.persist.rehydrate();
    expect(useTradeDraftsStore.getState().drafts).toEqual({});

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await useTradeDraftsStore.persist.rehydrate();
    expect(useTradeDraftsStore.getState().drafts).toEqual({});
    expect(() => useTradeDraftsStore.getState().setDraft('u1', 'f1', withCard('f1'))).not.toThrow();
    // The in-memory draft is still correct even though the save failed.
    expect(useTradeDraftsStore.getState().getDraft('u1', 'f1')).not.toBeNull();
  });
});

describe('pruneDrafts', () => {
  it('returns {} for non-objects', () => {
    expect(pruneDrafts(null)).toEqual({});
    expect(pruneDrafts('x')).toEqual({});
  });
});

describe('basket caps', () => {
  it('holds 40 lines per side and 20 copies per line', () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_TRADE_LINES_PER_SIDE }, (_, i) => [`k${i}`, 1])
    );
    expect(MAX_TRADE_LINES_PER_SIDE).toBe(40);
    expect(atLineCap(full, 'extra')).toBe(true);
    expect(atLineCap(full, 'k1')).toBe(false);
    expect(bump({ k0: 19 }, 'k0', 5, MAX_COPIES_PER_LINE)).toEqual({ k0: 20 });
  });
});
