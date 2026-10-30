// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// The role bar waits on the tagger corpus, which loads after the list. It used
// to mount a beat later and push every row down: CLS 0.02 to 0.03 on /d/:id
// on phone and desktop (E1049). Until the corpus lands, the bar's row is held.

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/cards/use-tagger-ready', () => ({ useTaggerReady: () => false }));

function card(name: string, type_line: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line,
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

const slots = (cards: ScryfallCard[]): DeckDisplayCard[] =>
  cards.map((c, i) => ({ slotId: `slot-${c.name}-${i}`, card: c }));

function renderDeck(cards: DeckDisplayCard[]) {
  return render(
    <MemoryRouter>
      <DeckDisplay title="Roles" commander={null} format="commander" cards={cards} />
    </MemoryRouter>
  );
}

describe('DeckDisplay role bar while the tagger loads', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('holds the bar row with placeholder chips, hidden from assistive tech', () => {
    const { container } = renderDeck(
      slots([card('Cultivate', 'Sorcery'), card('Swords to Plowshares', 'Instant')])
    );
    const bar = container.querySelector('.deck-role-bar');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect(bar?.querySelectorAll('.filter-chip.deck-role-bar-chip--pending')).toHaveLength(4);
    // Nothing to press until the counts are real.
    expect(bar?.querySelector('button')).toBeNull();
  });

  it('reserves nothing for a deck with no cards', () => {
    const { container } = renderDeck([]);
    expect(container.querySelector('.deck-role-bar')).toBeNull();
  });
});
