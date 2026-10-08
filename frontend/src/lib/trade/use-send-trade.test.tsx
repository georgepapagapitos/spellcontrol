// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TradeCard, TradeOffer } from './trades-client';

const calls: string[] = [];
const proposeMock = vi.fn<(input: unknown) => Promise<TradeOffer>>();
const counterMock = vi.fn<(id: string, input: unknown) => Promise<TradeOffer>>();
const declineMock = vi.fn();
vi.mock('./trades-client', () => {
  class TradeConflictError extends Error {}
  return {
    proposeTrade: (input: unknown) => proposeMock(input),
    counterTrade: (id: string, input: unknown) => counterMock(id, input),
    declineTrade: () => declineMock(),
    TradeConflictError,
  };
});
const toastMock = vi.fn();
vi.mock('@/store/toasts', () => ({ toast: { show: (t: unknown) => toastMock(t) } }));
vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

import { useSendTrade } from './use-send-trade';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { emptyDraft } from './trade-draft';
import { TradeConflictError } from './trades-client';

const offer = { id: 'new' } as TradeOffer;
const input = { give: [] as TradeCard[], receive: [] as TradeCard[], note: '  hi  ' };

function seedDraft() {
  useTradeDraftsStore.getState().setDraft('me', 'f1', {
    ...emptyDraft('f1', 'Ann'),
    get: { a: { name: 'A', quantity: 1 } },
  });
}

function counterHook(onSent = vi.fn()) {
  return {
    onSent,
    ...renderHook(() =>
      useSendTrade({
        friendId: 'f1',
        friendName: 'Ann',
        counterTo: { offerId: 'old', name: 'Ann' },
        onSent,
      })
    ),
  };
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  useTradeDraftsStore.setState({ drafts: {} });
  proposeMock.mockImplementation(async () => {
    calls.push('propose');
    return offer;
  });
  counterMock.mockImplementation(async () => {
    calls.push('counter');
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
    expect(counterMock).not.toHaveBeenCalled();
    expect(declineMock).not.toHaveBeenCalled();
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).toBeNull();
    expect(onSent).toHaveBeenCalledWith(offer);
  });

  it('counters with ONE atomic call and never proposes or declines separately', async () => {
    seedDraft();
    const { result, onSent } = counterHook();
    await act(() => result.current.send(input));
    expect(calls).toEqual(['counter']);
    expect(counterMock).toHaveBeenCalledWith('old', { give: [], receive: [], note: 'hi' });
    expect(proposeMock).not.toHaveBeenCalled();
    expect(declineMock).not.toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledWith(offer);
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).toBeNull();
  });

  it('on a 409 keeps the draft, warns with the server copy, and can send again', async () => {
    counterMock.mockRejectedValueOnce(new TradeConflictError('That trade was already answered.'));
    seedDraft();
    const { result, onSent } = counterHook();
    await act(() => result.current.send(input));
    expect(onSent).not.toHaveBeenCalled();
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).not.toBeNull();
    expect(toastMock).toHaveBeenCalledWith({
      message: 'That trade was already answered.',
      tone: 'warn',
    });
    expect(result.current.sending).toBe(false);
  });

  it('on a failed counter: keeps the draft, toasts an error, can send again', async () => {
    counterMock.mockRejectedValueOnce(new Error('boom'));
    seedDraft();
    const { result, onSent } = counterHook();
    await act(() => result.current.send(input));
    expect(declineMock).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).not.toBeNull();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(result.current.sending).toBe(false);
  });
});
