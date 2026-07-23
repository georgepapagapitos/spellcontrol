// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';
import * as authApi from '../lib/auth-api';

vi.mock('../lib/platform', () => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));

const {
  createShareMock,
  listSharesMock,
  revokeShareMock,
  getPublicationMock,
  publishDeckMock,
  unpublishDeckMock,
  MockDisplayNameRequiredError,
} = vi.hoisted(() => {
  // A minimal but real Error subclass — doPublish()'s `instanceof
  // DisplayNameRequiredError` check must see the same class the mocked
  // publishDeck() throws.
  class MockDisplayNameRequiredError extends Error {}
  return {
    createShareMock: vi.fn(),
    listSharesMock: vi.fn(),
    revokeShareMock: vi.fn(),
    getPublicationMock: vi.fn(),
    publishDeckMock: vi.fn(),
    unpublishDeckMock: vi.fn(),
    MockDisplayNameRequiredError,
  };
});

vi.mock('../lib/share-client', () => ({
  createShare: (input: unknown) => createShareMock(input),
  listShares: () => listSharesMock(),
  revokeShare: (token: string) => revokeShareMock(token),
  shareUrl: (token: string) => `https://spellcontrol.com/s/${token}`,
}));

vi.mock('../lib/publications-client', () => ({
  getPublication: (deckId: string) => getPublicationMock(deckId),
  publishDeck: (deckId: string) => publishDeckMock(deckId),
  unpublishDeck: (deckId: string) => unpublishDeckMock(deckId),
  publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  DisplayNameRequiredError: MockDisplayNameRequiredError,
}));

const fireSealMock = vi.fn();
vi.mock('./shared/SealMoment', () => ({
  useSealMoment: () => ({ fire: fireSealMock, moment: null }),
}));

import { ShareDialog } from './ShareDialog';

// ShareDialog renders <Link> (the confirmed-public "Your profile" row, the
// no-friends "Friends page" link, and the guest sign-in prompt) — all need a
// Router context, mirroring this codebase's established MemoryRouter wrap.
function renderDialog(props: {
  resourceId?: string;
  resourceLabel: string;
  colorIdentity?: string[];
  onClose: () => void;
}) {
  return render(
    <MemoryRouter>
      <ShareDialog kind="deck" {...props} />
    </MemoryRouter>
  );
}

const PROFILE_WITH_NAME = {
  displayName: 'Alice',
  bio: null,
  avatarCardId: null,
  avatarCardName: null,
  avatarImageUrl: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  createShareMock.mockResolvedValue({
    token: 'tok-link',
    userId: 'u1',
    kind: 'deck',
    resourceId: 'd1',
    audience: 'link',
    addresseeId: null,
    createdAt: 1,
    revokedAt: null,
  });
  getPublicationMock.mockResolvedValue(null);
  fireSealMock.mockClear();
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: { ...PROFILE_WITH_NAME },
  });
});

describe('ShareDialog — Private revokes everything', () => {
  it('revokes every live share row for the resource and unpublishes a live publication, only after which does it show "not shared"', async () => {
    getPublicationMock.mockResolvedValue({
      slug: 'test-deck',
      url: 'https://spellcontrol.com/d/test-deck',
      publishedAt: 1,
      updatedAt: 1,
      unpublishedAt: null,
      viewCount: 2,
      copyCount: 0,
    });
    listSharesMock.mockResolvedValue([
      {
        token: 'tok-link',
        userId: 'u1',
        kind: 'deck',
        resourceId: 'd1',
        audience: 'link',
        addresseeId: null,
        createdAt: 1,
        revokedAt: null,
      },
      {
        token: 'tok-friends',
        userId: 'u1',
        kind: 'deck',
        resourceId: 'd1',
        audience: 'friends',
        addresseeId: null,
        createdAt: 2,
        revokedAt: null,
      },
      // A different resource's share — must NOT be revoked by this dialog.
      {
        token: 'tok-other-deck',
        userId: 'u1',
        kind: 'deck',
        resourceId: 'd2',
        audience: 'link',
        addresseeId: null,
        createdAt: 3,
        revokedAt: null,
      },
    ]);
    revokeShareMock.mockResolvedValue(undefined);
    unpublishDeckMock.mockResolvedValue(undefined);

    renderDialog({ resourceId: 'd1', resourceLabel: 'Test Deck', onClose: () => {} });

    // Settle on the already-published state before acting on it.
    await screen.findByRole('button', { name: 'Unpublish' });

    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));

    // Must never optimistically claim success before the revoke+unpublish
    // chain fully resolves.
    expect(screen.queryByText('Not shared — only you can see this.')).toBeNull();

    await waitFor(() => expect(revokeShareMock).toHaveBeenCalledTimes(2));
    expect(revokeShareMock).toHaveBeenCalledWith('tok-link');
    expect(revokeShareMock).toHaveBeenCalledWith('tok-friends');
    expect(revokeShareMock).not.toHaveBeenCalledWith('tok-other-deck');
    expect(unpublishDeckMock).toHaveBeenCalledWith('d1');

    await screen.findByText('Not shared — only you can see this.');
  });
});

