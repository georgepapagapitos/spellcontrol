import { describe, expect, it } from 'vitest';
import type { Deck } from '@/store/decks';
import { canLock, lockedNames, withLock } from './deck-locks';
import { deckEdits } from './regenerate-edits';
import { regenerateState } from './regenerate-prefill';

const commander = { id: 'k', name: 'Krenko, Mob Boss' } as unknown as Deck['commander'];
const slot = (name: string) => ({ card: { name, type_line: 'Creature' } });

function deck(cards: string[], mustIncludeCards?: string[], generated = cards): Deck {
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
      generatedList: { cards: generated, commanders: ['Krenko, Mob Boss'] },
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

  it('locking twice keeps one entry, and a typed must-include does not read as locked', () => {
    const typed = deck(['Goblin Matron'], ['Goblin Matron']);
    expect([...lockedNames(typed)]).toEqual([]);
    const d = lock(lock(typed, 'Goblin Matron'), 'Goblin Matron');
    expect(d.generationContext?.customization?.lockedCards).toEqual(['Goblin Matron']);
    expect(d.generationContext?.customization?.mustIncludeCards).toEqual(['Goblin Matron']);
  });

  it('has nothing to lock on a deck no generator built', () => {
    expect(withLock({ generationContext: null, cards: [] }, 'Goblin Matron', true)).toBeNull();
  });

  it('never locks a basic land', () => {
    expect(canLock({ type_line: 'Basic Land — Mountain' })).toBe(false);
    expect(canLock({ type_line: 'Basic Snow Land — Mountain' })).toBe(false);
    expect(canLock({ type_line: 'Land' })).toBe(true);
  });

  it('a regenerate carries a locked card, with no edits to carry', () => {
    const locked = lock(deck(['Skirk Prospector', 'Goblin Matron']), 'Goblin Matron');
    const { prefill } = regenerateState(locked);
    expect(prefill.edits).toBeUndefined();
    expect(prefill.customization?.lockedCards).toEqual(['Goblin Matron']);
    expect(prefill.customization?.brewLevel).toBe(0.25);
  });

  it('a locked generator pick the player then cut is not carried, and Keep my edits bans it', () => {
    const locked = lock(deck(['Skirk Prospector', 'Goblin Matron']), 'Goblin Matron');
    const cut = { ...locked, cards: locked.cards.filter((c) => c.card.name !== 'Goblin Matron') };
    expect([...lockedNames(cut)]).toEqual([]);
    expect(regenerateState(cut).prefill.customization?.lockedCards).toEqual([]);
    expect(deckEdits(cut)!.cut).toEqual(['Goblin Matron']);
  });

  // The review's case: a card added by hand is in neither the generated list
  // nor the edits once it is cut again, so nothing else would release its lock.
  it('a hand-added card that was locked and then cut does not come back', () => {
    const base = deck(['Skirk Prospector', 'Mogg War Marshal'], undefined, ['Skirk Prospector']);
    const locked = lock(base, 'Mogg War Marshal');
    expect(regenerateState(locked).prefill.customization?.lockedCards).toEqual([
      'Mogg War Marshal',
    ]);
    const cut = {
      ...locked,
      cards: locked.cards.filter((c) => c.card.name !== 'Mogg War Marshal'),
    };
    expect(deckEdits(cut)).toBeNull();
    const { prefill } = regenerateState(cut);
    expect(prefill.customization?.lockedCards).toEqual([]);
    expect(prefill.customization?.mustIncludeCards ?? []).not.toContain('Mogg War Marshal');
  });

  it('locking another card drops a dead lock', () => {
    const locked = lock(deck(['Skirk Prospector', 'Goblin Matron']), 'Goblin Matron');
    const cut = { ...locked, cards: locked.cards.filter((c) => c.card.name !== 'Goblin Matron') };
    const next = lock(cut as Deck, 'Skirk Prospector');
    expect(next.generationContext?.customization?.lockedCards).toEqual(['Skirk Prospector']);
  });
});
