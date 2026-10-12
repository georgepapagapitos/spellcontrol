// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import { useDeckDerived } from './use-deck-derived';

const card = (name: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id: `sf-${name}`, name, color_identity: [], ...extra }) as ScryfallCard;

const slot = (name: string, n = 0): DeckCard => ({
  slotId: `${name}-${n}`,
  card: card(name),
  allocatedCopyId: null,
});

const makeDeck = (over: Partial<Deck> = {}): Deck => ({
  id: 'd1',
  name: 'Test',
  source: 'manual',
  format: 'commander',
  commander: null,
  partnerCommander: null,
  commanderAllocatedCopyId: null,
  partnerCommanderAllocatedCopyId: null,
  cards: [],
  sideboard: [],
  considering: [],
  generationContext: null,
  color: '#000',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const derive = (deck: Deck, addZone: 'main' | 'side' | 'considering' = 'main') =>
  renderHook(() => useDeckDerived({ deck, addZone, collectionById: undefined })).result.current;

describe('useDeckDerived', () => {
  it('limits a Commander mainboard to 99, or 98 with a partner', () => {
    expect(derive(makeDeck()).mainboardLimit).toBe(99);
    const partner = makeDeck({ partnerCommander: card('Partner') });
    expect(derive(partner).mainboardLimit).toBe(98);
  });

  it('has no hard mainboard limit outside commander formats', () => {
    const d = derive(makeDeck({ format: 'standard' }));
    expect(d.isCommander).toBe(false);
    expect(d.mainboardLimit).toBe(Infinity);
    expect(d.deckIsFull).toBe(false);
  });

  it('reports a full deck once the mainboard reaches the limit', () => {
    const cards = Array.from({ length: 99 }, (_, i) => slot(`Card ${i}`));
    expect(derive(makeDeck({ cards })).deckIsFull).toBe(true);
    expect(derive(makeDeck({ cards: cards.slice(1) })).deckIsFull).toBe(false);
  });

  it('counts main and sideboard copies by name, not the considering pile', () => {
    const d = derive(
      makeDeck({
        cards: [slot('Sol Ring'), slot('Forest', 0), slot('Forest', 1)],
        sideboard: [slot('Forest', 2)],
        considering: [slot('Forest', 3)],
      })
    );
    expect(d.existingCardCounts.get('Sol Ring')).toBe(1);
    expect(d.existingCardCounts.get('Forest')).toBe(3);
  });

  it('gates a second copy of a singleton card but never a basic land', () => {
    const deck = makeDeck({
      cards: [slot('Sol Ring'), slot('Forest', 0), slot('Forest', 1)],
    });
    const { atCopyLimit } = derive(deck);
    expect(atCopyLimit('Sol Ring')).toBe(true);
    expect(atCopyLimit('Forest')).toBe(false);
    expect(atCopyLimit('Not In Deck')).toBe(false);
  });

  it('checks the zone being added to, and never limits considering', () => {
    const deck = makeDeck({ cards: [slot('Sol Ring')], sideboard: [] });
    expect(derive(deck, 'side').atCopyLimit('Sol Ring')).toBe(false);
    expect(derive(deck, 'considering').atCopyLimit('Sol Ring')).toBe(false);
    expect(derive(deck, 'main').atCopyLimit('Sol Ring')).toBe(true);
  });

  it('merges commander and partner colors and names, in order', () => {
    const deck = makeDeck({
      commander: card('Alpha', { color_identity: ['W', 'U'] }),
      partnerCommander: card('Beta', { color_identity: ['U', 'B'] }),
    });
    const d = derive(deck);
    expect(d.commanderNames).toEqual(['Alpha', 'Beta']);
    expect([...d.commanderColorIdentity].sort()).toEqual(['B', 'U', 'W']);
    expect(d.comboColorIdentity).toEqual(d.commanderColorIdentity);
  });

  it('leaves the combo color filter off for a deck with no commander', () => {
    expect(derive(makeDeck()).comboColorIdentity).toBeUndefined();
  });

  it('collects oracle ids from the whole deck for combos, mainboard only for signals', () => {
    const deck = makeDeck({
      commander: card('Cmdr', { oracle_id: 'o-cmdr' }),
      cards: [{ ...slot('A'), card: card('A', { oracle_id: 'o-a' }) }],
      sideboard: [{ ...slot('B'), card: card('B', { oracle_id: 'o-b' }) }],
    });
    const d = derive(deck);
    expect(d.deckOracleIds.sort()).toEqual(['o-a', 'o-b', 'o-cmdr']);
    expect([...d.mainboardOracleIds].sort()).toEqual(['o-a', 'o-cmdr']);
  });
});
