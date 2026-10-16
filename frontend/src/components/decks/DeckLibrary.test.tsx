// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeckLibrary, type LibraryDeck } from './DeckLibrary';

function deck(over: Partial<LibraryDeck> & { id: string; name: string }): LibraryDeck {
  return {
    href: `/d/${over.id}`,
    format: 'commander',
    commanderName: null,
    commanderImage: null,
    colorIdentity: [],
    bracket: null,
    updatedAt: 1,
    ...over,
  };
}

function renderLibrary(decks: LibraryDeck[]) {
  return render(
    <MemoryRouter>
      <DeckLibrary
        decks={decks}
        ariaLabel="their decks"
        emptyTagline="No decks yet."
        emptyHint="Nothing to browse."
      />
    </MemoryRouter>
  );
}

function tileNames(): string[] {
  return within(screen.getByRole('list', { name: 'their decks' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.decks-index-card-name')?.textContent ?? '');
}

describe('DeckLibrary search', () => {
  it('matches on COMMANDER as well as deck name, from one field', () => {
    // "search by commander" is the whole ask. Discover solves it with a
    // platform-wide typeahead; finding one deck on one person's shelf is a
    // different problem, so the single box has to cover both.
    renderLibrary([
      deck({ id: 'a', name: 'Goblin Pile', commanderName: 'Krenko, Mob Boss' }),
      deck({ id: 'b', name: 'Krenko Tribal', commanderName: 'Purphoros, God of the Forge' }),
      deck({ id: 'c', name: 'Flicker', commanderName: 'Brago, King Eternal' }),
    ]);

    fireEvent.change(screen.getByRole('textbox', { name: /search their decks/i }), {
      target: { value: 'krenko' },
    });

    // Both the deck NAMED Krenko and the deck LED BY Krenko.
    expect(tileNames().sort()).toEqual(['Goblin Pile', 'Krenko Tribal']);
  });

  it('offers a clear action and restores the full shelf', () => {
    renderLibrary([deck({ id: 'a', name: 'Alpha' }), deck({ id: 'b', name: 'Beta' })]);
    fireEvent.change(screen.getByRole('textbox', { name: /search their decks/i }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/no decks match/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(tileNames().sort()).toEqual(['Alpha', 'Beta']);
  });
});

describe('DeckLibrary sort', () => {
  it('sorts a deck with NO bracket last in both directions, never as a zero', () => {
    // The app's standing rule for unknown sort values. Treating null as 0
    // would park every un-estimated deck at the "lowest bracket" end.
    renderLibrary([
      deck({ id: 'none', name: 'Unrated', bracket: null }),
      deck({ id: 'b4', name: 'High', bracket: 4 }),
      deck({ id: 'b2', name: 'Low', bracket: 2 }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('option', { name: /bracket/i }));
    expect(tileNames()).toEqual(['Low', 'High', 'Unrated']);

    // The menu deliberately stays open after a pick, so Reverse — SortMenu's
    // documented direction affordance — is right there; re-picking the field
    // is not how a user flips direction.
    fireEvent.click(screen.getByRole('button', { name: /reverse sort order/i }));
    // The rated decks flip; the unrated one stays at the bottom.
    expect(tileNames()).toEqual(['High', 'Low', 'Unrated']);
  });

  it('sorts by price, cheapest first, with an unpriced deck last both ways', () => {
    renderLibrary([
      deck({ id: 'none', name: 'Unpriced', estimatedValueUsd: null }),
      deck({ id: 'hi', name: 'Pricey', estimatedValueUsd: 812.4 }),
      deck({ id: 'lo', name: 'Budget', estimatedValueUsd: 48 }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('option', { name: /price/i }));
    expect(tileNames()).toEqual(['Budget', 'Pricey', 'Unpriced']);

    fireEvent.click(screen.getByRole('button', { name: /reverse sort order/i }));
    expect(tileNames()).toEqual(['Pricey', 'Budget', 'Unpriced']);
  });

  it('shows the price on the tile and in its name, and nothing for an unpriced deck', () => {
    const { container } = renderLibrary([
      deck({ id: 'hi', name: 'Pricey', estimatedValueUsd: 812.4 }),
      deck({ id: 'none', name: 'Unpriced', estimatedValueUsd: null }),
    ]);
    const prices = container.querySelectorAll('.deck-library-tile-price');
    expect(prices).toHaveLength(1);
    expect(prices[0].textContent).toBe('$812');
    expect(screen.getByRole('link', { name: /^Pricey/ }).getAttribute('aria-label')).toContain(
      '$812'
    );
  });
});

describe('DeckLibrary tile', () => {
  it('badges a friends-only deck and links it by its share token, not a slug', () => {
    // A friends-rung deck has no slug and never will — hence `href`.
    renderLibrary([
      deck({
        id: 'f',
        name: 'Secret Brew',
        href: '/s/tok123',
        badge: 'Friends only',
        commanderName: 'Yuriko',
      }),
    ]);
    expect(screen.getByText('Friends only')).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/s/tok123');
    // Everything the tile shows reaches the accessible name.
    expect(link.getAttribute('aria-label')).toMatch(/Secret Brew.*Yuriko.*Friends only/);
  });

  it('omits the stats overlay when the surface has no publication stats', () => {
    // A friend's library has no view/copy counts — half its decks were never
    // published. The line goes entirely rather than rendering an empty plate.
    const { container } = renderLibrary([deck({ id: 'a', name: 'Plain', statsLine: null })]);
    expect(container.querySelector('.public-profile-tile-banner-stats')).toBeNull();
  });

  it('renders the stats overlay, and its content, when the surface does have them', () => {
    const { container } = renderLibrary([
      deck({ id: 'a', name: 'Popular', statsLine: '12 views · 3 copies · 2 days ago' }),
    ]);
    expect(container.querySelector('.public-profile-tile-banner-stats')?.textContent).toContain(
      '12 views'
    );
    // aria-hidden on the art, so it must also reach the accessible name.
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain('12 views');
  });

  it('carries the estimate on the bracket badge and the accessible name when it differs (2026-09-24 ruling)', () => {
    const { container } = renderLibrary([
      deck({ id: 'a', name: 'Sandbagged', bracket: 2, estimatedBracket: 4 }),
    ]);
    expect(container.querySelector('.deck-bracket-badge')?.textContent).toBe('B2 · est. B4');
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain(
      'Bracket 2 stated, estimate 4'
    );
  });

  it('omits the estimate from the badge when it equals the stated bracket', () => {
    const { container } = renderLibrary([
      deck({ id: 'a', name: 'Auto', bracket: 4, estimatedBracket: 4 }),
    ]);
    expect(container.querySelector('.deck-bracket-badge')?.textContent).toBe('B4 · Optimized');
  });

  it('leads the bracket badge with its number, so a bracket sort shows its key', () => {
    const { container } = renderLibrary([deck({ id: 'a', name: 'Mid', bracket: 3 })]);
    expect(container.querySelector('.deck-bracket-badge')?.textContent).toBe('B3 · Upgraded');
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain('Bracket 3 · Upgraded');
  });
});

describe('DeckLibrary format chip', () => {
  it('drops the format chip when every deck shares one format, but keeps it in the name', () => {
    const { container } = renderLibrary([
      deck({ id: 'a', name: 'One' }),
      deck({ id: 'b', name: 'Two' }),
    ]);
    expect(container.querySelector('.deck-format-badge')).toBeNull();
    expect(screen.getAllByRole('link')[0].getAttribute('aria-label')).toContain('Commander');
  });

  it('shows the format chip on every tile when the shelf mixes formats', () => {
    const { container } = renderLibrary([
      deck({ id: 'a', name: 'One' }),
      deck({ id: 'b', name: 'Two', format: 'standard' }),
    ]);
    expect(container.querySelectorAll('.deck-format-badge')).toHaveLength(2);
  });
});
