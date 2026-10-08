// @vitest-environment happy-dom
/**
 * TradeComposer on a fresh device: until the first sync pull lands the local
 * store is empty although the account is not, so the give side must show a
 * loading state, never "Your collection is empty". And the "add a card" hint
 * is not shown the instant the composer opens.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
});
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('@/lib/cards/card-tags', () => ({ getCardTags: () => [], useCardTagsReady: () => false }));

const firstPull = vi.hoisted(() => ({ awaiting: false }));
vi.mock('@/lib/sync/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => firstPull.awaiting,
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

import { TradeComposer } from './TradeComposer';

function owned(copyId: string, name: string, oracleId: string): EnrichedCard {
  return {
    copyId,
    name,
    oracleId,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `scry-${copyId}`,
    purchasePrice: 1,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
  } as EnrichedCard;
}

function renderComposer() {
  return render(
    <TradeComposer
      friendId="friend-1"
      friendName="Pal"
      friendCards={[]}
      friendCardsLoading={false}
      friendWants={null}
      onClose={() => {}}
      onSent={() => {}}
    />
  );
}

beforeEach(() => {
  firstPull.awaiting = false;
  storeState = { cards: [] };
});

describe('TradeComposer: first pull', () => {
  it('shows a loading state, never the empty-collection copy, mid-first-pull', () => {
    firstPull.awaiting = true;
    renderComposer();

    expect(screen.getByRole('status', { name: 'Getting your cards…' })).toBeTruthy();
    expect(screen.queryByText(/your collection is empty/i)).toBeNull();
  });

  it('still says the collection is empty once the pull has settled', () => {
    renderComposer();
    expect(screen.getByText(/your collection is empty/i)).toBeTruthy();
  });

  it('lists the cards, not a skeleton, when they are already local', () => {
    firstPull.awaiting = true;
    storeState = { cards: [owned('a', 'Sol Ring', 'o-sol')] };
    renderComposer();

    const results = screen.getByRole('list', { name: /You give: pick a card/i });
    expect(within(results).getByRole('button', { name: 'Add Sol Ring' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Getting your cards…' })).toBeNull();
  });
});

describe('TradeComposer: the add-a-card hint', () => {
  beforeEach(() => {
    storeState = { cards: [owned('a', 'Sol Ring', 'o-sol')] };
  });

  it('is not shown the moment the composer opens', () => {
    renderComposer();
    expect(screen.queryByText('Add at least one card to send.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send offer' }).hasAttribute('disabled')).toBe(true);
  });

  it('appears once a basket was started and emptied', () => {
    renderComposer();
    const results = screen.getByRole('list', { name: /You give: pick a card/i });
    fireEvent.click(within(results).getByRole('button', { name: 'Add Sol Ring' }));
    expect(screen.queryByText('Add at least one card to send.')).toBeNull();

    const basket = screen.getByRole('list', { name: /You give: chosen cards/i });
    fireEvent.click(within(basket).getByRole('button', { name: /Remove Sol Ring/i }));
    expect(screen.getByText('Add at least one card to send.')).toBeTruthy();
  });
});
