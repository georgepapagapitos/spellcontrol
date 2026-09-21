// @vitest-environment happy-dom
/**
 * The audience gate's refusals are states of this page, not errors. A
 * signed-in stranger opening a friends-only share used to get "Something
 * went wrong" (playtest batch 11); nothing went wrong.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchPublicShareMock } = vi.hoisted(() => ({ fetchPublicShareMock: vi.fn() }));
vi.mock('../lib/share-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/share-client')>();
  return { ...real, fetchPublicShare: fetchPublicShareMock };
});

import { ShareAuthRequiredError, ShareForbiddenError } from '../lib/share-client';
import { SharedView } from './SharedView';

function renderShare() {
  return render(
    <MemoryRouter initialEntries={['/s/tok']}>
      <Routes>
        <Route path="/s/:token" element={<SharedView />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  fetchPublicShareMock.mockReset();
});

describe('SharedView — the friends gate', () => {
  it('a signed-in stranger (403) gets "Friends only" and a door to Friends, not "Something went wrong"', async () => {
    fetchPublicShareMock.mockRejectedValue(new ShareForbiddenError());
    renderShare();
    expect(await screen.findByRole('heading', { name: 'Friends only' })).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Friends' }).getAttribute('href')).toBe(
      '/friends'
    );
    // E344: the tab has to agree with the wall, not with the shell the page was
    // served as.
    expect(document.title).toBe('Friends only · SpellControl');
  });

  it('a guest (401) gets "Friends only" and a sign-in door that returns here', async () => {
    fetchPublicShareMock.mockRejectedValue(new ShareAuthRequiredError());
    renderShare();
    expect(await screen.findByRole('heading', { name: 'Friends only' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/auth?returnTo=%2Fs%2Ftok'
    );
    expect(document.title).toBe('Friends only · SpellControl');
  });
});
