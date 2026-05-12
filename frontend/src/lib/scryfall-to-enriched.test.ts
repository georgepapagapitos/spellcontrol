import { describe, it, expect } from 'vitest';
import { scryfallToEnrichedCard } from './scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';

function makeScryfall(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'abc-123',
    oracle_id: 'oracle-1',
    name: 'Lightning Bolt',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    rarity: 'Common',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    image_uris: {
      small: 'https://example.com/small.jpg',
      normal: 'https://example.com/normal.jpg',
      large: 'https://example.com/large.jpg',
      png: 'https://example.com/png.png',
      art_crop: 'https://example.com/art.jpg',
      border_crop: 'https://example.com/border.jpg',
    },
    prices: { usd: '1.50', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

describe('scryfallToEnrichedCard', () => {
  it('converts basic fields', () => {
    const result = scryfallToEnrichedCard(makeScryfall());

    expect(result.name).toBe('Lightning Bolt');
    expect(result.setCode).toBe('LEA');
    expect(result.setName).toBe('Limited Edition Alpha');
    expect(result.collectorNumber).toBe('161');
    expect(result.rarity).toBe('common');
    expect(result.scryfallId).toBe('abc-123');
    expect(result.cmc).toBe(1);
    expect(result.typeLine).toBe('Instant');
    expect(result.colorIdentity).toEqual(['R']);
    expect(result.colors).toEqual(['R']);
    expect(result.manaCost).toBe('{R}');
    expect(result.oracleText).toBe('Lightning Bolt deals 3 damage to any target.');
    expect(result.sourceFormat).toBe('manual');
    expect(result.finish).toBe('nonfoil');
    expect(result.foil).toBe(false);
  });

  it('generates a unique copyId', () => {
    const a = scryfallToEnrichedCard(makeScryfall());
    const b = scryfallToEnrichedCard(makeScryfall());
    expect(a.copyId).toBeTruthy();
    expect(a.copyId).not.toBe(b.copyId);
  });

  it('resolves usd price', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        prices: {
          usd: '2.50',
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
      })
    );
    expect(result.purchasePrice).toBe(2.5);
    expect(result.pricedAt).toBeGreaterThan(0);
  });

  it('falls back to usd_foil when usd is null', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        prices: {
          usd: null,
          usd_foil: '5.00',
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
      })
    );
    expect(result.purchasePrice).toBe(5);
  });

  it('falls back to usd_etched when usd and usd_foil are null', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        prices: {
          usd: null,
          usd_foil: null,
          usd_etched: '3.00',
          eur: null,
          eur_foil: null,
          tix: null,
        },
      })
    );
    expect(result.purchasePrice).toBe(3);
  });

  it('returns 0 price when all prices are null', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        prices: {
          usd: null,
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
      })
    );
    expect(result.purchasePrice).toBe(0);
    expect(result.pricedAt).toBeUndefined();
  });

  it('skips non-finite prices', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        prices: {
          usd: 'NaN',
          usd_foil: null,
          usd_etched: '1.00',
          eur: null,
          eur_foil: null,
          tix: null,
        },
      })
    );
    expect(result.purchasePrice).toBe(1);
  });

  it('skips zero prices', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        prices: {
          usd: '0',
          usd_foil: '4.00',
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
      })
    );
    expect(result.purchasePrice).toBe(4);
  });

  it('maps image URIs', () => {
    const result = scryfallToEnrichedCard(makeScryfall());
    expect(result.imageSmall).toBe('https://example.com/small.jpg');
    expect(result.imageNormal).toBe('https://example.com/normal.jpg');
  });

  it('uses face images when top-level image_uris is missing', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        image_uris: undefined,
        card_faces: [
          {
            name: 'Front',
            type_line: 'Creature',
            oracle_text: 'Front text',
            image_uris: {
              small: 'https://example.com/front-small.jpg',
              normal: 'https://example.com/front.jpg',
              large: '',
            },
          },
          {
            name: 'Back',
            type_line: 'Creature',
            oracle_text: 'Back text',
            image_uris: {
              small: 'https://example.com/back-small.jpg',
              normal: 'https://example.com/back.jpg',
              large: '',
            },
          },
        ],
      })
    );
    expect(result.imageSmall).toBe('https://example.com/front-small.jpg');
    expect(result.imageNormal).toBe('https://example.com/front.jpg');
    expect(result.imageNormalBack).toBe('https://example.com/back.jpg');
  });

  it('joins mana costs from card faces when top-level mana_cost is missing', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        mana_cost: undefined,
        card_faces: [
          { name: 'Front', type_line: 'Instant', mana_cost: '{1}{U}', oracle_text: '' },
          { name: 'Back', type_line: 'Land', mana_cost: '', oracle_text: '' },
        ],
      })
    );
    expect(result.manaCost).toBe('{1}{U} // ');
  });

  it('omits manaCost when faces have no mana cost', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        mana_cost: undefined,
        card_faces: [
          { name: 'Front', type_line: 'Land', oracle_text: '' },
          { name: 'Back', type_line: 'Land', oracle_text: '' },
        ],
      })
    );
    expect(result.manaCost).toBeUndefined();
  });

  it('joins oracle text from card faces when top-level is missing', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        oracle_text: undefined,
        card_faces: [
          { name: 'Front', type_line: 'Instant', oracle_text: 'Draw a card.' },
          { name: 'Back', type_line: 'Land', oracle_text: '{T}: Add {U}.' },
        ],
      })
    );
    expect(result.oracleText).toBe('Draw a card.\n//\n{T}: Add {U}.');
  });

  it('omits oracleText when faces have no oracle text', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        oracle_text: undefined,
        card_faces: [
          { name: 'Front', type_line: 'Land' },
          { name: 'Back', type_line: 'Land' },
        ],
      })
    );
    expect(result.oracleText).toBeUndefined();
  });

  it('falls back typeLine to first face', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        type_line: undefined as unknown as string,
        card_faces: [
          { name: 'Front', type_line: 'Creature — Human', oracle_text: '' },
          { name: 'Back', type_line: 'Creature — Werewolf', oracle_text: '' },
        ],
      })
    );
    expect(result.typeLine).toBe('Creature — Human');
  });

  it('falls back colors to first face', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        colors: undefined,
        card_faces: [
          { name: 'Front', type_line: 'Creature', colors: ['G'], oracle_text: '' },
          { name: 'Back', type_line: 'Creature', colors: ['G', 'B'], oracle_text: '' },
        ],
      })
    );
    expect(result.colors).toEqual(['G']);
  });

  it('maps fullArt from full_art flag', () => {
    const result = scryfallToEnrichedCard(makeScryfall({ full_art: true }));
    expect(result.fullArt).toBe(true);
  });

  it('maps fullArt from frame_effects', () => {
    const result = scryfallToEnrichedCard(makeScryfall({ frame_effects: ['fullart'] }));
    expect(result.fullArt).toBe(true);
  });

  it('sets fullArt false when neither flag is set', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({ full_art: undefined, frame_effects: undefined })
    );
    expect(result.fullArt).toBeFalsy();
  });

  it('maps optional metadata fields', () => {
    const result = scryfallToEnrichedCard(
      makeScryfall({
        edhrec_rank: 42,
        border_color: 'borderless',
        layout: 'normal',
        finishes: ['nonfoil', 'foil'],
        promo_types: ['boosterfun'],
      })
    );
    expect(result.edhrecRank).toBe(42);
    expect(result.borderColor).toBe('borderless');
    expect(result.layout).toBe('normal');
    expect(result.finishes).toEqual(['nonfoil', 'foil']);
    expect(result.promoTypes).toEqual(['boosterfun']);
  });
});
