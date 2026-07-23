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

const updateProfileMock = vi.fn();
vi.mock('./auth-api', () => ({
  updateProfile: (patch: { displayName: string }) => updateProfileMock(patch),
}));

import { DeckNotSyncedYetError, DisplayNameRequiredError } from './publications-client';
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
    expect(result.current.publicDisabledReason).toBe("You're offline — reconnect to publish.");
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
    expect(result.current.needsDisplayName).toBe(false);
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

  it('on display_name_required, holds off onSettled and opens the inline substep', async () => {
    publishDeckMock.mockRejectedValueOnce(new DisplayNameRequiredError());
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.publishAfterCreate('deck-2');
    });

    expect(result.current.needsDisplayName).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('on a generic failure, toasts a warning and still calls onSettled with no outcome', async () => {
    publishDeckMock.mockRejectedValueOnce(new Error('server exploded'));
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePublishOnCreate(onSettled));

    await act(async () => {
      await result.current.publishAfterCreate('deck-3');
    });

    expect(onSettled).toHaveBeenCalledWith('deck-3');
    expect(result.current.needsDisplayName).toBe(false);
    expect(useToastsStore.getState().toasts.some((t) => t.tone === 'warn')).toBe(true);
  });
});

describe('usePublishOnCreate — display-name substep', () => {
  async function reachSubstep(onSettled = vi.fn()) {
    publishDeckMock.mockRejectedValueOnce(new DisplayNameRequiredError());
    const hook = renderHook(() => usePublishOnCreate(onSettled));
    await act(async () => {
      await hook.result.current.publishAfterCreate('deck-4');
    });
    return { ...hook, onSettled };
  }

  it('saveDisplayNameAndPublish updates the profile then retries publish exactly once, threading isFirstPublish', async () => {
    updateProfileMock.mockResolvedValue({
      displayName: 'Bob',
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    });
    // reachSubstep() queues its own rejected-once first — do NOT queue a
    // resolved-once ahead of it, that would jump the FIFO "once" queue and
    // make the FIRST (expected-to-fail) publishDeck call resolve instead.
    // The retry falls through to beforeEach's default mockResolvedValue.
    const { result, onSettled } = await reachSubstep();

    act(() => result.current.setDisplayNameDraft('Bob'));
    await act(async () => {
      await result.current.saveDisplayNameAndPublish();
    });

    expect(updateProfileMock).toHaveBeenCalledWith({ displayName: 'Bob' });
    expect(publishDeckMock).toHaveBeenCalledTimes(2); // the original attempt + the one retry
    expect(onSettled).toHaveBeenCalledWith('deck-4', { isFirstPublish: true });
    expect(result.current.needsDisplayName).toBe(false);
  });

  it('a failed save toasts a warning and still calls onSettled with no outcome', async () => {
    updateProfileMock.mockRejectedValue(new Error('name taken'));
    const { result, onSettled } = await reachSubstep();

    act(() => result.current.setDisplayNameDraft('Bob'));
    await act(async () => {
      await result.current.saveDisplayNameAndPublish();
    });

    expect(onSettled).toHaveBeenCalledWith('deck-4');
    expect(result.current.needsDisplayName).toBe(false);
    expect(useToastsStore.getState().toasts.some((t) => t.tone === 'warn')).toBe(true);
  });

  it('cancelDisplayName never calls publishDeck again, and still settles the deck as created', async () => {
    const { result, onSettled } = await reachSubstep();
    publishDeckMock.mockClear();

    act(() => result.current.cancelDisplayName());

    expect(publishDeckMock).not.toHaveBeenCalled();
    expect(result.current.needsDisplayName).toBe(false);
    expect(onSettled).toHaveBeenCalledWith('deck-4');
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
