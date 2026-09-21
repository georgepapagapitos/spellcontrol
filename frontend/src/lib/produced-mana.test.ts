// Guards for the produced_mana backfill (see `produced-mana.ts`).
//
// The defect: a deck stores each card as the Scryfall cache had it the day the
// card was added, and the cache only began keeping `produced_mana` in #2011. So
// a deck built before that has none, and `producedManaColors` falls back to
// reading oracle text — a fallback whose "Add …" scan only matches {W}{U}{B}{R}{G}
// and never {C}. Measured on five live public decks (all 100 cards missing
// `produced_mana`): every mana rock reads as producing nothing, painlands and
// filters lose their colorless half, and a colorless deck reports ZERO mana
// sources where it has 49.
//
// Card data below is real Scryfall text, copied from the live
// /api/cards/lookup response rather than written by hand.
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildManaData } from './build-mana-data';
import { applyProducedMana, namesMissingProducedMana, producedManaFrom } from './produced-mana';

function card(fields: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return { id: fields.name, type_line: 'Artifact', ...fields } as ScryfallCard;
}

/** The same cards as a pre-#2011 deck stores them: no `produced_mana`. */
const SOL_RING = card({ name: 'Sol Ring', oracle_text: '{T}: Add {C}{C}.' });
const HEDRON_ARCHIVE = card({
  name: 'Hedron Archive',
  oracle_text: '{T}: Add {C}{C}.\n{2}, {T}, Sacrifice this artifact: Draw two cards.',
});
const WASTES = card({
  name: 'Wastes',
  type_line: 'Basic Land',
  oracle_text: '{T}: Add {C}.',
});
const WILD_GROWTH = card({
  name: 'Wild Growth',
  type_line: 'Enchantment — Aura',
  oracle_text:
    'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
});
const CRYPTOLITH = card({
  name: 'Cryptolith Fragment // Aurora of Emrakul',
  type_line: 'Artifact // Creature — Eldrazi Reflection',
  oracle_text: undefined,
  card_faces: [{ type_line: 'Artifact' }],
} as Partial<ScryfallCard> & { name: string });
const LIGHTNING_BOLT = card({
  name: 'Lightning Bolt',
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
});
const GRIZZLY_BEARS = card({
  name: 'Grizzly Bears',
  type_line: 'Creature — Bear',
  oracle_text: '',
});

describe('namesMissingProducedMana', () => {
  it('asks for a mana rock whose stored copy carries no production', () => {
    expect(namesMissingProducedMana([SOL_RING])).toEqual(['Sol Ring']);
  });

  it('asks for every land, whose production the type line alone cannot settle', () => {
    expect(namesMissingProducedMana([WASTES])).toEqual(['Wastes']);
  });

  it('asks for "adds an additional" as well as "Add"', () => {
    // Wild Growth is why the scan is /adds?/ — the live probe missed it with
    // a bare /add/, and it is a real mana source.
    expect(namesMissingProducedMana([WILD_GROWTH])).toEqual(['Wild Growth']);
  });

  it('asks for a card with no top-level oracle text rather than assuming', () => {
    // A double-faced card keeps its text on the faces. Guessing "no text, no
    // mana" dropped Cryptolith Fragment in the live probe.
    expect(namesMissingProducedMana([CRYPTOLITH])).toEqual([
      'Cryptolith Fragment // Aurora of Emrakul',
    ]);
  });

  it('leaves out a card that already carries production', () => {
    expect(namesMissingProducedMana([{ ...SOL_RING, produced_mana: ['C'] }])).toEqual([]);
  });

  it('leaves out one-shot rituals and cards that plainly make no mana', () => {
    // Without this the lookup becomes a whole-deck fetch.
    expect(namesMissingProducedMana([LIGHTNING_BOLT, GRIZZLY_BEARS])).toEqual([]);
  });

  it('de-duplicates copies so each name is asked once', () => {
    expect(namesMissingProducedMana([SOL_RING, { ...SOL_RING, id: 'b' }])).toEqual(['Sol Ring']);
  });
});

describe('producedManaFrom', () => {
  it('keeps resolved production keyed by the name asked for', () => {
    const resolved = new Map([['Sol Ring', card({ name: 'Sol Ring', produced_mana: ['C'] })]]);
    expect(producedManaFrom(resolved).get('Sol Ring')).toEqual(['C']);
  });

  it('contributes nothing for a card that resolved without production', () => {
    const resolved = new Map([['Lightning Bolt', LIGHTNING_BOLT]]);
    expect(producedManaFrom(resolved).size).toBe(0);
  });
});

describe('applyProducedMana', () => {
  it('stamps production onto the cards that lack it', () => {
    const [out] = applyProducedMana([SOL_RING], new Map([['Sol Ring', ['C']]]));
    expect(out.produced_mana).toEqual(['C']);
  });

  it('never overwrites production a card already carries', () => {
    const owned = { ...SOL_RING, produced_mana: ['C', 'C'] };
    const [out] = applyProducedMana([owned], new Map([['Sol Ring', ['C']]]));
    expect(out.produced_mana).toEqual(['C', 'C']);
  });

  it('returns the SAME array when nothing changes, so the analysis memo holds', () => {
    const cards = [SOL_RING];
    expect(applyProducedMana(cards, new Map())).toBe(cards);
    expect(applyProducedMana(cards, new Map([['Nobody Here', ['C']]]))).toBe(cards);
  });
});

describe('the symptom: a colorless deck reads as having no mana', () => {
  const deck = [SOL_RING, HEDRON_ARCHIVE, WASTES, WASTES];
  const production = new Map([
    ['Sol Ring', ['C']],
    ['Hedron Archive', ['C']],
    ['Wastes', ['C']],
  ]);

  it('counts zero mana sources on the stored deck', () => {
    const mana = buildManaData(deck, null, null);
    expect(mana.manaProduction.total).toBe(0);
    expect(mana.manaProduction.counts.C).toBe(0);
  });

  it('counts every one of them once production is backfilled', () => {
    const mana = buildManaData(applyProducedMana(deck, production), null, null);
    expect(mana.manaProduction.total).toBe(4);
    expect(mana.manaProduction.counts.C).toBe(4);
  });
});
