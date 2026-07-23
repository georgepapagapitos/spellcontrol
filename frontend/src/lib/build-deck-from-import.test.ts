import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse, EnrichedCard } from '../types';
import { buildDeckInputFromImport } from './build-deck-from-import';

function sc(name: string, id: string): ScryfallCard {
  return { id, name } as unknown as ScryfallCard;
}

function owned(name: string, copyId: string): EnrichedCard {
  return {
    copyId,
    name,
    scryfallId: `sf-${copyId}`,
    finish: 'nonfoil',
    foil: false,
  } as unknown as EnrichedCard;
}

function result(
  cards: ScryfallCard[],
  commander: ScryfallCard | null = null,
  extra: Partial<DeckImportResponse> = {}
): DeckImportResponse {
  return {
    commander,
    companion: null,
    cards,
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: cards.length,
    ...extra,
  };
}

const ctxEmpty = { decks: [], collectionCards: [] as EnrichedCard[] };

describe('buildDeckInputFromImport', () => {
  it('keeps the commander out of the 99 and allocates owned copies', () => {
    const commander = sc('Zada, Hedron Grinder', 'zada');
    const cards = [commander, sc('Sol Ring', 'sol'), sc('Mountain', 'mtn')];
    const ctx = { decks: [], collectionCards: [owned('Sol Ring', 'copy-sol')] };

    const input = buildDeckInputFromImport(
      result(cards, commander),
      commander,
      'Goblin Storm',
      'commander',
      ctx
    );

    expect(input.commander).toBe(commander);
    // Commander excluded from the mainboard.
    expect(input.cards.map((c) => c.card.name)).toEqual(['Sol Ring', 'Mountain']);
    // The owned Sol Ring copy was claimed; the unowned Mountain wasn't.
    expect(input.cards.find((c) => c.card.name === 'Sol Ring')?.allocatedCopyId).toBe('copy-sol');
    expect(input.cards.find((c) => c.card.name === 'Mountain')?.allocatedCopyId).toBeNull();
    expect(input.source).toBe('manual');
  });

  it('moves a paired partner into the command zone, out of the 99', () => {
    const commander = sc('Commander A', 'a');
    const partner = sc('Partner B', 'b');
    const cards = [commander, partner, sc('Sol Ring', 'sol')];

    const input = buildDeckInputFromImport(
      result(cards, commander),
      commander,
      'Two-Headed',
      'commander',
      ctxEmpty,
      {
        partner,
      }
    );

    expect(input.partnerCommander).toBe(partner);
    expect(input.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
  });

  it('threads the sourceProduct provenance tag through', () => {
    const sourceProduct = { code: 'SLD', fileName: 'GoblinStorm_SLD', name: 'Goblin Storm' };
    const input = buildDeckInputFromImport(
      result([sc('Sol Ring', 'sol')], null),
      null,
      '',
      'commander',
      ctxEmpty,
      {
        sourceProduct,
      }
    );
    expect(input.sourceProduct).toEqual(sourceProduct);
    expect(input.commander).toBeNull();
    expect(input.cards).toHaveLength(1);
  });

  it('shares a claim map so two decks never grab the same physical copy', () => {
    const claimed = new Map();
    const ctx = { decks: [], collectionCards: [owned('Sol Ring', 'copy-sol')] };
    const a = buildDeckInputFromImport(
      result([sc('Sol Ring', 'sol')]),
      null,
      'A',
      'commander',
      ctx,
      { claimed }
    );
    const b = buildDeckInputFromImport(
      result([sc('Sol Ring', 'sol')]),
      null,
      'B',
      'commander',
      ctx,
      { claimed }
    );
    expect(a.cards[0].allocatedCopyId).toBe('copy-sol');
    expect(b.cards[0].allocatedCopyId).toBeNull(); // already claimed by A
  });

  // E122: sideboard/maybeboard rows now resolve into their own DeckImportResponse
  // arrays (previously excluded from `cards` upstream and silently dropped end
  // to end). They must land on the built deck's `sideboard`/`considering`, not
  // get folded into the mainboard.
  it('routes DeckImportResponse.sideboard/considering onto the built deck, allocating owned copies', () => {
    const commander = sc('Zada, Hedron Grinder', 'zada');
    const ctx = {
      decks: [],
      collectionCards: [owned('Negate', 'copy-negate'), owned('Rhystic Study', 'copy-rhystic')],
    };
    const input = buildDeckInputFromImport(
      result([commander, sc('Sol Ring', 'sol')], commander, {
        sideboard: [sc('Negate', 'negate')],
        considering: [sc('Rhystic Study', 'rhystic')],
      }),
      commander,
      'Goblin Storm',
      'commander',
      ctx
    );

    expect(input.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
    expect(input.sideboard.map((c) => c.card.name)).toEqual(['Negate']);
    expect(input.sideboard[0].allocatedCopyId).toBe('copy-negate');
    expect(input.considering.map((c) => c.card.name)).toEqual(['Rhystic Study']);
    expect(input.considering[0].allocatedCopyId).toBe('copy-rhystic');
  });

  it('defaults sideboard/considering to empty arrays when the response omits them', () => {
    const input = buildDeckInputFromImport(
      result([sc('Sol Ring', 'sol')]),
      null,
      'A',
      'commander',
      ctxEmpty
    );
    expect(input.sideboard).toEqual([]);
    expect(input.considering).toEqual([]);
  });
});
