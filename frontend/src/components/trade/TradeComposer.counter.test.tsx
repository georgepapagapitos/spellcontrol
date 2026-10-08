// @vitest-environment happy-dom
/**
 * TradeComposer as a counter: the whole incoming offer arrives on its own
 * sides, and the original is declined only AFTER the new offer is sent.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '../../types';
import type { TradeCard } from '@/lib/trade/trades-client';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
});
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('@/lib/cards/card-tags', () => ({ getCardTags: () => [], useCardTagsReady: () => false }));
vi.mock('@/lib/sync/use-awaiting-first-pull', () => ({ useAwaitingFirstPull: () => false }));

const toastShow = vi.fn();
vi.mock('../../store/toasts', () => ({
  toast: { show: (input: unknown) => toastShow(input) },
}));

let storeState: { cards: EnrichedCard[] } = { cards: [] };
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel(storeState),
}));
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));
vi.mock('../../store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));

const calls: string[] = [];
const proposeTrade = vi.fn();
const declineTrade = vi.fn();
const counterTrade = vi.fn();
vi.mock('@/lib/trade/trades-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade/trades-client')>(
    '@/lib/trade/trades-client'
  );
  return {
    ...actual,
    proposeTrade: (input: unknown) => proposeTrade(input),
    declineTrade: (id: string) => declineTrade(id),
    counterTrade: (id: string, input: unknown) => counterTrade(id, input),
  };
});

import { TradeComposer } from './TradeComposer';

function owned(copyId: string, name: string, oracleId: string, price = 1): EnrichedCard {
  return {
    copyId,
    name,
    oracleId,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `scry-${copyId}`,
    purchasePrice: price,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
  } as EnrichedCard;
}

const ASKED: TradeCard[] = [
  { oracleId: 'o-sol', name: 'Sol Ring', quantity: 2, copies: [] },
  { oracleId: 'o-sig', name: 'Arcane Signet', quantity: 1, copies: [] },
];
const OFFERED = [
  { oracleId: 'o-bolt', name: 'Lightning Bolt', quantity: 1 },
  { oracleId: 'o-rhys', name: 'Rhystic Study', quantity: 3 },
];

function renderCounter() {
  const onSent = vi.fn();
  render(
    <TradeComposer
      friendId="friend-1"
      friendName="Pal"
      friendCards={[]}
      friendCardsLoading={false}
      friendWants={null}
      initialGive={ASKED}
      initialGet={OFFERED}
      counterTo={{ offerId: 't1', name: 'Pal' }}
      onClose={() => {}}
      onSent={onSent}
    />
  );
  return onSent;
}

beforeEach(() => {
  calls.length = 0;
  toastShow.mockClear();
  proposeTrade.mockReset();
  declineTrade.mockReset();
  counterTrade.mockReset();
  counterTrade.mockImplementation(async () => {
    calls.push('counter');
    return { id: 'new' };
  });
  storeState = {
    cards: [
      owned('a', 'Sol Ring', 'o-sol', 5),
      owned('b', 'Sol Ring', 'o-sol', 1),
      owned('c', 'Arcane Signet', 'o-sig'),
    ],
  };
});

describe('TradeComposer: countering', () => {
  it('fills both sides from the whole offer, quantities included', () => {
    renderCounter();
    const give = screen.getByRole('list', { name: /You give: chosen cards/i });
    expect(within(give).getByText('Sol Ring')).toBeTruthy();
    expect(within(give).getByText('Arcane Signet')).toBeTruthy();
    const get = screen.getByRole('list', { name: /You get: chosen cards/i });
    expect(within(get).getByText('Lightning Bolt')).toBeTruthy();
    expect(within(get).getByText('Rhystic Study')).toBeTruthy();
    expect(
      screen.getByText(/Countering Pal.s offer\. Sending this declines theirs\./)
    ).toBeTruthy();
  });

  it('counters in one call, with no separate propose or decline', async () => {
    const onSent = renderCounter();
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());

    expect(calls).toEqual(['counter']);
    expect(counterTrade.mock.calls[0][0]).toBe('t1');
    expect(proposeTrade).not.toHaveBeenCalled();
    expect(declineTrade).not.toHaveBeenCalled();
    const sent = counterTrade.mock.calls[0][1] as { give: TradeCard[]; receive: TradeCard[] };
    expect(sent.give.map((c) => [c.name, c.quantity])).toEqual([
      ['Sol Ring', 2],
      ['Arcane Signet', 1],
    ]);
    expect(sent.receive.map((c) => [c.name, c.quantity])).toEqual([
      ['Lightning Bolt', 1],
      ['Rhystic Study', 3],
    ]);
  });

  it('keeps the composer open when the counter fails', async () => {
    counterTrade.mockRejectedValue(new Error('nope'));
    const onSent = renderCounter();
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(toastShow).toHaveBeenCalled());

    expect(declineTrade).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it('skips a card no longer owned and says so in the note line', () => {
    storeState = { cards: [owned('a', 'Sol Ring', 'o-sol')] };
    renderCounter();
    const give = screen.getByRole('list', { name: /You give: chosen cards/i });
    expect(within(give).queryByText('Arcane Signet')).toBeNull();
    // Sol Ring was asked x2 but only one is owned, so it is named too.
    expect(screen.getByText(/no longer own enough: Sol Ring, Arcane Signet\./)).toBeTruthy();
  });
});
