// @vitest-environment happy-dom
/**
 * Asks are per printing: the review shows the printing that was tapped (its own
 * art, set and number, and its exact price), and the wire carries it.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCard } from '@/lib/social/shared-types';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return {
    ...actual,
    useFloorPrices: () => ({ prices: new Map([['Llanowar Elves', 0.25]]), pending: false }),
  };
});
vi.mock('@/lib/sync/use-awaiting-first-pull', () => ({ useAwaitingFirstPull: () => false }));
vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' }, status: 'authed' }),
}));
vi.mock('@/store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel({ cards: [] }),
}));
vi.mock('@/store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));
vi.mock('@/store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));

const api = vi.hoisted(() => ({ propose: vi.fn() }));
vi.mock('@/lib/trade/trades-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade/trades-client')>(
    '@/lib/trade/trades-client'
  );
  return { ...actual, proposeTrade: api.propose };
});

import { emptyDraft, type TradeDraft } from '@/lib/trade/trade-draft';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { TradeReview } from './TradeReview';

const SEVENTH = 'o-elves|sf-7ed|nonfoil';
const FDN = 'o-elves|sf-fdn|nonfoil';

function theirs(scryfallId: string, setCode: string, collectorNumber: string, price: number) {
  return {
    name: 'Llanowar Elves',
    oracleId: 'o-elves',
    scryfallId,
    setCode,
    collectorNumber,
    finish: 'nonfoil',
    purchasePrice: price,
    imageSmall: `https://img/${scryfallId}.jpg`,
  } as PublicCard;
}

const THEIRS = [theirs('sf-7ed', 'ed7', '253', 4), theirs('sf-fdn', 'fdn', '227', 0.5)];

const pinned = (scryfallId: string, quantity: number) => ({
  name: 'Llanowar Elves',
  oracleId: 'o-elves',
  scryfallId,
  finish: 'nonfoil',
  quantity,
});

function seed(get: TradeDraft['get']) {
  useTradeDraftsStore.getState().setDraft('me', 'f1', { ...emptyDraft('f1', 'Pal'), get });
}

const base = {
  friendId: 'f1',
  friendName: 'Pal',
  onAddMore: vi.fn(),
  onAddFromYours: vi.fn(),
  onSent: vi.fn(),
};

beforeEach(() => {
  useTradeDraftsStore.setState({ drafts: {} });
  api.propose.mockReset();
  base.onSent.mockReset();
});

describe('TradeReview: an ask names its printing', () => {
  it("shows the printing's own art, set and number, and its exact price", () => {
    seed({ [SEVENTH]: pinned('sf-7ed', 1) });
    render(<TradeReview {...base} theirCards={THEIRS} />);

    const line = screen.getByRole('list', { name: 'You get: chosen cards' });
    expect(within(line).getByText(/ED7 · #253/)).toBeTruthy();
    // Exact: their price for THAT printing, not the cheapest one's, and no "from".
    expect(within(line).getByText(/\$4\.00/)).toBeTruthy();
    expect(within(line).queryByText(/from/)).toBeNull();
    const art = line.querySelector('img');
    expect(art?.getAttribute('src')).toBe('https://img/sf-7ed.jpg');
  });

  it('keeps an any-printing ask as "from" the cheapest printing', () => {
    seed({ 'o-elves': { name: 'Llanowar Elves', oracleId: 'o-elves', quantity: 1 } });
    render(<TradeReview {...base} theirCards={THEIRS} />);

    const line = screen.getByRole('list', { name: 'You get: chosen cards' });
    expect(within(line).getByText(/from \$0\.50/)).toBeTruthy();
    expect(within(line).queryByText(/ED7/)).toBeNull();
  });

  it('caps a pinned line at their copies of THAT printing', () => {
    seed({ [FDN]: pinned('sf-fdn', 1) });
    render(<TradeReview {...base} theirCards={THEIRS} />);
    const more = screen.getByRole('button', { name: 'One more Llanowar Elves' });
    expect((more as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Pal has 1 of this/)).toBeTruthy();
  });

  it('sends two printings of one card as ONE line carrying both', async () => {
    seed({ [SEVENTH]: pinned('sf-7ed', 1), [FDN]: pinned('sf-fdn', 1) });
    api.propose.mockResolvedValue({ id: 'offer-1' });
    render(<TradeReview {...base} theirCards={THEIRS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(base.onSent).toHaveBeenCalled());
    expect(api.propose.mock.calls[0][0].receive).toEqual([
      {
        oracleId: 'o-elves',
        name: 'Llanowar Elves',
        quantity: 2,
        copies: [
          { scryfallId: 'sf-7ed', finish: 'nonfoil' },
          { scryfallId: 'sf-fdn', finish: 'nonfoil' },
        ],
      },
    ]);
  });

  it('sends an oracle-level line when any entry is an old any-printing ask', async () => {
    seed({
      [SEVENTH]: pinned('sf-7ed', 1),
      'o-elves': { name: 'Llanowar Elves', oracleId: 'o-elves', quantity: 1 },
    });
    api.propose.mockResolvedValue({ id: 'offer-2' });
    render(<TradeReview {...base} theirCards={THEIRS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(base.onSent).toHaveBeenCalled());
    expect(api.propose.mock.calls[0][0].receive).toEqual([
      { oracleId: 'o-elves', name: 'Llanowar Elves', quantity: 2, copies: [] },
    ]);
  });
});
