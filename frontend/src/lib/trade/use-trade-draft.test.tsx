// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

let viewer: string | null = 'me';
vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: viewer ? { id: viewer } : null }),
}));

import { useTradeDraft } from './use-trade-draft';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { emptyDraft } from './trade-draft';

const withCard = { ...emptyDraft('f1', 'Ann'), get: { a: { name: 'A', quantity: 1 } } };

beforeEach(() => {
  viewer = 'me';
  useTradeDraftsStore.setState({ drafts: {} });
});

describe('useTradeDraft', () => {
  it('saves and clears the signed-in viewer draft for one friend', () => {
    const { result } = renderHook(() => useTradeDraft('f1'));
    expect(result.current.draft).toBeNull();
    act(() => result.current.save(withCard));
    expect(result.current.draft?.get.a.quantity).toBe(1);
    expect(useTradeDraftsStore.getState().getDraft('me', 'f1')).not.toBeNull();
    act(() => result.current.clear());
    expect(result.current.draft).toBeNull();
  });

  it('is inert when signed out', () => {
    viewer = null;
    const { result } = renderHook(() => useTradeDraft('f1'));
    act(() => result.current.save(withCard));
    act(() => result.current.clear());
    expect(result.current.draft).toBeNull();
    expect(useTradeDraftsStore.getState().drafts).toEqual({});
  });

  it('does not show another viewer a draft', () => {
    useTradeDraftsStore.getState().setDraft('other', 'f1', withCard);
    const { result } = renderHook(() => useTradeDraft('f1'));
    expect(result.current.draft).toBeNull();
  });
});
