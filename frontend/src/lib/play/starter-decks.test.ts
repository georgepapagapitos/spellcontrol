import { describe, expect, it } from 'vitest';
import {
  deckBoardPath,
  isStarterDeckId,
  starterDeckLocalId,
  starterFileName,
} from './starter-decks';

describe('starter deck ids', () => {
  it('namespaces the product file name and reads it back', () => {
    const id = starterDeckLocalId('Bloomburrow_Commander_Squirreled_Away.json');
    expect(id).toBe('starter:Bloomburrow_Commander_Squirreled_Away.json');
    expect(isStarterDeckId(id)).toBe(true);
    expect(starterFileName(id)).toBe('Bloomburrow_Commander_Squirreled_Away.json');
  });

  it('leaves a saved deck id alone', () => {
    expect(isStarterDeckId('deck-1')).toBe(false);
    expect(starterFileName('deck-1')).toBe(null);
  });
});

describe('deckBoardPath', () => {
  it('sends a saved deck to its own playtest route', () => {
    expect(deckBoardPath('deck-1')).toBe('/decks/deck-1/playtest');
  });

  // The bug this exists to stop: a starter is not in the decks store, so
  // /decks/starter:foo.json/playtest resolves nothing and renders an empty
  // board. Every seat-to-board door goes through this function.
  it('sends a starter to the route that resolves the product first', () => {
    expect(deckBoardPath(starterDeckLocalId('Foundations_Commander.json'))).toBe(
      '/decks/starters/Foundations_Commander.json/playtest'
    );
  });

  it('escapes a file name that would otherwise break the URL', () => {
    expect(deckBoardPath(starterDeckLocalId('Fate Reforged/Duel.json'))).toBe(
      '/decks/starters/Fate%20Reforged%2FDuel.json/playtest'
    );
  });
});
