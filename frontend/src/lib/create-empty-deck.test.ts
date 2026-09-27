// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDecksStore } from '../store/decks';
import { createEmptyDeck } from './create-empty-deck';

// The decks-store subscriber lazily imports the sync layer on the first
// mutation; let it settle inside this file instead of outliving it.
afterEach(async () => {
  const sync = await import('./sync');
  await sync.flushSync();
});

describe('createEmptyDeck (E465)', () => {
  it('creates a Private Commander deck with no commander and opens as "Untitled deck"', () => {
    useDecksStore.setState({ decks: [] });
    const id = createEmptyDeck();
    const deck = useDecksStore.getState().decks.find((d) => d.id === id);
    expect(deck).toBeTruthy();
    expect(deck!.name).toBe('Untitled deck');
    expect(deck!.format).toBe('commander');
    expect(deck!.commander).toBeNull();
    expect(deck!.partnerCommander ?? null).toBeNull();
    expect(deck!.cards).toEqual([]);
    expect(deck!.source).toBe('manual');
    // Never public by default: an empty untitled deck must not publish itself.
    expect(deck!.initialVisibility).toBe('private');
  });

  it('uses the format it is given, through the create function it is handed', () => {
    const create = vi.fn(() => 'new-id');
    expect(createEmptyDeck('brawl', create)).toBe('new-id');
    expect(create).toHaveBeenCalledWith({
      source: 'manual',
      format: 'brawl',
      commander: null,
      commanderAllocatedCopyId: null,
      partnerCommander: null,
      partnerCommanderAllocatedCopyId: null,
      initialVisibility: 'private',
    });
  });
});
