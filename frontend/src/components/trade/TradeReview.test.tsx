// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../../types';
import type { PublicCard } from '@/lib/social/shared-types';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));

const floors = vi.hoisted(() => ({ map: new Map<string, number | null>(), pending: false }));
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: floors.map, pending: floors.pending }) };
});

const firstPull = vi.hoisted(() => ({ awaiting: false }));
vi.mock('@/lib/sync/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => firstPull.awaiting,
}));

vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' }, status: 'authed' }),
}));

let storeState: { cards: EnrichedCard[] } = { cards: [] };
vi.mock('@/store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel(storeState),
}));
vi.mock('@/store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));
vi.mock('@/store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));

const api = vi.hoisted(() => ({ propose: vi.fn(), decline: vi.fn() }));
vi.mock('@/lib/trade/trades-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade/trades-client')>(
    '@/lib/trade/trades-client'
  );
  return { ...actual, proposeTrade: api.propose, declineTrade: api.decline };
});

const preview = vi.hoisted(() => ({ dropFirst: false }));
vi.mock('@/lib/trade/trade-preview', () => ({
  resolveTradePreview: async (rows: Array<{ oracleId: string; name: string }>) => {
    const kept = preview.dropFirst ? rows.slice(1) : rows;
    return {
      cards: kept.map((r) => ({ name: r.name })),
      indexOf: (r: { oracleId: string }) => kept.findIndex((k) => k.oracleId === r.oracleId),
    };
  },
}));
vi.mock('./TradePreviewCarousel', () => ({
  TradePreviewCarousel: ({ state }: { state: { index: number; cards: unknown[] } }) => (
    <div data-testid="carousel" data-index={state.index} data-count={state.cards.length} />
  ),
}));

import { TradeReview } from './TradeReview';
import { TradeReviewSheet } from './TradeReviewSheet';
import { TradeTray } from './TradeTray';
import { TradeDock } from './TradeDock';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { emptyDraft, type TradeDraft } from '@/lib/trade/trade-draft';

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

function theirs(name: string, oracleId: string, copies: number): PublicCard[] {
  return Array.from({ length: copies }, (_, i) => ({
    name,
    oracleId,
    scryfallId: `t-${oracleId}-${i}`,
  })) as PublicCard[];
}

function seed(patch: Partial<TradeDraft>) {
  useTradeDraftsStore.getState().setDraft('me', 'f1', { ...emptyDraft('f1', 'Pal'), ...patch });
}
const stored = () => useTradeDraftsStore.getState().getDraft('me', 'f1');

const SOL = { 'o-sol': { name: 'Sol Ring', oracleId: 'o-sol', quantity: 1 } };
const CS = { 'o-cs': { name: 'Counterspell', oracleId: 'o-cs', copyIds: ['a'] } };
const base = {
  friendId: 'f1',
  friendName: 'Pal',
  onAddMore: vi.fn(),
  onAddFromYours: vi.fn(),
  onSent: vi.fn(),
};

beforeEach(() => {
  useTradeDraftsStore.setState({ drafts: {} });
  storeState = { cards: [] };
  firstPull.awaiting = false;
  floors.map = new Map();
  floors.pending = false;
  preview.dropFirst = false;
  api.propose.mockReset();
  api.decline.mockReset();
  base.onSent.mockReset();
});

