// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConflictPanel } from './ConflictPanel';
import { useConflictsStore, type DeckConflict } from '../store/conflicts';
import { useDecksStore, type Deck } from '../store/decks';
import { useToastsStore } from '../store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';

const card = (name: string): ScryfallCard => ({ oracle_id: name, name }) as unknown as ScryfallCard;

const deck = (id: string, name: string, cards: Deck['cards'] = []): Deck =>
  ({
    id,
    name,
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards,
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#000',
    createdAt: 0,
    updatedAt: 0,
  }) as Deck;

const makeConflict = (id = 'd-1'): DeckConflict => ({
  id,
  localDeck: deck(id, 'My Deck', [
    { slotId: 's1', card: card('Sol Ring'), allocatedCopyId: null, addedAt: 0 },
  ]),
  serverDeck: deck(id, 'My Deck', []),
  detectedAt: 0,
});

function renderPanel() {
  return render(
    <MemoryRouter>
      <ConflictPanel />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useConflictsStore.setState({ queue: [] });
  useDecksStore.setState({ decks: [], hydrated: true });
  useToastsStore.setState({ toasts: [] });
});

describe('ConflictPanel', () => {
  it('renders nothing when the conflict queue is empty', () => {
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the conflicting deck name, the card diff, and no "more waiting" note for a single conflict', () => {
    useConflictsStore.getState().push([makeConflict('d-1')]);
    renderPanel();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/My Deck.*changed on another device/)).toBeTruthy();
    expect(screen.getByText('Sync conflict')).toBeTruthy();
    expect(screen.getByText(/Only in your edit \(discarded\)/)).toBeTruthy();
    expect(screen.getByText('Sol Ring')).toBeTruthy();
  });

  it('shows a "more decks waiting" indicator when multiple conflicts are queued', () => {
    useConflictsStore.getState().push([makeConflict('d-1'), makeConflict('d-2')]);
    renderPanel();
    expect(screen.getByText(/1 more deck waiting/)).toBeTruthy();
  });

  it('"Keep server version" dismisses the current conflict and advances the queue', () => {
    useConflictsStore.getState().push([makeConflict('d-1'), makeConflict('d-2')]);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Keep server version' }));
    expect(useConflictsStore.getState().queue.map((c) => c.id)).toEqual(['d-2']);
  });

  it('"Restore my changes" replaces the deck with the captured local snapshot, toasts, and dismisses', () => {
    useDecksStore.setState({ decks: [deck('d-1', 'server name', [])], hydrated: true });
    useConflictsStore.getState().push([makeConflict('d-1')]);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Restore my changes' }));

    const restored = useDecksStore.getState().decks.find((d) => d.id === 'd-1');
    expect(restored?.cards).toHaveLength(1);
    expect(restored?.cards[0].card.name).toBe('Sol Ring');
    expect(useConflictsStore.getState().queue).toHaveLength(0);
    expect(
      useToastsStore.getState().toasts.some((t) => /Restored your changes/.test(t.message))
    ).toBe(true);
  });

  it('focuses "Restore my changes" on open, mirroring ConfirmDialog\'s autoFocus convention', () => {
    useConflictsStore.getState().push([makeConflict('d-1')]);
    renderPanel();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore my changes' }));
  });
});
