import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customization, ScryfallCard } from '@/deck-builder/types';
import { notLegalForFormat } from '@/deck-builder/services/deckBuilder/deckFilters';
import type { Deck } from '@/store/decks';

const generateDeck = vi.fn();
vi.mock('@/deck-builder/services/deckBuilder/deckGenerator', () => ({
  generateDeck: (...args: unknown[]) => generateDeck(...args),
}));

const { buildFill, fillFormatSettings } = await import('./fill-deck');

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `sf-${name}`,
    name,
    type_line: 'Instant',
    oracle_text: '',
    color_identity: ['R'],
    legalities: { commander: 'legal', brawl: 'legal' },
    ...over,
  } as unknown as ScryfallCard;
}

// Real Scryfall legalities for Sol Ring (oracle text and the two keys that
// matter here): a Commander staple that has never been on Arena, so Brawl
// doesn't allow it.
const SOL_RING = card('Sol Ring', {
  type_line: 'Artifact',
  mana_cost: '{1}',
  cmc: 1,
  rarity: 'uncommon',
  color_identity: [],
  oracle_text: '{T}: Add {C}{C}.',
  legalities: { commander: 'legal', brawl: 'not_legal' },
});

function deck(format: Deck['format']): Deck {
  return {
    id: 'd1',
    name: 'Fill me',
    format,
    source: 'manual',
    commander: card('Krenko, Tin Street Kingpin', { type_line: 'Legendary Creature' }),
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [{ slotId: 's1', card: card('Lightning Bolt'), allocatedCopyId: null }],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#c00',
    createdAt: 0,
    updatedAt: 0,
  };
}

const customizationOf = () =>
  (generateDeck.mock.calls[0][0] as { customization: Customization }).customization;

beforeEach(() => {
  generateDeck.mockReset();
  generateDeck.mockResolvedValue({
    categories: {
      spells: Array.from({ length: 70 }, (_, i) => card(`Spell ${i}`)),
    },
  });
});

describe('buildFill', () => {
  // A Brawl deck used to be filled as Commander: the Commander card pool and
  // 99-card role, curve and land targets.
  it('builds a Brawl deck from the Brawl pool at the Brawl size', async () => {
    const { plan } = await buildFill(deck('brawl'), 59, { brewLevel: 0.5, preferOwned: false }, {});
    expect(customizationOf()).toMatchObject({
      mtgFormat: 'brawl',
      deckFormat: 60,
      landCount: 23,
      nonBasicLandCount: 9,
    });
    // The sheet's target is the format's mainboard: 59 with one already in.
    expect(plan.additions).toHaveLength(58);
  });

  it('keeps Commander and Pauper Commander on the 99-card defaults', async () => {
    await buildFill(deck('commander'), 99, { brewLevel: 0.5, preferOwned: false }, {});
    expect(customizationOf()).toMatchObject({
      mtgFormat: 'commander',
      deckFormat: 99,
      landCount: 37,
    });
    generateDeck.mockClear();
    await buildFill(deck('paupercommander'), 99, { brewLevel: 0.5, preferOwned: false }, {});
    expect(customizationOf()).toMatchObject({ mtgFormat: 'paupercommander', deckFormat: 99 });
  });
});

describe('fillFormatSettings', () => {
  it("hands the generator a format whose legality gate turns away a Commander card Brawl doesn't allow", () => {
    expect(notLegalForFormat(SOL_RING, fillFormatSettings('brawl').mtgFormat)).toBe(true);
    expect(notLegalForFormat(SOL_RING, fillFormatSettings('commander').mtgFormat)).toBe(false);
  });
});
