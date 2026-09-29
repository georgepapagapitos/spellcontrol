// @vitest-environment happy-dom
/**
 * E457: the deck editor's add panel keeps its own engine (zones, fit,
 * legality, deck-specific adds) but its rows now render CardSearchResults'
 * own list-row markup — the `inline-card-search-*` classes from
 * `styles/binder-card-management.css` — instead of a lookalike of its own.
 * This guards against a re-fork: if a future edit reintroduces the retired
 * `.card-search-row`/`.card-search-add`/`.card-search-thumb`/`.card-search-name`
 * row shell, or drops a deck-fit signal onto the thumbnail's own preview
 * trigger instead of the shared trailing meta slot, this fails.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('@/lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('@/lib/discover/aggregates-client', () => ({ getCommanderStats: () => Promise.resolve(null) }));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: () => Promise.resolve({ data: [] }),
  getCardByNameResilient: () => Promise.resolve(null),
}));

function card(name: string): EnrichedCard {
  return {
    id: name,
    name,
    quantity: 1,
    colorIdentity: ['R'],
    legalities: { commander: 'legal' },
  } as unknown as EnrichedCard;
}

function renderPanel() {
  const r = render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={['R']}
      existingCardCounts={new Map([['Lightning Bolt', 2]])}
      atCopyLimit={() => false}
      onAdd={() => {}}
      onClose={() => {}}
      addZone="main"
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
  return r;
}

describe("CardSearchPanel — shares CardSearchResults' row markup (E457)", () => {
  beforeEach(() => {
    useCollectionStore.setState({ cards: [card('Lightning Bolt'), card('Ancient Tomb')] });
  });

  it('renders rows with the shared inline-card-search-* shell, not a forked one', () => {
    renderPanel();
    const items = document.querySelectorAll('.inline-card-search-item');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.querySelector('.inline-card-search-row')).toBeTruthy();
      expect(item.querySelector('.inline-card-search-add')).toBeTruthy();
      expect(item.querySelector('.inline-card-search-preview-trigger')).toBeTruthy();
      expect(item.querySelector('.inline-card-search-thumb')).toBeTruthy();
      expect(item.querySelector('.inline-card-search-name')).toBeTruthy();
      expect(
        item.querySelector('.inline-card-search-trailing .inline-card-search-meta')
      ).toBeTruthy();
    }
    // The retired row shell — a lookalike duplicate of the shared one — never
    // comes back.
    expect(document.querySelector('.card-search-row')).toBeNull();
    expect(document.querySelector('.card-search-thumb')).toBeNull();
    expect(document.querySelector('.card-search-add')).toBeNull();
  });

  it('keeps every deck-fit signal in the trailing meta slot, never on the thumbnail', () => {
    renderPanel();
    const row = screen.getByText('Lightning Bolt').closest('.inline-card-search-item');
    expect(row).toBeTruthy();
    const trigger = row?.querySelector('.inline-card-search-preview-trigger');
    const meta = row?.querySelector('.inline-card-search-meta');
    // "owned N" and "in deck × N" (this deck-specific panel's signals) render
    // in the meta slot, the same slot the collection-wide search fills with
    // "You own N" / "Added ×N" (E453).
    expect(meta?.textContent).toMatch(/owned/);
    expect(meta?.textContent).toContain('in deck');
    // ...and never inside the thumbnail's own preview trigger button — a
    // search result tile carries nothing on its art (E453).
    expect(trigger?.textContent).not.toContain('in deck');
    expect(trigger?.querySelector('.card-search-indeck')).toBeNull();
  });
});
