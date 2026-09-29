// @vitest-environment happy-dom
/**
 * Pasting a Scryfall card link into Add cards shows exactly that printing,
 * addable with the normal +. It is the phone's stand-in for dragging a card
 * off scryfall.com onto the deck editor (which a phone can't do between apps).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('@/lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('@/lib/discover/aggregates-client', () => ({ getCommanderStats: () => Promise.resolve(null) }));

const SOL_RING_ID = '6d5537da-112e-4ea8-9e4e-8a5ec1a8b2c4';
const SOL_RING = {
  id: SOL_RING_ID,
  oracle_id: 'o-sol',
  name: 'Sol Ring',
  set: 'cmm',
  collector_number: '396',
  color_identity: [],
  type_line: 'Artifact',
  cmc: 1,
  legalities: { commander: 'legal' },
} as unknown as ScryfallCard;

const lookup = vi.hoisted(() => ({
  getCardsByRefs: vi.fn(),
  searchCards: vi.fn(),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: lookup.searchCards,
  getCardByNameResilient: () => Promise.resolve(null),
  getCardsByRefs: lookup.getCardsByRefs,
}));

function renderPanel(onAdd = vi.fn()) {
  render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={[]}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={onAdd}
      onClose={() => {}}
    />
  );
  return onAdd;
}

async function typeQuery(q: string) {
  fireEvent.change(screen.getByLabelText(/^Search (your collection|Scryfall)$/), {
    target: { value: q },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

describe('CardSearchPanel: a pasted Scryfall link', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCollectionStore.setState({ cards: [] });
    lookup.getCardsByRefs.mockReset();
    lookup.searchCards.mockReset();
    lookup.searchCards.mockResolvedValue({ data: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('jumps to the Scryfall tab and shows that one printing, addable with +', async () => {
    lookup.getCardsByRefs.mockResolvedValue({ cards: [SOL_RING], error: null });
    const onAdd = renderPanel();
    // Opens on Collection (no suggestions): the paste moves it to Scryfall.
    await typeQuery('https://scryfall.com/card/cmm/396/sol-ring');

    expect(screen.getByRole('tab', { name: /Scryfall/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(lookup.getCardsByRefs).toHaveBeenCalledWith([{ set: 'cmm', number: '396' }]);
    expect(lookup.searchCards).not.toHaveBeenCalled();
    const rows = document.querySelectorAll('.inline-card-search-row');
    expect(rows).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add Sol Ring' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ card: expect.objectContaining({ id: SOL_RING_ID }) })
    );
  });

  it('shows the normal loading state while the link resolves', async () => {
    let resolve: (v: unknown) => void = () => {};
    lookup.getCardsByRefs.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPanel();
    await typeQuery(`https://cards.scryfall.io/normal/front/6/d/${SOL_RING_ID}.jpg?1562404432`);
    expect(screen.getByText('Searching…')).toBeTruthy();
    expect(lookup.getCardsByRefs).toHaveBeenCalledWith([{ id: SOL_RING_ID }]);
    await act(async () => {
      resolve({ cards: [SOL_RING], error: null });
    });
    expect(screen.getByText('Sol Ring')).toBeTruthy();
  });

  it('says a Scryfall link that is not a card is not a card, without a lookup', async () => {
    renderPanel();
    await typeQuery('https://scryfall.com/search?q=sol+ring');
    expect(screen.getByText("No matches. That link isn't a Scryfall card.")).toBeTruthy();
    expect(lookup.getCardsByRefs).not.toHaveBeenCalled();
    expect(lookup.searchCards).not.toHaveBeenCalled();
  });

  it('says so when the card cannot be found', async () => {
    lookup.getCardsByRefs.mockResolvedValue({
      cards: [],
      error: new Error("Scryfall couldn't complete that request (404 Not Found)."),
    });
    renderPanel();
    await typeQuery('https://scryfall.com/card/zzz/999/nothing');
    expect(screen.getByText("Couldn't find that card on Scryfall.")).toBeTruthy();
  });

  it('leaves an ordinary query to the normal search', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Scryfall/ }));
    await typeQuery('sol ring');
    expect(lookup.searchCards).toHaveBeenCalled();
    expect(lookup.getCardsByRefs).not.toHaveBeenCalled();
    expect(screen.getByText('No matches.')).toBeTruthy();
  });
});
