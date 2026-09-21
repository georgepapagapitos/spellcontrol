import { describe, expect, it } from 'vitest';
import { importToDeck, pastedDeckLocalId, pastedListToken } from './import-to-deck';
import type { DeckImportResponse } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

function card(name: string): ScryfallCard {
  return { id: name.toLowerCase().replace(/\s+/g, '-'), name } as ScryfallCard;
}

function result(over: Partial<DeckImportResponse> = {}): DeckImportResponse {
  return {
    commander: null,
    companion: null,
    cards: [card('Sol Ring'), card('Island')],
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: 2,
    ...over,
  };
}

describe('pastedListToken', () => {
  it('is stable for the same list, so a refresh can resume the same goldfish', () => {
    expect(pastedListToken('1 Sol Ring\n1 Island')).toBe(pastedListToken('1 Sol Ring\n1 Island'));
  });

  it('differs between lists, so two pastes never share a snapshot', () => {
    expect(pastedListToken('1 Sol Ring')).not.toBe(pastedListToken('1 Island'));
  });
});

describe('importToDeck', () => {
  it('namespaces the id so it can never collide with a saved deck', () => {
    const deck = importToDeck(result(), 'abc', 'Pasted list');
    expect(deck.id).toBe(pastedDeckLocalId('abc'));
    expect(deck.id.startsWith('pasted:')).toBe(true);
  });

  it('claims no physical copy, because a pasted list owns nothing', () => {
    const deck = importToDeck(result(), 'abc', 'Pasted list');
    expect(deck.cards.every((c) => c.allocatedCopyId === null)).toBe(true);
    expect(deck.commanderAllocatedCopyId).toBe(null);
  });

  it('carries the commander and the detected format through', () => {
    const deck = importToDeck(
      result({ commander: card('Atraxa, Praetors Voice'), detectedFormat: 'commander' }),
      'abc',
      'Atraxa, Praetors Voice'
    );
    expect(deck.commander?.name).toBe('Atraxa, Praetors Voice');
    expect(deck.format).toBe('commander');
  });

  it('falls back to commander for a format we have no config for', () => {
    expect(importToDeck(result({ detectedFormat: 'gladiator' }), 'a', 'x').format).toBe(
      'commander'
    );
  });

  it('keeps a sideboard and tolerates its absence', () => {
    expect(importToDeck(result({ sideboard: [card('Fog')] }), 'a', 'x').sideboard).toHaveLength(1);
    expect(importToDeck(result(), 'a', 'x').sideboard).toEqual([]);
  });

  it('gives every slot a distinct id, so two copies stay two rows', () => {
    const deck = importToDeck(result({ cards: [card('Island'), card('Island')] }), 'a', 'x');
    expect(new Set(deck.cards.map((c) => c.slotId)).size).toBe(2);
  });
});