describe('TradeReview', () => {
  it('caps the get stepper at how many copies they have', () => {
    seed({ get: SOL });
    render(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 2)} />);

    const more = () => screen.getByRole('button', { name: 'One more Sol Ring' });
    fireEvent.click(more());
    expect(stored()?.get['o-sol'].quantity).toBe(2);
    expect((more() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Pal has 2/)).toBeTruthy();
  });

  it('blocks Send on a gone line until it is removed', () => {
    seed({ get: { ...SOL, 'o-gone': { name: 'Mana Crypt', oracleId: 'o-gone', quantity: 1 } } });
    render(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);

    const send = () => screen.getByRole('button', { name: 'Send offer' }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(screen.getByText(/Mana Crypt left Pal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(stored()?.get['o-gone']).toBeUndefined();
    expect(send().disabled).toBe(false);
  });

  it('sends through use-send-trade and clears the draft', async () => {
    seed({ get: SOL, note: ' hi ' });
    api.propose.mockResolvedValue({ id: 'offer-1' });
    render(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(base.onSent).toHaveBeenCalledWith({ id: 'offer-1' }));
    expect(api.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'f1',
        note: 'hi',
        receive: [expect.objectContaining({ oracleId: 'o-sol', quantity: 1 })],
      })
    );
    expect(stored()).toBeNull();
  });

  it('keeps the draft and offers Retry when the send fails', async () => {
    seed({ get: SOL });
    api.propose.mockRejectedValueOnce(new Error('nope'));
    render(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText(/saved as a draft/)).toBeTruthy();
    expect(stored()).not.toBeNull();
    expect(base.onSent).not.toHaveBeenCalled();

    api.propose.mockResolvedValueOnce({ id: 'offer-2' });
    fireEvent.click(retry);
    await waitFor(() => expect(base.onSent).toHaveBeenCalled());
    expect(stored()).toBeNull();
  });

  it('shows the counter banner', () => {
    seed({ get: SOL, counterTo: { offerId: 'o1', name: 'Sam' } });
    render(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);
    expect(screen.getByText("Countering Sam's offer. Sending this declines theirs.")).toBeTruthy();
  });

  it('states the net with "about" when their side is a floor, and omits it unpriced', () => {
    storeState = { cards: [owned('a', 'Counterspell', 'o-cs', 10)] };
    seed({ get: SOL, give: CS });
    floors.map = new Map([['Sol Ring', 30]]);
    const { rerender } = render(
      <TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />
    );
    expect(screen.getByText('You come out about $20.00 ahead')).toBeTruthy();

    floors.map = new Map();
    rerender(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);
    expect(screen.queryByText(/ahead|even/i)).toBeNull();
  });

  it('expands the printing chooser inline from the printing line', () => {
    storeState = { cards: [owned('a', 'Counterspell', 'o-cs', 2)] };
    seed({ give: CS });
    render(
      <MemoryRouter>
        <TradeReview {...base} theirCards={null} />
      </MemoryRouter>
    );

    expect(screen.queryByRole('list', { name: 'Counterspell: your printings' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Choose which printing of Counterspell/ }));
    expect(screen.getByRole('list', { name: 'Counterspell: your printings' })).toBeTruthy();
  });

  it('shows a loading state for the give side on a first pull', () => {
    firstPull.awaiting = true;
    seed({ give: CS });
    render(<TradeReview {...base} theirCards={null} />);

    expect(screen.getByRole('status', { name: 'Getting your cards…' })).toBeTruthy();
    // The saved give line must survive a reconcile against an empty store.
    expect(stored()?.give['o-cs']).toBeDefined();
    expect((screen.getByRole('button', { name: 'Send offer' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('offers a next action on an empty side', () => {
    seed({ get: SOL });
    render(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick from your cards' }));
    expect(base.onAddFromYours).toHaveBeenCalled();
  });

  it('explains the 40-line cap', () => {
    const get = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `o-${i}`,
        { name: `Card ${i}`, oracleId: `o-${i}`, quantity: 1 },
      ])
    );
    seed({ get });
    render(<TradeReview {...base} theirCards={null} />);
    expect(screen.getByText(/40 different cards per side/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: "Add more of Pal's cards" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('opens the whole deal in the preview, mapped through indexOf', async () => {
    storeState = { cards: [owned('a', 'Counterspell', 'o-cs', 2)] };
    seed({ get: SOL, give: CS });
    preview.dropFirst = true; // the give card (first slide) fails to resolve
    render(<TradeReview {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Sol Ring' }));
    const carousel = await screen.findByTestId('carousel');
    expect(carousel.getAttribute('data-count')).toBe('1');
    expect(carousel.getAttribute('data-index')).toBe('0');
  });
});

describe('TradeReviewSheet', () => {
  it('closing keeps the draft', () => {
    seed({ get: SOL });
    const onClose = vi.fn();
    render(
      <TradeReviewSheet {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} onClose={onClose} />
    );
    expect(
      document.body.querySelector('.trade-review-backdrop.modal-backdrop--sheet')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(stored()?.get['o-sol']).toBeDefined();
  });
});

describe('TradeDock', () => {
  it('renders the review with Send pinned in its footer', () => {
    seed({ get: SOL });
    render(<TradeDock {...base} theirCards={theirs('Sol Ring', 'o-sol', 1)} />);
    const dock = screen.getByRole('complementary', { name: 'Trade with Pal' });
    expect(dock.querySelector('.trade-review-foot button')?.textContent).toBe('Send offer');
  });
});

describe('TradeTray', () => {
  it('is hidden while the draft is empty', () => {
    const { container } = render(
      <TradeTray friendId="f1" friendName="Pal" theirCards={null} onReview={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows counts and the net, and opens the review', () => {
    storeState = { cards: [owned('a', 'Counterspell', 'o-cs', 10)] };
    seed({ get: SOL, give: CS });
    floors.map = new Map([['Sol Ring', 30]]);
    const onReview = vi.fn();
    render(
      <TradeTray
        friendId="f1"
        friendName="Pal"
        theirCards={theirs('Sol Ring', 'o-sol', 1)}
        onReview={onReview}
      />
    );
    expect(screen.getByText(/Get 1 · Give 1/)).toBeTruthy();
    expect(screen.getByText('about $20.00 ahead')).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Review trade with Pal/ }));
    });
    expect(onReview).toHaveBeenCalled();
  });
});
