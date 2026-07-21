// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

// Hermetic art resolution — always "resolved" so the caption branch renders
// deterministically regardless of which pool card today's day-key picks.
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => 'https://example.com/art.jpg' }));

import { WelcomeHero } from './WelcomeHero';
import { hasEverVisited } from '../../lib/first-run';

function renderHero() {
  return render(
    <MemoryRouter>
      <WelcomeHero />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  navigateMock.mockReset();
});

describe('WelcomeHero', () => {
  it('renders as a header landmark with the brand mark, wordmark, and headline', () => {
    renderHero();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByText('SpellControl')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: /plan your magic collection/i })
    ).toBeTruthy();
  });

  it('renders a labeled Discover-scoped search', () => {
    renderHero();
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /search public decks by commander/i })).toBeTruthy();
  });

  it('submits the search to /decks/discover with the commander query', () => {
    renderHero();
    fireEvent.change(screen.getByRole('textbox', { name: /search public decks by commander/i }), {
      target: { value: 'Atraxa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(navigateMock).toHaveBeenCalledWith('/decks/discover?commander=Atraxa');
  });

  it('submits to plain /decks/discover when the search is empty', () => {
    renderHero();
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(navigateMock).toHaveBeenCalledWith('/decks/discover');
  });

  it('has a primary Import CTA to /collection?add=list that marks ever-visited on click', () => {
    renderHero();
    const importLink = screen.getByRole('link', { name: /import your collection/i });
    expect(importLink.getAttribute('href')).toBe('/collection?add=list');
    expect(hasEverVisited()).toBe(false);
    fireEvent.click(importLink);
    expect(hasEverVisited()).toBe(true);
  });

  it('has a secondary Browse public decks CTA to /decks/discover', () => {
    renderHero();
    const browseLink = screen.getByRole('link', { name: /browse public decks/i });
    expect(browseLink.getAttribute('href')).toBe('/decks/discover');
  });

  it('shows an art caption crediting Scryfall once art resolves', () => {
    renderHero();
    expect(screen.getByText(/— art via Scryfall/)).toBeTruthy();
  });
});