describe('ShareDialog — going Public', () => {
  it('with no display name set, shows the inline sub-step; saving it proceeds straight to publishDeck', async () => {
    useAuth.setState({ profile: { ...PROFILE_WITH_NAME, displayName: null } });
    publishDeckMock.mockResolvedValue({
      slug: 'test-deck',
      url: 'https://spellcontrol.com/d/test-deck',
      publishedAt: 1,
      updatedAt: 1,
      unpublishedAt: null,
      viewCount: 0,
      copyCount: 0,
    });
    const updateSpy = vi
      .spyOn(authApi, 'updateProfile')
      .mockResolvedValue({ ...PROFILE_WITH_NAME, displayName: 'Alice' });

    renderDialog({ resourceId: 'd1', resourceLabel: 'Test Deck', onClose: () => {} });

    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make it public — anyone can view' })
    );

    const nameInput = await screen.findByLabelText('Display name');
    expect(publishDeckMock).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ displayName: 'Alice' }));
    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledWith('d1'));
  });

  it('with a display name already set, confirming publishes directly with no sub-step', async () => {
    renderDialog({ resourceId: 'd1', resourceLabel: 'Test Deck', onClose: () => {} });
    publishDeckMock.mockResolvedValue({
      slug: 'test-deck',
      url: 'https://spellcontrol.com/d/test-deck',
      publishedAt: 1,
      updatedAt: 1,
      unpublishedAt: null,
      viewCount: 0,
      copyCount: 0,
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make it public — anyone can view' })
    );

    expect(screen.queryByLabelText('Display name')).toBeNull();
    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledWith('d1'));
  });
});

describe('ShareDialog — first-publish seal (E150)', () => {
  it('fires the seal with the deck colour identity on a genuine first publish', async () => {
    publishDeckMock.mockResolvedValue({
      slug: 'seal-deck',
      url: 'https://spellcontrol.com/d/seal-deck',
      publishedAt: 1,
      updatedAt: 1,
      unpublishedAt: null,
      viewCount: 0,
      copyCount: 0,
      isFirstPublish: true,
    });

    renderDialog({
      resourceId: 'd-seal-first',
      resourceLabel: 'Test Deck',
      colorIdentity: ['G', 'U'],
      onClose: () => {},
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make it public — anyone can view' })
    );

    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledWith('d-seal-first'));
    await waitFor(() => expect(fireSealMock).toHaveBeenCalledWith(['G', 'U']));
  });

  it('never fires the seal on a republish (isFirstPublish: false)', async () => {
    publishDeckMock.mockResolvedValue({
      slug: 'seal-deck-2',
      url: 'https://spellcontrol.com/d/seal-deck-2',
      publishedAt: 1,
      updatedAt: 1,
      unpublishedAt: null,
      viewCount: 3,
      copyCount: 1,
      isFirstPublish: false,
    });

    renderDialog({ resourceId: 'd-seal-republish', resourceLabel: 'Test Deck', onClose: () => {} });

    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make it public — anyone can view' })
    );

    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledWith('d-seal-republish'));
    expect(fireSealMock).not.toHaveBeenCalled();
  });
});

describe('ShareDialog — reopening an already-published deck', () => {
  it('pre-selects Public with no extraneous createShare call', async () => {
    getPublicationMock.mockResolvedValue({
      slug: 'test-deck',
      url: 'https://spellcontrol.com/d/test-deck',
      publishedAt: 1,
      updatedAt: 1,
      unpublishedAt: null,
      viewCount: 5,
      copyCount: 2,
    });

    renderDialog({ resourceId: 'd1', resourceLabel: 'Test Deck', onClose: () => {} });

    await screen.findByRole('button', { name: 'Unpublish' });

    expect(screen.getByRole('radio', { name: 'Public' }).getAttribute('aria-checked')).toBe('true');
    expect(createShareMock).not.toHaveBeenCalled();
  });
});
