// @vitest-environment happy-dom
/**
 * The public profile's brand-bar action: strangers get Report; the owner
 * gets the way back to the editor on /you (the other half of the Profile
 * card's "public profile" link).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '../lib/profile-client';

const { fetchPublicProfileMock } = vi.hoisted(() => ({ fetchPublicProfileMock: vi.fn() }));
vi.mock('../lib/profile-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/profile-client')>();
  return { ...real, fetchPublicProfile: fetchPublicProfileMock };
});
vi.mock('../lib/use-panel-cascade', () => ({
  usePanelCascade: () => null,
  panelCascadeClass: () => '',
}));

import { PublicProfilePage } from './PublicProfilePage';

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    username: 'alice',
    displayName: null,
    bio: null,
    avatarCardName: null,
    avatarImageUrl: null,
    joinedAt: Date.UTC(2025, 0, 1),
    isOwner: false,
    moderationHidden: false,
    deckCount: 0,
    decks: [],
    ...overrides,
  };
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/u/alice']}>
      <Routes>
        <Route path="/u/:username" element={<PublicProfilePage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  fetchPublicProfileMock.mockReset();
});

describe('PublicProfilePage — brand-bar action', () => {
  it('offers Report to a stranger', async () => {
    fetchPublicProfileMock.mockResolvedValue(profile());
    renderProfile();
    expect(await screen.findByRole('button', { name: 'Report this profile' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit profile' })).toBeNull();
  });

  it('offers the owner "Edit profile" to the Profile card on /you, not Report', async () => {
    fetchPublicProfileMock.mockResolvedValue(profile({ isOwner: true }));
    renderProfile();
    const edit = await screen.findByRole('link', { name: 'Edit profile' });
    expect(edit.getAttribute('href')).toBe('/you?section=profile');
    expect(screen.queryByRole('button', { name: 'Report this profile' })).toBeNull();
  });
});
