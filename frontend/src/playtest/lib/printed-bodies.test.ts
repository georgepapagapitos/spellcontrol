// Guards for the printed-body backfill (see `printed-bodies.ts`).
//
// The defect these exist for: a deck stores each card as the cache had it when
// the card was added, and the cache did not keep `power`/`toughness` until
// #2004. So on every deck built before that, `deckToPlaytestInit` copied a
// creature with no body onto the board and the P/T badge rendered nothing —
// on a live public deck, 7 permanents and 0 badges. Re-ingesting the card
// cache does not fix it, because the board reads the DECK, never the cache.
//
// If these fail: the selection is asking for the wrong names (a whole-deck
// fetch, or missing the creatures that need it) or keeping bodies off cards
// that print none.
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import { namesMissingBody, printedBodiesFrom } from './printed-bodies';

function card(overrides: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return { id: overrides.name, type_line: 'Creature — Goblin', ...overrides } as ScryfallCard;
}

function slot(c: ScryfallCard): DeckCard {
  return { slotId: `slot-${c.name}`, card: c, allocatedCopyId: null };
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    cards: [],
    sideboard: [],
    ...overrides,
  } as Deck;
}

describe('namesMissingBody', () => {
  it('asks for a creature whose stored copy carries no printed power', () => {
    const d = deck({ cards: [slot(card({ name: 'Goblin Trashmaster' }))] });
    expect(namesMissingBody(d)).toEqual(['Goblin Trashmaster']);
  });

  it('leaves a card that already prints a body alone', () => {
    const d = deck({
      cards: [slot(card({ name: 'Moggcatcher', power: '2', toughness: '2' }))],
    });
    expect(namesMissingBody(d)).toEqual([]);
  });

  it('asks for nothing on behalf of a card that prints no body', () => {
    // The whole point of the type filter: without it every land, ritual and
    // Signet in the deck joins the lookup and it becomes a whole-deck fetch.
    const d = deck({
      cards: [
        slot(card({ name: 'Mountain', type_line: 'Basic Land — Mountain' })),
        slot(card({ name: 'Sol Ring', type_line: 'Artifact' })),
        slot(card({ name: 'Past in Flames', type_line: 'Sorcery' })),
      ],
    });
    expect(namesMissingBody(d)).toEqual([]);
  });

  it('covers a Vehicle, which prints a body without being a creature', () => {
    const d = deck({
      cards: [slot(card({ name: 'Smuggler’s Copter', type_line: 'Artifact — Vehicle' }))],
    });
    expect(namesMissingBody(d)).toEqual(['Smuggler’s Copter']);
  });

  it('covers both commanders, not just the mainboard', () => {
    const d = deck({
      commander: card({ name: 'Krenko, Mob Boss' }),
      partnerCommander: card({ name: 'Zada, Hedron Grinder' }),
    });
    expect(namesMissingBody(d)).toEqual(['Krenko, Mob Boss', 'Zada, Hedron Grinder']);
  });

  it('de-duplicates copies so the lookup asks each name once', () => {
    const d = deck({
      cards: [
        slot(card({ name: 'Goblin Trashmaster' })),
        slot(card({ name: 'Goblin Trashmaster' })),
      ],
    });
    expect(namesMissingBody(d)).toEqual(['Goblin Trashmaster']);
  });
});

describe('printedBodiesFrom', () => {
  it('keeps the body of a resolved creature, keyed by the name asked for', () => {
    const resolved = new Map([
      ['Serra Angel', card({ name: 'Serra Angel', power: '4', toughness: '4' })],
    ]);
    expect(printedBodiesFrom(resolved).get('Serra Angel')).toEqual({ power: '4', toughness: '4' });
  });

  it('keeps a non-numeric body verbatim rather than parsing it', () => {
    // A board that folded `*` into a number would print something untrue.
    const resolved = new Map([
      ['Tarmogoyf', card({ name: 'Tarmogoyf', power: '*', toughness: '1+*' })],
    ]);
    expect(printedBodiesFrom(resolved).get('Tarmogoyf')).toEqual({ power: '*', toughness: '1+*' });
  });

  it('contributes nothing for a card with no top-level power', () => {
    // Covers both a bodiless resolution and a double-faced card, whose body
    // lives on its faces and which the board has never read a body from.
    const resolved = new Map([
      ['Command Tower', card({ name: 'Command Tower', type_line: 'Land' })],
      [
        'Delver of Secrets',
        card({ name: 'Delver of Secrets', type_line: 'Creature — Human // Creature — Insect' }),
      ],
    ]);
    expect(printedBodiesFrom(resolved).size).toBe(0);
  });
});
