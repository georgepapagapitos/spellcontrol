// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TradeCard, TradeOffer } from './trades-client';

const calls: string[] = [];
const proposeMock = vi.fn<(input: unknown) => Promise<TradeOffer>>();
const declineMock = vi.fn<(id: string) => Promise<TradeOffer>>();
vi.mock('./trades-client', () => ({
  proposeTrade: (input: unknown) => proposeMock(input),
  declineTrade: (id: string) => declineMock(id),
}));
const toastMock = vi.fn();
vi.mock('@/store/toasts', () => ({ toast: { show: (t: unknown) => toastMock(t) } }));
vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

import { useSendTrade } from './use-send-trade';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { emptyDraft } from './trade-draft';

const offer = { id: 'new' } as TradeOffer;
const input = { give: [] as TradeCard[], receive: [] as TradeCard[], note: '  hi  ' };

function seedDraft() {
  useTradeDraftsStore.getState().setDraft('me', 'f1', {
    ...emptyDraft('f1', 'Ann'),
    get: { a: { name: 'A', quantity: 1 } },
  });
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  useTradeDraftsStore.setState({ drafts: {} });
  proposeMock.mockImplementation(async () => {
    calls.push('propose');
    return offer;
  });
  declineMock.mockImplementation(async () => {
    calls.push('decline');
    return offer;
  });
});

describe('useSendTrade', () => {
  it('proposes, toasts, clears the draft, then reports the offer', async () => {
    seedDraft();
    const onSent = vi.fn();
    const { result } = renderHook(() =>
      useSendTrade({ friendId: 'f1', friendName: 'Ann', onSent })
    );
    await act(() => result.current.send(input));
    expect(proposeMock).toHaveBeenCalledWith({
      recipientId: 'f1',
      give: [],
      receive: [],
      note: 'hi',
    });
    expect(toastMock).toHaveBeenCalledWith({ message: 'Trade sent to Ann.', tone: 'success' });
    expect(declineMock).not.toHaveBeenCalled();
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).toBeNull();
    expect(onSent).toHaveBeenCalledWith(offer);
  });

  it('declines the countered offer AFTER the new one is sent', async () => {
    const { result } = renderHook(() =>
      useSendTrade({
        friendId: 'f1',
        friendName: 'Ann',
        counterTo: { offerId: 'old', name: 'Ann' },
        onSent: vi.fn(),
      })
    );
    await act(() => result.current.send(input));
    expect(calls).toEqual(['propose', 'decline']);
    expect(declineMock).toHaveBeenCalledWith('old');
  });

  it('warns but still finishes when the decline fails', async () => {
    declineMock.mockRejectedValue(new Error('nope'));
    seedDraft();
    const onSent = vi.fn();
    const { result } = renderHook(() =>
      useSendTrade({
        friendId: 'f1',
        friendName: 'Ann',
        counterTo: { offerId: 'old', name: 'Bob' },
        onSent,
      })
    );
    await act(() => result.current.send(input));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'warn', message: expect.stringContaining("Bob's offer") })
    );
    expect(onSent).toHaveBeenCalledWith(offer);
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).toBeNull();
  });

  it('on a failed send: no decline, keeps the draft, toasts an error, can send again', async () => {
    proposeMock.mockRejectedValueOnce(new Error('boom'));
    seedDraft();
    const onSent = vi.fn();
    const { result } = renderHook(() =>
      useSendTrade({
        friendId: 'f1',
        friendName: 'Ann',
        counterTo: { offerId: 'old', name: 'Ann' },
        onSent,
      })
    );
    await act(() => result.current.send(input));
    expect(declineMock).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).not.toBeNull();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(result.current.sending).toBe(false);
  });
});
