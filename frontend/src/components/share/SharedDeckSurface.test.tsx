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
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '../../store/auth';
import type { PublicDeck, PublicDeckCard } from '../../lib/shared-types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { SharedDeckSurface } from './SharedDeckSurface';

/** A full BracketEstimation fixture — the Bracket panel's BracketBreakdown
 *  reads `breakdown` directly (no fallback for an absent object), so a test
 *  that opens the Power tab needs the whole shape, not just `bracket`. */
function estimation(bracket: number): BracketEstimation {
  return {
    bracket: bracket as 1 | 2 | 3 | 4 | 5,
    label: 'Core',
    hardFloors: [],
    softScore: 20,
    breakdown: {
      gameChangerCount: 0,
      gameChangerNames: [],
      massLandDenialCount: 0,
      massLandDenialNames: [],
      extraTurnCount: 0,
      extraTurnNames: [],
      twoCardComboCount: 0,
      multiCardComboCount: 0,
      fastManaCount: 0,
      fastManaNames: [],
      tutorCount: 0,
      tutorNames: [],
      staxPieceCount: 0,
      staxPieceNames: [],
      averageCmc: 3,
      interactionCount: 5,
    },
  } as BracketEstimation;
}

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

function signInAs(username: string | null) {
  useAuth.setState({
    user: username ? { id: 'u1', username, role: 'user' } : null,
    status: username ? 'authed' : 'guest',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
}

describe('SharedDeckSurface', () => {
  afterEach(() => signInAs(null));

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

  it('never claims cards are missing from a collection it cannot see', () => {
    // Shipped broken in #1913: every slot on a public deck has a null
    // allocatedCopyId, so DeckDisplay's missing-count counted the WHOLE deck
    // and rendered "N missing ($X)" — nonsense to a guest with no collection,
    // and a second, contradictory number next to the ownership-lens strip for
    // a signed-in visitor. Guarded at the root in DeckDisplay: no collection
    // supplied, no missing claim.
    renderSurface();
    expect(document.querySelector('.deck-stat-missing')).toBeNull();
  });

  it('gives the owner a way back to editing their own published deck', () => {
    // The owner sees the VISITOR's view on purpose — it's the only way to see
    // what you actually published — so this link is the only route back to
    // editing. Without it the owner is stranded on a read-only page.
    signInAs('alice'); // makeDeck()'s ownerUsername
    renderSurface();
    const edit = screen.getByRole('link', { name: /Edit this deck/i });
    expect(edit.getAttribute('href')).toBe('/decks/deck-1');
  });

  it('offers no edit link to someone else looking at the deck', () => {
    signInAs('bob');
    renderSurface();
    expect(screen.queryByRole('link', { name: /Edit this deck/i })).toBeNull();
  });

  it('offers no edit link to a signed-out guest', () => {
    renderSurface();
    expect(screen.queryByRole('link', { name: /Edit this deck/i })).toBeNull();
  });

  it('offers no playtest entry for a deck with nothing to draw', () => {
    renderSurface(makeDeck({ cards: [], sideboard: [] }));
    expect(screen.queryByRole('link', { name: /Playtest this deck/i })).toBeNull();
  });

  it('puts the stats under the list, with no tab bar when there is no Power', () => {
    renderSurface();
    // Stats are a section of the Deck view, the way deck sites lay a deck out.
    expect(screen.getByRole('heading', { name: 'Deck stats' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Stats' })).toBeNull();
    // An empty Power tab is worse than no Power tab, and a lone Deck tab is
    // not a choice, so there is no bar at all.
    expect(screen.queryByRole('tablist', { name: 'Deck views' })).toBeNull();
  });

  it('shows Power once the payload carries analysis to put in it', () => {
    renderSurface(
      makeDeck({
        commander: { name: 'Atraxa, Praetors’ Voice', type_line: 'Legendary Creature' },
        bracketEstimation: { bracket: 3, hardFloors: [] },
      })
    );
    expect(screen.getByRole('tab', { name: 'Deck' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Power' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Stats' })).toBeNull();
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

  it('wears the same hero the owner\u2019s deck page does', () => {
    // The visitor used to get a plain caption + title block while the owner got
    // the art-backed hero with the format/commander/count meta line \u2014 the same
    // deck dressed as two different products. Pinned by structure, not by CSS.
    renderSurface(
      makeDeck({
        commander: {
          name: 'Atraxa, Praetors\u2019 Voice',
          type_line: 'Legendary Creature',
          image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/atraxa.jpg' },
        } as PublicDeck['commander'],
      })
    );
    const hero = document.querySelector('.deck-editor-hero');
    expect(hero).toBeTruthy();
    expect(hero!.querySelector('.deck-editor-hero-art')).toBeTruthy();
    const meta = hero!.querySelector('.binder-hero-meta')!.textContent ?? '';
    expect(meta).toContain('Commander');
    // The commander is the art and the command zone's first row, so the meta
    // line doesn't say it a third time (§ Layout system: one fact, one place).
    expect(meta).not.toContain('Atraxa');
    // 2 cards + the commander.
    expect(meta).toContain('3');
    // The byline stays, inside the hero rather than shouted above the title.
    expect(hero!.querySelector('.shared-view-owner')).toBeTruthy();
  });

  it('puts taking the deck next to playing it', () => {
    // "You can't edit my deck, but you can duplicate it" \u2014 so the copy sits in
    // the hero actions beside Playtest, not only as a footnote under the list.
    signInAs('bob');
    renderSurface();
    expect(screen.getByRole('button', { name: /Copy to my decks/i })).toBeTruthy();
  });

  it('gives the owner Edit in that slot instead of a copy of their own deck', () => {
    signInAs('alice');
    renderSurface();
    expect(screen.queryByRole('button', { name: /Copy to my decks/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Edit this deck/i })).toBeTruthy();
  });

  it('carries the estimate alongside a stated bracket that differs, in the hero and the Power hero (2026-09-24 ruling)', () => {
    renderSurface(
      makeDeck({
        commander: { name: 'Atraxa, Praetors’ Voice', type_line: 'Legendary Creature' },
        bracketOverride: 2,
        bracketEstimation: estimation(4),
      })
    );
    const hero = document.querySelector('.deck-editor-hero')!;
    expect(hero.querySelector('.deck-hero-bracket')?.textContent).toContain('Bracket 2 · est. 4');
    // PowerHero's own secondary line, same rule as the owner's deck page —
    // only rendered once the Power tab is active.
    fireEvent.click(screen.getByRole('tab', { name: 'Power' }));
    expect(screen.getByText(/Estimate: Bracket 4/)).toBeTruthy();
  });

  it('shows only the stated bracket, no estimate line, when it matches the estimate', () => {
    renderSurface(
      makeDeck({
        commander: { name: 'Atraxa, Praetors’ Voice', type_line: 'Legendary Creature' },
        bracketOverride: 3,
        bracketEstimation: estimation(3),
      })
    );
    const hero = document.querySelector('.deck-editor-hero')!;
    expect(hero.querySelector('.deck-hero-bracket')?.textContent).toContain('Bracket 3');
    expect(hero.querySelector('.deck-hero-bracket')?.textContent).not.toContain('est.');
    fireEvent.click(screen.getByRole('tab', { name: 'Power' }));
    expect(screen.queryByText(/Estimate:/)).toBeNull();
  });
});
