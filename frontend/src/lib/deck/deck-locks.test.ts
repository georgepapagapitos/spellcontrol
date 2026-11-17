import { describe, expect, it } from 'vitest';
import type { Deck } from '@/store/decks';
import { canLock, lockedNames, withLock } from './deck-locks';
import { deckEdits, keepEditsPatch } from './regenerate-edits';
import { regenerateState } from './regenerate-prefill';

const commander = { id: 'k', name: 'Krenko, Mob Boss' } as unknown as Deck['commander'];
const slot = (name: string) => ({ card: { name, type_line: 'Creature' } });

function deck(cards: string[], mustIncludeCards?: string[]): Deck {
  return {
    id: 'deck-1',
    format: 'commander',
    source: 'generated',
    commander,
    partnerCommander: null,
    cards: cards.map(slot),
    generationContext: {
      selectedThemes: [],
      targetBracket: 'all',
      landCount: 36,
      collectionMode: false,
      customization: { brewLevel: 0.25, ...(mustIncludeCards && { mustIncludeCards }) },
      generatedList: { cards, commanders: ['Krenko, Mob Boss'] },
    },
  } as unknown as Deck;
}

const lock = (d: Deck, name: string, locked = true): Deck => ({
  ...d,
  generationContext: withLock(d, name, locked),
});

describe('deck locks', () => {
  it('locks and unlocks a card without touching the other build settings', () => {
    const locked = lock(deck(['Skirk Prospector', 'Goblin Matron']), 'Goblin Matron');
    expect([...lockedNames(locked)]).toEqual(['Goblin Matron']);
    expect(locked.generationContext?.customization?.brewLevel).toBe(0.25);
    expect(locked.generationContext?.landCount).toBe(36);
    expect([...lockedNames(lock(locked, 'Goblin Matron', false))]).toEqual([]);
  });

  it('locking twice keeps one entry, and a must-include from the build reads as locked', () => {
    const d = lock(deck(['Goblin Matron'], ['Goblin Matron']), 'Goblin Matron');
    expect(d.generationContext?.customization?.mustIncludeCards).toEqual(['Goblin Matron']);
  });

  it('has nothing to lock on a deck no generator built', () => {
    expect(withLock({ generationContext: null }, 'Goblin Matron', true)).toBeNull();
  });

  it('never locks a basic land', () => {
    expect(canLock({ type_line: 'Basic Land — Mountain' })).toBe(false);
    expect(canLock({ type_line: 'Basic Snow Land — Mountain' })).toBe(false);
    expect(canLock({ type_line: 'Land' })).toBe(true);
  });

  it('a regenerate replays a locked card as a must-include, with no edits to carry', () => {
    const locked = lock(deck(['Skirk Prospector', 'Goblin Matron']), 'Goblin Matron');
    const { prefill } = regenerateState(locked);
    expect(prefill.edits).toBeUndefined();
    expect(prefill.customization?.mustIncludeCards).toEqual(['Goblin Matron']);
  });

  it('a locked card the player then cut is not locked, and Keep my edits bans it', () => {
    const locked = lock(deck(['Skirk Prospector', 'Goblin Matron']), 'Goblin Matron');
    const cut = { ...locked, cards: locked.cards.filter((c) => c.card.name !== 'Goblin Matron') };
    expect([...lockedNames(cut)]).toEqual([]);
    const edits = deckEdits(cut)!;
    expect(edits.cut).toEqual(['Goblin Matron']);
    const patch = keepEditsPatch(
      { mustIncludeCards: ['Goblin Matron'], tempBannedCards: [] },
      edits,
      true,
      ['Goblin Matron']
    );
    expect(patch).toEqual({ mustIncludeCards: [], tempBannedCards: ['Goblin Matron'] });
  });
});
