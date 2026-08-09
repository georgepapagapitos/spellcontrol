// @vitest-environment happy-dom
/**
 * TradesPage — /trades, the cross-friend offer index.
 *
 * The load-bearing behaviours: it asks for EVERY offer (no `withUserId`, the
 * whole reason the page can exist without backend work), it buckets by what
 * the viewer has to do rather than by friend, each row links to that
 * counterparty's hub, and all four states render (loading / whole-page empty /
 * per-group empty / error + retry).
 *
 * No `@testing-library/jest-dom` in this repo — plain vitest matchers.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeOffer } from '../lib/trades-client';

vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: { status: string }) => unknown) => sel({ status: 'authed' }),
}));

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: unknown[] }) => unknown) => sel({ cards: [] }),
}));

vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const listTrades = vi.fn();
vi.mock('../lib/trades-client', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/trades-client')>('../lib/trades-client');
  return { ...actual, listTrades: (...args: unknown[]) => listTrades(...args) };
});

import { TradesPage } from './TradesPage';

function makeOffer(overrides: Partial<TradeOffer> & { id: string }): TradeOffer {
  return {
    mine: false,
    counterpartyId: 'friend-1',
    counterpartyUsername: 'tradepal',
    counterpartyDisplayName: null,
    status: 'proposed',
    note: '',
    give: [{ oracleId: 'sol', name: 'Sol Ring', quantity: 1, copies: [] }],
    receive: [{ oracleId: 'bolt', name: 'Lightning Bolt', quantity: 1, copies: [] }],
    settled: false,
    createdAt: 1,
    updatedAt: 1,
    resolvedAt: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/trades']}>
      <TradesPage />
    </MemoryRouter>
  );
}

/** The <section> wrapping one status group, found by its heading. */
function group(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('TradesPage', () => {
  beforeEach(() => {
    listTrades.mockReset();
  });

  it('asks for every offer, not one friend’s thread', async () => {
    listTrades.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/no trades yet/i);

    expect(listTrades).toHaveBeenCalledTimes(1);
    // No argument at all — `withUserId` would narrow it back to one hub.
    expect(listTrades.mock.calls[0]).toEqual([]);
  });

  it('shows a skeleton until the first fetch settles', async () => {
    listTrades.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByLabelText('Loading your trades')).toBeTruthy();
    expect(screen.queryByText(/no trades yet/i)).toBeNull();
  });

  it('buckets by what the viewer has to do, not by friend', async () => {
    listTrades.mockResolvedValue([
      makeOffer({ id: 'incoming', mine: false, status: 'proposed' }),
      makeOffer({ id: 'outgoing', mine: true, status: 'proposed' }),
      makeOffer({ id: 'done', status: 'accepted', settled: true }),
    ]);
    renderPage();

    await screen.findByText('Needs your answer');
    expect(within(group('Needs your answer')).getByTestId('trade-status-incoming')).toBeTruthy();
    expect(within(group('Waiting on them')).getByTestId('trade-status-outgoing')).toBeTruthy();
    expect(within(group('Settled & past')).getByTestId('trade-status-done')).toBeTruthy();
  });

  it('identifies the counterparty and links each row to their hub', async () => {
    listTrades.mockResolvedValue([
      makeOffer({
        id: 'a',
        counterpartyId: 'friend-9',
        counterpartyUsername: 'tradepal',
        counterpartyDisplayName: 'Trade Pal',
      }),
    ]);
    renderPage();

    const link = await screen.findByRole('link', { name: /Trade Pal/ });
    expect(link.getAttribute('href')).toBe('/friends/friend-9');
    // Direction still reads on the index, where the sections mix people.
    expect(link.textContent).toContain('Offered you');
  });

  it('renders a per-group empty line while other groups have rows', async () => {
    listTrades.mockResolvedValue([makeOffer({ id: 'incoming' })]);
    renderPage();

    await screen.findByText('Needs your answer');
    expect(within(group('Waiting on them')).getByText('You have no offers out.')).toBeTruthy();
    // The whole-page empty state is a different treatment and must not appear.
    expect(screen.queryByText(/no trades yet/i)).toBeNull();
  });

  it('offers a whole-page empty state pointing at where trades start', async () => {
    listTrades.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no trades yet/i)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /find a friend to trade with/i }).getAttribute('href')
    ).toBe('/friends');
    expect(screen.queryByText('Needs your answer')).toBeNull();
  });

  it('never claims "no trades" when the load simply failed', async () => {
    listTrades.mockRejectedValue(new Error('Network is down.'));
    renderPage();

    await screen.findByRole('alert');
    // A failed load is not an empty collection — neither the page-level empty
    // state nor the per-group "nothing waiting on you" lines may assert it.
    expect(screen.queryByText(/no trades yet/i)).toBeNull();
    expect(screen.queryByText('Nothing waiting on you right now.')).toBeNull();
    expect(screen.queryByText('Needs your answer')).toBeNull();
  });

  it('surfaces a load failure and retries on demand', async () => {
    listTrades.mockRejectedValueOnce(new Error('Network is down.'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Network is down.')).toBeTruthy();

    listTrades.mockResolvedValueOnce([makeOffer({ id: 'incoming' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Needs your answer')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
