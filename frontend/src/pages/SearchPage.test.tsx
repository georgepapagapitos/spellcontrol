// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPage } from './SearchPage';

// The results block drags in the whole card-search stack (stores, carousel,
// scryfall client) — the syntax helper under test doesn't need any of it.
vi.mock('../components/InlineCardSearch', () => ({
  InlineCardSearch: () => <div data-testid="results" />,
}));

function renderPage(initialEntry = '/search') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SearchPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchPage syntax helper', () => {
  it('starts collapsed and toggles the cheatsheet panel', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /search syntax/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Card type')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Card type')).toBeTruthy();
    expect(screen.getByText('Negate any term')).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByText('Card type')).toBeNull();
  });

  it('persists the open state to localStorage', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    expect(window.localStorage.getItem('mtg-search-syntax-collapsed')).toBe('0');
  });

  it('inserts a tapped example into the empty query and focuses the input', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert t:dragon into the search' }));

    const input = screen.getByRole('textbox', { name: 'Search any card' });
    expect((input as HTMLInputElement).value).toBe('t:dragon');
    expect(document.activeElement).toBe(input);
  });

  it('appends a tapped example to an existing query with a space', () => {
    renderPage('/search?q=t%3Adragon');
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert r:mythic into the search' }));

    const input = screen.getByRole('textbox', { name: 'Search any card' });
    expect((input as HTMLInputElement).value).toBe('t:dragon r:mythic');
  });

  it('links to the full Scryfall syntax reference in a new tab', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    const link = screen.getByRole('link', { name: /full syntax reference/i });
    expect(link.getAttribute('href')).toBe('https://scryfall.com/docs/syntax');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('does not show "online" notes while searches are served live (no offline bundle)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    expect(screen.queryByText('online')).toBeNull();
  });
});
