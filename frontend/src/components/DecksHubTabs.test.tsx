// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { DecksHubTabs } from './DecksHubTabs';

function renderTabs() {
  return render(
    <MemoryRouter>
      <DecksHubTabs />
    </MemoryRouter>
  );
}

describe('DecksHubTabs', () => {
  it('hides the Saved pill for a guest — matching the Friends nav precedent', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderTabs();

    expect(screen.getByText('My Decks')).toBeTruthy();
    expect(screen.getByText('Discover')).toBeTruthy();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('shows the Saved pill, linking to /decks/saved, for an authed user', () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderTabs();

    const saved = screen.getByRole('link', { name: 'Saved' });
    expect(saved.getAttribute('href')).toBe('/decks/saved');
  });
});
