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

import { HomePage } from './HomePage';

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

describe('HomePage', () => {
  it('renders the heading with no card content mounted yet', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
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
