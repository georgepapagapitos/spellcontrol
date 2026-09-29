// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAuth } from '../../store/auth';
import { useToastsStore } from '../../store/toasts';
import type { Profile } from '../../lib/auth-api';

const { updateProfileMock, fetchPublicProfileMock } = vi.hoisted(() => ({
  updateProfileMock: vi.fn(),
  fetchPublicProfileMock: vi.fn(),
}));
vi.mock('../../lib/auth-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/auth-api')>()),
  updateProfile: updateProfileMock,
}));
vi.mock('../../lib/profile-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/profile-client')>()),
  fetchPublicProfile: fetchPublicProfileMock,
}));

import { ProfileFeaturedSettings } from './ProfileFeaturedSettings';

const base: Profile = {
  displayName: null,
  bio: null,
  avatarCardId: null,
  avatarCardName: null,
  avatarImageUrl: null,
  pinnedDeckSlug: null,
  showGameRecord: false,
};

function deck(slug: string, name: string) {
  return { slug, name };
}

beforeEach(() => {
  updateProfileMock.mockReset();
  fetchPublicProfileMock.mockReset();
  useToastsStore.setState({ toasts: [] });
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: base,
  });
});

describe('ProfileFeaturedSettings', () => {
  it('saves the game-record switch and stores the returned profile', async () => {
    fetchPublicProfileMock.mockResolvedValue({ decks: [deck('a', 'Atraxa')] });
    updateProfileMock.mockResolvedValue({ ...base, showGameRecord: true });
    render(<ProfileFeaturedSettings />);
    const sw = screen.getByRole('switch', { name: 'Show my game record on my profile' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledWith({ showGameRecord: true }));
    await waitFor(() => expect(useAuth.getState().profile?.showGameRecord).toBe(true));
  });

  it('pins a deck from the owner’s public decks', async () => {
    fetchPublicProfileMock.mockResolvedValue({
      decks: [deck('a', 'Atraxa'), deck('b', 'Korvold')],
    });
    updateProfileMock.mockResolvedValue({ ...base, pinnedDeckSlug: 'b' });
    render(<ProfileFeaturedSettings />);
    const trigger = screen.getByRole('button', { name: 'Pinned deck' });
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'Korvold' }));
    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledWith({ pinnedDeckSlug: 'b' }));
  });

  it('says so when there are no public decks to pin', async () => {
    fetchPublicProfileMock.mockResolvedValue({ decks: [] });
    render(<ProfileFeaturedSettings />);
    expect(await screen.findByText('Publish a deck and you can pin it here.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Pinned deck' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('toasts and leaves the switch alone when the save fails', async () => {
    fetchPublicProfileMock.mockResolvedValue({ decks: [] });
    updateProfileMock.mockRejectedValue(new Error('Pin one of your own public decks.'));
    render(<ProfileFeaturedSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show my game record on my profile' }));
    await waitFor(() =>
      expect(useToastsStore.getState().toasts[0]?.message).toBe('Pin one of your own public decks.')
    );
    expect(
      screen
        .getByRole('switch', { name: 'Show my game record on my profile' })
        .getAttribute('aria-checked')
    ).toBe('false');
  });
});
