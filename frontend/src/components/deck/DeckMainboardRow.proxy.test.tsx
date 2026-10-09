// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';
import { useCurrencyStore } from '@/lib/collection/currency';

// A proxy says "proxy" beside the name, at rest, in every column width. It
// used to be a hover-only chip, then a dashed box on the count, and neither
// read as a proxy (style-guide/decks.md § Proxy slots).
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

const dryad = {
  id: 'sf-dryad',
  oracle_id: 'o-dryad',
  name: 'Dryad of the Ilysian Grove',
  mana_cost: '{2}{G}',
  cmc: 3,
  type_line: 'Enchantment Creature — Nymph Dryad',
  color_identity: ['G'],
  keywords: [],
  rarity: 'mythic',
  set: 'thb',
  collector_number: '169',
  set_name: 'Theros Beyond Death',
  prices: { usd: '9.40' },
  legalities: {},
} as unknown as ScryfallCard;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mtg-decks-view-mode', 'list');
  useCurrencyStore.setState({ currency: 'USD' });
});

function renderDeck(cards: DeckDisplayCard[]) {
  render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        format="standard"
        cards={cards}
        onSetQty={vi.fn()}
      />
    </MemoryRouter>
  );
}

const tag = () => document.querySelector('.deck-row-proxy-tag');

describe('a proxy row in the deck list', () => {
  it('says proxy beside the name, outside the hover-gated cluster, and the count is not red', () => {
    renderDeck([{ slotId: 's1', card: dryad, allocatedCopyId: null, proxy: true }]);
    expect(tag()?.textContent).toBe('proxy');
    expect(tag()?.closest('.deck-row-hovermeta')).toBeNull();
    expect(tag()?.getAttribute('title')).toBe('Played as a proxy');
    expect(document.querySelector('.deck-row-qty-missing')).toBeNull();
  });

  it('counts the proxies on a stack that also needs a copy', () => {
    renderDeck([
      { slotId: 's1', card: dryad, allocatedCopyId: null, proxy: true },
      { slotId: 's2', card: dryad, allocatedCopyId: null },
    ]);
    expect(tag()?.textContent).toBe('1 proxy');
  });

  it('says nothing on a row with no proxy', () => {
    renderDeck([{ slotId: 's1', card: dryad, allocatedCopyId: null }]);
    expect(tag()).toBeNull();
  });
});
