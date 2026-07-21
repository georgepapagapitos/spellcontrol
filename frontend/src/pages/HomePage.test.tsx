// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Stub AddCardsSheet so opening it doesn't mount the full modal stack
// (CardScanner, UploadPanel, etc.) — mirrors CollectionPage.test.tsx.
vi.mock('../components/AddCardsSheet', () => ({
  AddCardsSheet: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="add-cards-sheet">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// The three bento cards each fetch on mount — stubbed so this suite stays
// hermetic and only exercises HomePage's own composition, not each card's
// own branching (covered by ActivityStripCard/NewFromFriendsCard/
// DiscoverCard's own test files).
vi.mock('../lib/use-activity', () => ({
  useActivity: () => ({ count: 0, actionRequired: [], recent: [], loading: false }),
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: { status: string }) => unknown) => selector({ status: 'authed' }),
}));
vi.mock('../lib/friends-client', () => ({
  getFriendsActivity: () => Promise.resolve([]),
}));
vi.mock('../lib/discover-client', () => ({
  listDiscoverDecks: () => Promise.resolve({ decks: [], page: 1, hasMore: false }),
}));

import { HomePage } from './HomePage';

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

describe('HomePage', () => {
  it('renders the heading and all three social cards', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'New from friends' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Discover' })).toBeTruthy();
    expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
  });

  it('renders Quick Actions with the correct link targets', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /New deck/i }).getAttribute('href')).toBe('/decks/new');
    expect(screen.getByRole('link', { name: /Plan a game night/i }).getAttribute('href')).toBe(
      '/play?tab=nights'
    );
    expect(screen.getByRole('button', { name: /Import cards/i })).toBeTruthy();
  });

  it('opens AddCardsSheet when "Import cards" is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Import cards/i }));
    expect(screen.getByTestId('add-cards-sheet')).toBeTruthy();
  });

  it('closes AddCardsSheet via its onClose callback', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Import cards/i }));
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
  });
});
