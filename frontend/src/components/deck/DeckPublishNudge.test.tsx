// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../store/auth';

vi.mock('../../lib/platform', () => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));
vi.mock('../../lib/publications-client', () => ({
  getPublication: () => Promise.resolve(null),
  publishDeck: () => Promise.reject(new Error('not used in this suite')),
  unpublishDeck: () => Promise.resolve(),
  publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  DisplayNameRequiredError: class extends Error {},
}));
vi.mock('../../lib/share-client', () => ({
  createShare: () => Promise.resolve({ token: 'tok', audience: 'link' }),
  listShares: () => Promise.resolve([]),
  revokeShare: () => Promise.resolve(),
  shareUrl: (token: string) => `https://spellcontrol.com/s/${token}`,
}));

import { DeckPublishNudge } from './DeckPublishNudge';

function renderNudge() {
  return render(
    <MemoryRouter>
      <DeckPublishNudge deckId="d1" deckName="Test Deck" />
    </MemoryRouter>
  );
}

beforeEach(() => {
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
});

describe('DeckPublishNudge', () => {
  it('renders the nudge with a Share action for an authed user', () => {
    renderNudge();
    expect(screen.getByRole('status').textContent).toContain('Only you can see this deck');
    expect(screen.getByRole('button', { name: 'Share…' })).toBeTruthy();
  });

  it('renders nothing for a guest — ShareDialog would just hit a sign-in wall', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    const { container } = renderNudge();
    expect(container.firstChild).toBeNull();
  });

  it('dismiss hides it immediately, for the rest of this render', () => {
    const { container } = renderNudge();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.firstChild).toBeNull();
  });

  it('opens ShareDialog on Share…, and closing it (for any reason) retires the nudge', async () => {
    const { container } = renderNudge();
    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));

    const dialogTitle = await screen.findByText('Share Test Deck');
    expect(dialogTitle).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    // Private on an already-private deck is a no-op that still lets Done close it.
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    expect(container.querySelector('.deck-publish-nudge')).toBeNull();
  });
});
