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
  it('takes the caller’s namespaced id, so board state can never collide with a saved deck', () => {
    expect(importToDeck(result(), pastedDeckLocalId('abc'), 'Pasted list').id).toBe('pasted:abc');
    expect(importToDeck(result(), 'starter:x.json', 'Starter').id).toBe('starter:x.json');
  });

  it('claims no physical copy, because a pasted list owns nothing', () => {
    const deck = importToDeck(result(), pastedDeckLocalId('abc'), 'Pasted list');
    expect(deck.cards.every((c) => c.allocatedCopyId === null)).toBe(true);
    expect(deck.commanderAllocatedCopyId).toBe(null);
  });

  it('carries the commander and the detected format through', () => {
    const deck = importToDeck(
      result({ commander: card('Atraxa, Praetors Voice'), detectedFormat: 'commander' }),
      pastedDeckLocalId('abc'),
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

/** A partner the list named under Commander starts in the command zone at the
 *  goldfish table, where it gets its own tax coin (user, 2026-09-24). */
describe('importToDeck — a named partner', () => {
  const partnerCard = (name: string, oracle: string): ScryfallCard =>
    ({
      id: name,
      name,
      type_line: 'Legendary Creature',
      keywords: ['Partner with', 'Partner'],
      oracle_text: oracle,
    }) as ScryfallCard;
  const pako = partnerCard('Pako, Arcane Retriever', 'Partner with Haldan, Avid Arcanist\nHaste');
  const haldan = partnerCard('Haldan, Avid Arcanist', 'Partner with Pako, Arcane Retriever');

  it('moves the named partner out of the 99 and into the command zone', () => {
    const deck = importToDeck(
      result({ commander: pako, partner: haldan, cards: [haldan, card('Sol Ring')] }),
      pastedDeckLocalId('p'),
      'Pasted list'
    );
    expect(deck.partnerCommander?.name).toBe('Haldan, Avid Arcanist');
    expect(deck.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
  });

  it('leaves a named card that does not pair in the 99', () => {
    const deck = importToDeck(
      result({ commander: pako, partner: card('Sol Ring'), cards: [card('Sol Ring')] }),
      pastedDeckLocalId('p'),
      'Pasted list'
    );
    expect(deck.partnerCommander).toBeNull();
    expect(deck.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
  });
});
