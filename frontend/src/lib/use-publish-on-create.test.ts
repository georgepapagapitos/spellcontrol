// @vitest-environment happy-dom
/**
 * Hook-level coverage for the creation-time publish choke point (E150):
 * every branch DeckNewPage's fieldset and ImportDeckDialog's fieldset both
 * route through, so it's tested once here instead of forked per surface.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';
import type { PublishResult } from './publications-client';

let online = true;
vi.mock('./sync', () => ({
  isOnline: () => online,
  onSyncedChange: () => () => {},
}));

const publishDeckMock = vi.fn<() => Promise<PublishResult>>();
vi.mock('./publications-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./publications-client')>();
  return {
    ...actual,
    publishDeck: () => publishDeckMock(),
    publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  };
});

const createShareMock = vi.fn();
vi.mock('./share-client', () => ({
  createShare: (input: unknown) => createShareMock(input),
}));

const updateProfileMock = vi.fn();
vi.mock('./auth-api', () => ({
  updateProfile: (patch: { displayName: string }) => updateProfileMock(patch),
}));

import { DeckNotSyncedYetError } from './publications-client';
import { usePublishOnCreate } from './use-publish-on-create';

const PUB_FIRST: PublishResult = {
  slug: 'my-deck',
  url: 'https://spellcontrol.com/d/my-deck',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 0,
  copyCount: 0,
  isFirstPublish: true,
};

function setAuthed() {
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: {
      displayName: 'Alice',
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    },
  });
}

beforeEach(() => {
  online = true;
  setAuthed();
  publishDeckMock.mockReset().mockResolvedValue(PUB_FIRST);
  createShareMock.mockReset().mockResolvedValue({ token: 'tok', audience: 'friends' });
  updateProfileMock.mockReset();
  useToastsStore.setState({ toasts: [] });
});
afterEach(() => useToastsStore.setState({ toasts: [] }));

describe('usePublishOnCreate — gating', () => {
  it('canPublish is true when authed + online, with no disabled reason', () => {
    const { result } = renderHook(() => usePublishOnCreate(vi.fn()));
    expect(result.current.canPublish).toBe(true);
    expect(result.current.publicDisabledReason).toBeNull();
  });

  it('disables publishing for a guest, with a sign-in reason', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    const { result } = renderHook(() => usePublishOnCreate(vi.fn()));
    expect(result.current.canPublish).toBe(false);
    expect(result.current.publicDisabledReason).toBe('Sign in to publish.');
  });

  it('disables publishing while offline, with a reconnect reason', () => {
    online = false;
    const { result } = renderHook(() => usePublishOnCreate(vi.fn()));
    expect(result.current.canPublish).toBe(false);
    expect(result.current.publicDisabledReason).toBe("You're offline. Reconnect to publish.");
  });

  it('snaps a selected Public back to Private if canPublish goes false underneath it', () => {
    const { result, rerender } = renderHook(() => usePublishOnCreate(vi.fn()));
    act(() => result.current.setVisibility('public'));
    expect(result.current.visibility).toBe('public');

    act(() => {
      useAuth.setState({
        user: null,
        status: 'guest',
        error: null,
        autoLinkedAt: null,
        profile: null,
      });
    });
    rerender();
    expect(result.current.visibility).toBe('private');
  });

  it('snaps a selected Friends back to Private the same way', () => {
    const { result, rerender } = renderHook(() => usePublishOnCreate(vi.fn()));
    act(() => result.current.setVisibility('friends'));
    expect(result.current.visibility).toBe('friends');

    act(() => {
      useAuth.setState({
        user: null,
        status: 'guest',
        error: null,
        autoLinkedAt: null,
        profile: null,
      });
    });
    rerender();
    expect(result.current.visibility).toBe('private');
  });
});

describe('usePublishOnCreate — shareWithFriendsAfterCreate', () => {
  it('mints the same friends share ShareDialog does, and settles with no outcome', async () => {
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.shareWithFriendsAfterCreate('deck-1');
    });

    expect(createShareMock).toHaveBeenCalledWith({
      kind: 'deck',
      resourceId: 'deck-1',
      audience: 'friends',
    });
    expect(onSettled).toHaveBeenCalledWith('deck-1');
  });

  it('on failure, toasts a warning and still calls onSettled', async () => {
    createShareMock.mockRejectedValueOnce(new Error('server exploded'));
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.shareWithFriendsAfterCreate('deck-1');
    });

    expect(onSettled).toHaveBeenCalledWith('deck-1');
    expect(useToastsStore.getState().toasts.some((t) => t.tone === 'warn')).toBe(true);
  });
});

describe('usePublishOnCreate — publishAfterCreate', () => {
  it('on success, threads isFirstPublish through onSettled', async () => {
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.publishAfterCreate('deck-1');
    });

    expect(publishDeckMock).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith('deck-1', { isFirstPublish: true });
  });

  it('retries once and succeeds when the deck is still racing its own fire-and-forget sync (DeckNotSyncedYetError)', async () => {
    publishDeckMock
      .mockRejectedValueOnce(new DeckNotSyncedYetError())
      .mockResolvedValueOnce(PUB_FIRST);
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.publishAfterCreate('deck-1');
    });

    expect(publishDeckMock).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledWith('deck-1', { isFirstPublish: true });
    // Never surfaced as an error — the retry is invisible to the user.
    expect(useToastsStore.getState().toasts.some((t) => t.tone === 'warn')).toBe(false);
  });

  it('gives up after exactly one retry, surfacing the failure like any other', async () => {
    publishDeckMock
      .mockRejectedValueOnce(new DeckNotSyncedYetError())
      .mockRejectedValueOnce(new DeckNotSyncedYetError());
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.publishAfterCreate('deck-1');
    });

    expect(publishDeckMock).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledWith('deck-1');
    expect(useToastsStore.getState().toasts.some((t) => t.tone === 'warn')).toBe(true);
  });

  it('on a generic failure, toasts a warning and still calls onSettled with no outcome', async () => {
    publishDeckMock.mockRejectedValueOnce(new Error('server exploded'));
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.publishAfterCreate('deck-3');
    });

    expect(onSettled).toHaveBeenCalledWith('deck-3');
    expect(useToastsStore.getState().toasts.some((t) => t.tone === 'warn')).toBe(true);
  });
});

describe('usePublishOnCreate — republish is never a first publish', () => {
  it('threads isFirstPublish: false straight through when the server reports a refresh/republish', async () => {
    publishDeckMock.mockResolvedValueOnce({ ...PUB_FIRST, isFirstPublish: false });
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.publishAfterCreate('deck-5');
    });

    expect(onSettled).toHaveBeenCalledWith('deck-5', { isFirstPublish: false });
  });
});
