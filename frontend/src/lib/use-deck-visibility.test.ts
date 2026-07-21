// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { resolveDeckVisibility, useDeckVisibility } from './use-deck-visibility';
import type { Publication } from './publications-client';
import type { ShareRow } from './shared-types';

let authStatus: 'unknown' | 'loading' | 'authed' | 'guest' = 'authed';
vi.mock('../store/auth', () => ({
  useAuth: <T>(selector: (s: { status: string }) => T): T => selector({ status: authStatus }),
}));

const getPublicationMock = vi.fn<() => Promise<Publication | null>>();
const listSharesMock = vi.fn<() => Promise<ShareRow[]>>();
vi.mock('./publications-client', () => ({
  getPublication: () => getPublicationMock(),
}));
vi.mock('./share-client', () => ({
  listShares: () => listSharesMock(),
}));

const PUB_LIVE: Publication = {
  slug: 'korvold-treasure',
  url: 'https://spellcontrol.com/d/korvold-treasure',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 4,
  copyCount: 1,
};
const PUB_UNPUBLISHED: Publication = { ...PUB_LIVE, unpublishedAt: 2 };

function share(
  kind: ShareRow['kind'],
  resourceId: string,
  audience: ShareRow['audience']
): ShareRow {
  return {
    token: `${kind}-${resourceId}-${audience}`,
    userId: 'u1',
    kind,
    resourceId,
    audience,
    addresseeId: null,
    createdAt: 1,
    revokedAt: null,
  };
}

describe('resolveDeckVisibility (state precedence)', () => {
  it('is private when there is no publication and no shares', () => {
    expect(resolveDeckVisibility(null, [], 'd1')).toBe('private');
  });

  it('is link when only a link share exists for this deck', () => {
    expect(resolveDeckVisibility(null, [share('deck', 'd1', 'link')], 'd1')).toBe('link');
  });

  it('is friends when a friends share exists, even alongside a link share', () => {
    const shares = [share('deck', 'd1', 'link'), share('deck', 'd1', 'friends')];
    expect(resolveDeckVisibility(null, shares, 'd1')).toBe('friends');
  });

  it('is public when a live publication exists, even alongside friends/link shares', () => {
    const shares = [share('deck', 'd1', 'link'), share('deck', 'd1', 'friends')];
    expect(resolveDeckVisibility(PUB_LIVE, shares, 'd1')).toBe('public');
  });

  it('falls through to the share ladder when the publication was unpublished', () => {
    expect(resolveDeckVisibility(PUB_UNPUBLISHED, [share('deck', 'd1', 'link')], 'd1')).toBe(
      'link'
    );
    expect(resolveDeckVisibility(PUB_UNPUBLISHED, [], 'd1')).toBe('private');
  });

  it('ignores direct (send-to-a-friend) shares — not a visibility level', () => {
    expect(resolveDeckVisibility(null, [share('deck', 'd1', 'direct')], 'd1')).toBe('private');
  });

  it('ignores shares for a different resource or a different kind', () => {
    const shares = [share('deck', 'other-deck', 'link'), share('collection', 'd1', 'link')];
    expect(resolveDeckVisibility(null, shares, 'd1')).toBe('private');
  });
});

describe('useDeckVisibility', () => {
  beforeEach(() => {
    authStatus = 'authed';
    getPublicationMock.mockReset().mockResolvedValue(null);
    listSharesMock.mockReset().mockResolvedValue([]);
  });

  it('resolves to private with no network call for a guest', async () => {
    authStatus = 'guest';
    const { result } = renderHook(() => useDeckVisibility('d1'));
    expect(result.current.visibility).toBe('private');
    expect(getPublicationMock).not.toHaveBeenCalled();
    expect(listSharesMock).not.toHaveBeenCalled();
  });

  it('resolves to private with no network call while auth is still bootstrapping', async () => {
    authStatus = 'unknown';
    renderHook(() => useDeckVisibility('d1'));
    expect(getPublicationMock).not.toHaveBeenCalled();
  });

  it('fetches and resolves public for an authed caller with a live publication', async () => {
    getPublicationMock.mockResolvedValue(PUB_LIVE);
    const { result } = renderHook(() => useDeckVisibility('d1'));
    await waitFor(() => expect(result.current.visibility).toBe('public'));
  });

  it('refetch() re-runs the fetch and picks up a changed result', async () => {
    const { result, rerender } = renderHook(() => useDeckVisibility('d1'));
    await waitFor(() => expect(getPublicationMock).toHaveBeenCalledTimes(1));
    expect(result.current.visibility).toBe('private');

    getPublicationMock.mockResolvedValue(PUB_LIVE);
    result.current.refetch();
    rerender();

    await waitFor(() => expect(getPublicationMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.visibility).toBe('public'));
  });
});
