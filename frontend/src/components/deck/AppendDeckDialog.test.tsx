// @vitest-environment happy-dom
/**
 * Paste cards into a deck with no commander, where the paste is only the
 * commander. Picking it pulls it out of the card list, so the commit adds no
 * cards, and Confirm used to stay disabled on `addedCount === 0`: the
 * commander could be picked but never saved. It now commits as one write,
 * says "Set commander", and names an "Untitled deck" the way the picker does.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore, UNTITLED_DECK_NAME, type Deck } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { setApplyingServer } from '@/lib/sync/applying-server';
import type { DeckImportResponse } from '@/types';

// The decks store persists every write through lib/sync; counting those calls
// is how "one write" is measured (same contract as DeckFormatLink.test).
const persistDecksState = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/sync', () => ({
  persistDecksState: (...args: unknown[]) => persistDecksState(...args),
}));

const importDeckTextMock = vi.fn<() => Promise<DeckImportResponse>>();
vi.mock('@/lib/api', () => ({
  importDeckText: () => importDeckTextMock(),
}));

// The search is never opened: the paste names its commander.
vi.mock('./CommanderSearch', () => ({ CommanderSearch: () => null }));

import { AppendDeckDialog } from './AppendDeckDialog';

const flush = () => new Promise((r) => setTimeout(r, 0));

// Real Scryfall card data: commander eligibility reads the type line.
const CHULANE = {
  id: 'sf-chulane',
  name: 'Chulane, Teller of Tales',
  type_line: 'Legendary Creature — Human Druid',
  oracle_text:
    "Vigilance\nWhenever you cast a creature spell, draw a card, then you may put a land card from your hand onto the battlefield.\n{3}, {T}: Return target creature you control to its owner's hand.",
  rarity: 'mythic',
  color_identity: ['G', 'U', 'W'],
  legalities: { commander: 'legal' },
} as unknown as ScryfallCard;

function seed(name: string): Deck {
  return {
    id: 'd1',
    name,
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
  };
}

const deckNow = () => useDecksStore.getState().decks[0];

async function pasteOnlyTheCommander(name: string) {
  const deck = seed(name);
  useDecksStore.setState({ decks: [deck] });
  await flush();
  persistDecksState.mockClear();
  importDeckTextMock.mockResolvedValue({
    commander: null,
    companion: null,
    cards: [CHULANE],
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: 1,
  });
  const onClose = vi.fn();
  render(<AppendDeckDialog deck={deck} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Decklist to add'), {
    target: { value: '1 Chulane, Teller of Tales' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Parse list' }));
  fireEvent.click(await screen.findByRole('button', { name: /Chulane, Teller of Tales/ }));
  return onClose;
}

describe('AppendDeckDialog: a paste that only sets the commander', () => {
  beforeEach(async () => {
    setApplyingServer(false);
    useDecksStore.setState({ decks: [], hydrated: true });
    useDeckHistoryStore.getState().clear();
    importDeckTextMock.mockReset();
    await flush();
  });

  it('can be confirmed, and commits the commander in exactly one write', async () => {
    const onClose = await pasteOnlyTheCommander('Blink Party');
    const confirm = screen.getByRole('button', { name: 'Set commander' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Nothing to add/)).toBeNull();

    fireEvent.click(confirm);
    await flush();

    expect(deckNow().commander?.name).toBe('Chulane, Teller of Tales');
    expect(deckNow().cards).toEqual([]);
    expect(persistDecksState).toHaveBeenCalledTimes(1);
    expect(useDeckHistoryStore.getState().undoLabel('d1')).toBe('set commander');
    // A name the user typed is never touched.
    expect(deckNow().name).toBe('Blink Party');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('names an Untitled deck after the commander, like the picker does', async () => {
    await pasteOnlyTheCommander(UNTITLED_DECK_NAME);
    fireEvent.click(screen.getByRole('button', { name: 'Set commander' }));
    await flush();
    expect(deckNow().name).toBe('Chulane');
  });
});
