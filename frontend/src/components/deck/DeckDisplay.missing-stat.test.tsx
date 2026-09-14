// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

/**
 * "N missing ($X)" is a claim about the VIEWER's collection, so DeckDisplay may
 * only make it when a collection was actually supplied.
 *
 * Shipped broken in #1913 (the unified deck view): a shared/public deck hands
 * DeckDisplay slots with `allocatedCopyId: null` and no `collectionByCopyId`,
 * so every slot classified as unallocated and the deck reported its own full
 * card count as missing — "3 missing ($0.05)" on a three-card deck, to a guest
 * with no collection at all. For a signed-in visitor it was worse: a second
 * number contradicting the ownership-lens strip directly above it.
 *
 * The guard lives here rather than on the share surface because every caller
 * routes through this memo — a read-only deck view anywhere else would have
 * inherited the same bug.
 */

let idSeq = 0;
function mkCard(over: Partial<ScryfallCard> = {}): ScryfallCard {
  idSeq += 1;
  return {
    id: `sf-${idSeq}`,
    oracle_id: `o-${idSeq}`,
    name: `Card ${idSeq}`,
    mana_cost: '{1}',
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'uncommon',
    set: 'tst',
    set_name: 'Test Set',
    prices: { usd: '3.20' },
    ...over,
  } as ScryfallCard;
}

function renderDeck(cards: DeckDisplayCard[], collection?: Map<string, EnrichedCard>) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        cards={cards}
        collectionByCopyId={collection}
      />
    </MemoryRouter>
  );
}

describe('DeckDisplay missing-count', () => {
  const cards: DeckDisplayCard[] = [
    { slotId: 's1', card: mkCard(), allocatedCopyId: null },
    { slotId: 's2', card: mkCard(), allocatedCopyId: null },
  ];

  it('makes no missing claim when no collection was supplied', () => {
    renderDeck(cards);
    expect(document.querySelector('.deck-stat-missing')).toBeNull();
  });

  it('still reports everything missing for an owner whose collection is empty', () => {
    // An owner with a genuinely empty collection DOES own none of it — the
    // guard must key on "was a collection supplied", not "is it non-empty",
    // or this real case silently loses its buy list.
    renderDeck(cards, new Map());
    const stat = document.querySelector('.deck-stat-missing');
    expect(stat).not.toBeNull();
    expect(stat?.textContent).toContain('2');
  });
});
