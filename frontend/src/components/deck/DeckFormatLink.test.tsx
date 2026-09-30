// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore, type Deck } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useToastsStore } from '@/store/toasts';
import { setApplyingServer } from '@/lib/sync/applying-server';
import { DeckFormatLink } from './DeckFormatLink';

// The decks store persists every write through lib/sync; counting those calls
// is how "one write" is measured (same contract as apply-upgrade-plan.test).
const persistDecksState = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/sync', () => ({
  persistDecksState: (...args: unknown[]) => persistDecksState(...args),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

const card = (name: string, over: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({
    id: `sf-${name}`,
    name,
    type_line: 'Instant',
    rarity: 'common',
    color_identity: ['R'],
    legalities: { commander: 'legal', modern: 'legal' },
    ...over,
  }) as unknown as ScryfallCard;

const KRENKO = card('Krenko, Tin Street Kingpin', {
  type_line: 'Legendary Creature — Goblin Warrior',
  rarity: 'rare',
});

function seed(): Deck {
  return {
    id: 'd1',
    name: 'Krenko',
    format: 'commander',
    source: 'manual',
    commander: KRENKO,
    partnerCommander: null,
    commanderAllocatedCopyId: 'copy-krenko',
    partnerCommanderAllocatedCopyId: null,
    cards: [{ slotId: 's1', card: card('Lightning Bolt'), allocatedCopyId: null, addedAt: 1 }],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#c00',
    createdAt: 0,
    updatedAt: 0,
    bracketEstimation: { bracket: 3 } as Deck['bracketEstimation'],
  };
}

/** The page hands the link the live deck; so does this. */
function Harness() {
  const deck = useDecksStore((s) => s.decks[0]);
  return <DeckFormatLink deck={deck} />;
}

const deckNow = () => useDecksStore.getState().decks[0];

describe('DeckFormatLink', () => {
  beforeEach(async () => {
    setApplyingServer(false);
    useDecksStore.setState({ decks: [seed()], hydrated: true });
    useDeckHistoryStore.getState().clear();
    useToastsStore.setState({ toasts: [] });
    await flush();
    persistDecksState.mockClear();
  });

  it('opens the sheet on the current format, with nothing to switch yet', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Format: Commander. Change format' }));
    expect(screen.getByRole('dialog', { name: 'Format' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Commander/ })).toHaveProperty('checked', true);
    expect(screen.getByText(/99 cards \+ commander · Current/)).toBeTruthy();
    expect(screen.queryByText(/Switching to/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to Commander' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('shows what the switch does before it commits', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^Format:/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^Modern/ }));
    expect(screen.getByText('Switching to Modern')).toBeTruthy();
    expect(screen.getByText('Krenko, Tin Street Kingpin moves into the main deck.')).toBeTruthy();
    // Nothing is written until the switch is pressed.
    expect(deckNow().format).toBe('commander');
  });

  it('switches in one write, and Undo puts the deck back', async () => {
    const replaceDeck = vi.spyOn(useDecksStore.getState(), 'replaceDeck');
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^Format:/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^Modern/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Modern' }));
    await act(flush);

    expect(replaceDeck).toHaveBeenCalledTimes(1);
    expect(persistDecksState).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deckNow().format).toBe('modern');
    expect(deckNow().commander).toBeNull();
    expect(deckNow().bracketEstimation).toBeUndefined();
    const krenko = deckNow().cards.find((c) => c.card.name === KRENKO.name);
    expect(krenko?.allocatedCopyId).toBe('copy-krenko');
    expect(screen.getByRole('button', { name: 'Format: Modern. Change format' })).toBeTruthy();

    const toast = useToastsStore.getState().toasts.at(-1)!;
    expect(toast.message).toBe('Switched to Modern');
    expect(toast.actionLabel).toBe('Undo');
    act(() => toast.onAction!());
    expect(deckNow().format).toBe('commander');
    expect(deckNow().commander?.name).toBe(KRENKO.name);
    expect(deckNow().commanderAllocatedCopyId).toBe('copy-krenko');
    expect(deckNow().cards.map((c) => c.card.name)).toEqual(['Lightning Bolt']);
    expect(deckNow().bracketEstimation).toEqual({ bracket: 3 });
  });

  it('Cancel changes nothing', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^Format:/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^Modern/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deckNow().format).toBe('commander');
    expect(useDeckHistoryStore.getState().canUndo('d1')).toBe(false);
  });
});
