// @vitest-environment happy-dom
/**
 * SharedDeckSurface — the read-only contract.
 *
 * This surface renders the OWNER's `DeckDisplay`, so the thing worth pinning
 * is not that the cards show up (they do, it's the same component the deck
 * editor ships) but that NONE of the editing affordances come along with it.
 * Every one of them is gated on a handler prop being absent, which is exactly
 * the kind of thing a later refactor breaks silently: pass one handler through
 * by reflex and a stranger gets a Remove button on someone else's deck.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { PublicDeck, PublicDeckCard } from '../../lib/shared-types';
import { SharedDeckSurface } from './SharedDeckSurface';

function card(name: string, typeLine = 'Creature — Human'): PublicDeckCard {
  return { card: { name, type_line: typeLine, cmc: 2 } };
}

function makeDeck(overrides: Partial<PublicDeck> = {}): PublicDeck {
  return {
    ownerUsername: 'alice',
    ownerDisplayName: null,
    id: 'deck-1',
    name: 'Atraxa Superfriends',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    cards: [card('Sol Ring', 'Artifact'), card('Llanowar Elves')],
    sideboard: [],
    color: '#4477aa',
    ...overrides,
  };
}

function renderSurface(deck: PublicDeck = makeDeck()) {
  return render(
    <MemoryRouter>
      <SharedDeckSurface data={deck} sourceKey="atraxa-superfriends" />
    </MemoryRouter>
  );
}

describe('SharedDeckSurface', () => {
  it('renders the deck through the real deck display', () => {
    renderSurface();
    // The name is the page heading. DeckDisplay's toolbar also carries it in
    // the DOM, but `.deck-toolbar-title` is display:none there for exactly
    // this reason (the page header already says it) — so scope to the heading
    // rather than loosening the assertion.
    expect(screen.getByRole('heading', { name: 'Atraxa Superfriends' })).toBeTruthy();
    // Card names appear in the list AND in DeckDisplay's print-only checklist
    // (`.print-list`, hidden on screen), so assert presence, not uniqueness.
    expect(screen.getAllByText('Sol Ring').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Llanowar Elves').length).toBeGreaterThan(0);
    expect(screen.getByText(/Shared by/)).toBeTruthy();
  });

  it('exposes no editing affordance anywhere on the page', () => {
    renderSurface();
    // Each of these exists on the owner's deck page and is gated purely on a
    // handler prop this surface never passes.
    for (const name of [/^Remove/i, /^Add cards$/i, /^Delete/i, /Move to sideboard/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // The qty cell is a plain chip here, never the click-to-edit input.
    expect(document.querySelector('.deck-row-qty-edit')).toBeNull();
    expect(document.querySelector('.deck-row-qty-input')).toBeNull();
  });

  it('offers a playtest entry for a deck with cards', () => {
    renderSurface();
    const link = screen.getByRole('link', { name: /Playtest this deck/i });
    expect(link.getAttribute('href')).toBe('/s/atraxa-superfriends/playtest');
  });

  it('keeps Copy available — DeckDisplay does not bring it along', () => {
    // Copy is the conversion action on a shared deck, and the one thing the
    // owner's component has no equivalent of. The swap to DeckDisplay dropped
    // it once already, which is why this is pinned.
    renderSurface();
    expect(screen.getByText('Copy this deck')).toBeTruthy();
  });

  it('drops Copy for a cardless deck — nothing to take', () => {
    renderSurface(makeDeck({ cards: [], sideboard: [] }));
    expect(screen.queryByText('Copy this deck')).toBeNull();
  });

  it('offers no playtest entry for a deck with nothing to draw', () => {
    renderSurface(makeDeck({ cards: [], sideboard: [] }));
    expect(screen.queryByRole('link', { name: /Playtest this deck/i })).toBeNull();
  });

  it('shows Deck and Stats, and hides Power on a deck nobody has analyzed', () => {
    renderSurface();
    expect(screen.getByRole('tab', { name: 'Deck' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Stats' })).toBeTruthy();
    // An empty Power tab is worse than no Power tab.
    expect(screen.queryByRole('tab', { name: 'Power' })).toBeNull();
  });

  it('shows Power once the payload carries analysis to put in it', () => {
    renderSurface(
      makeDeck({
        commander: { name: 'Atraxa, Praetors’ Voice', type_line: 'Legendary Creature' },
        bracketEstimation: { bracket: 3, hardFloors: [] },
      })
    );
    expect(screen.getByRole('tab', { name: 'Power' })).toBeTruthy();
  });

  it('links the owner to their profile only on the public page', () => {
    // /s/:token is a private link — it carries no profile affordance, matching
    // the pre-existing publicMeta gate.
    renderSurface();
    expect(screen.queryByRole('link', { name: /view profile/i })).toBeNull();

    render(
      <MemoryRouter>
        <SharedDeckSurface
          data={makeDeck()}
          sourceKey="atraxa-superfriends"
          publicMeta={{
            slug: 'atraxa-superfriends',
            deckId: 'deck-1',
            viewCount: 0,
            copyCount: 0,
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getAllByRole('link', { name: /view profile/i }).length).toBeGreaterThan(0);
  });

  it('hides view and copy counts below the ghost-town floor', () => {
    render(
      <MemoryRouter>
        <SharedDeckSurface
          data={makeDeck()}
          sourceKey="s"
          publicMeta={{ slug: 's', deckId: 'deck-1', viewCount: 4, copyCount: 1 }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText(/views/)).toBeNull();
    expect(screen.queryByText(/copies/)).toBeNull();
    // Report stays reachable regardless of how quiet the deck is.
    expect(screen.getByRole('button', { name: 'Report this deck' })).toBeTruthy();
  });
});
