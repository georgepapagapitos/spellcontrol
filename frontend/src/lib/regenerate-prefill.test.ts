import { describe, expect, it } from 'vitest';
import { canRegenerate, regenerateState } from './regenerate-prefill';
import type { Deck } from '../store/decks';

const commander = { id: 'k', name: 'Krenko, Mob Boss' } as unknown as Deck['commander'];

describe('regenerateState', () => {
  it("carries the deck's own settings, themes and partner back to /decks/new", () => {
    const deck = {
      id: 'deck-1',
      format: 'commander',
      source: 'generated',
      commander,
      partnerCommander: null,
      generationContext: {
        customization: { brewLevel: 0.25 },
        selectedThemes: [
          { name: 'Goblins', slug: 'goblins', deckCount: 5200, popularityPercent: 40 },
        ],
        targetBracket: 3,
        landCount: 34,
        collectionMode: true,
      },
    } as unknown as Deck;
    const { prefill } = regenerateState(deck);
    expect(prefill.sourceDeckId).toBe('deck-1');
    expect(prefill.commander).toBe(commander);
    expect(prefill.customization).toEqual({ brewLevel: 0.25 });
    expect(prefill.themes).toEqual([
      { name: 'Goblins', slug: 'goblins', count: 5200, url: '', popularityPercent: 40 },
    ]);
    expect(prefill.targetBracket).toBe(3);
    expect(prefill.landCount).toBe(34);
    expect(prefill.collectionMode).toBe(true);
  });

  it('falls back to defaults for a deck saved without a generation context', () => {
    const deck = { id: 'd', format: 'commander', commander, generationContext: undefined };
    const { prefill } = regenerateState(deck as unknown as Deck);
    expect(prefill.themes).toEqual([]);
    expect(prefill.targetBracket).toBe('all');
    expect(prefill.landCount).toBe(37);
    expect(prefill.collectionMode).toBe(false);
  });
});

describe('canRegenerate', () => {
  it('needs a generated deck with a commander', () => {
    expect(canRegenerate({ source: 'generated', commander })).toBe(true);
    expect(canRegenerate({ source: 'manual', commander })).toBe(false);
    expect(canRegenerate({ source: 'generated', commander: null })).toBe(false);
  });
});
