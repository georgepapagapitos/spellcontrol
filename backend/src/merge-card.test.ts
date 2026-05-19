import { describe, it, expect } from 'vitest';
import { mergeCard } from './merge-card';
import type { ImportRow } from './parsers/types';
import type { ScryfallCard } from './types';

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    name: 'Sol Ring',
    quantity: 1,
    sourceFormat: 'manabox',
    ...overrides,
  };
}

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    name: 'Sol Ring',
    rarity: 'uncommon',
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '1',
    ...overrides,
  };
}

describe('mergeCard', () => {
  it('uses row data and leaves Scryfall fields unset on a lookup miss', () => {
    const result = mergeCard(
      row({ name: 'Mystery Card', setCode: 'xyz', collectorNumber: '42', rarity: 'Rare' })
    );
    expect(result.name).toBe('Mystery Card');
    expect(result.setCode).toBe('xyz'); // row.setCode passes through as-is; only Scryfall's set is upper-cased
    expect(result.collectorNumber).toBe('42');
    expect(result.rarity).toBe('rare');
    expect(result.purchasePrice).toBe(0);
    expect(result.colors).toBeUndefined();
    expect(result.colorIdentity).toBeUndefined();
    expect(result.finish).toBe('nonfoil');
    expect(result.foil).toBe(false);
  });

  it('prefers Scryfall identity over row values and lowercases rarity', () => {
    const result = mergeCard(
      row({ name: 'wrong', setCode: 'old', rarity: 'common' }),
      card({ name: 'Sol Ring', set: 'cmr', rarity: 'Uncommon', oracle_id: 'o-1' })
    );
    expect(result.name).toBe('Sol Ring');
    expect(result.setCode).toBe('CMR');
    expect(result.rarity).toBe('uncommon');
    expect(result.oracleId).toBe('o-1');
  });

  it('picks the price for the row finish, falling back across finishes', () => {
    const prices = { usd: '1.50', usd_foil: '5.00', usd_etched: null };
    expect(mergeCard(row(), card({ prices })).purchasePrice).toBe(1.5);
    expect(mergeCard(row({ finish: 'foil' }), card({ prices })).purchasePrice).toBe(5);
    // Etched has no price → falls back to foil, then nonfoil.
    expect(mergeCard(row({ finish: 'etched' }), card({ prices })).purchasePrice).toBe(5);
    // No prices at all → unpriced (0), and pricedAt stays unset.
    const unpriced = mergeCard(row(), card());
    expect(unpriced.purchasePrice).toBe(0);
    expect(unpriced.pricedAt).toBeUndefined();
  });

  it('passes through per-copy row metadata only when present', () => {
    const full = mergeCard(
      row({ condition: 'lp', language: 'ja', altered: true, proxy: false, misprint: true }),
      card()
    );
    expect(full.condition).toBe('lp');
    expect(full.language).toBe('ja');
    expect(full.altered).toBe(true);
    expect(full.proxy).toBe(false);
    expect(full.misprint).toBe(true);

    const bare = mergeCard(row(), card());
    expect(bare).not.toHaveProperty('condition');
    expect(bare).not.toHaveProperty('language');
    expect(bare).not.toHaveProperty('altered');
  });

  it('resolves a transform card to its front face (the Ashling, Rekindled case)', () => {
    // "Ashling, Rekindled // Ashling, Rimebound": real Scryfall sends top-level
    // colors/mana_cost/oracle_text as null and color_identity as the union of
    // both faces. The front is mono-red {1}{R}; the back is blue. The merged
    // card must carry the front face's color so it buckets under Red, not
    // Multicolor — the bug this whole change fixes, on the import path.
    const ashling = card({
      name: 'Ashling, Rekindled // Ashling, Rimebound',
      layout: 'transform',
      // Scryfall literally sends `null` here for transform; `??` treats it the
      // same as undefined. Cast keeps the fixture faithful to the wire shape.
      colors: null as unknown as string[],
      cmc: 2,
      color_identity: ['R', 'U'],
      card_faces: [
        {
          name: 'Ashling, Rekindled',
          type_line: 'Legendary Creature — Elemental Sorcerer',
          colors: ['R'],
          mana_cost: '{1}{R}',
          oracle_text: 'Front text.',
          image_uris: { normal: 'front.png' },
        },
        {
          name: 'Ashling, Rimebound',
          type_line: 'Legendary Creature — Elemental Wizard',
          colors: ['U'],
          mana_cost: '',
          oracle_text: 'Back text.',
          image_uris: { normal: 'back.png' },
        },
      ],
    });

    const result = mergeCard(row({ name: 'Ashling, Rekindled' }), ashling);

    expect(result.colors).toEqual(['R']); // front face, NOT the ['R','U'] identity
    expect(result.colorIdentity).toEqual(['R', 'U']); // identity stays the union
    expect(result.cmc).toBe(2); // front face mana value
    expect(result.typeLine).toBe('Legendary Creature — Elemental Sorcerer');
    expect(result.imageNormalBack).toBe('back.png');
    expect(result.manaCost).toBe('{1}{R} // ');
    expect(result.oracleText).toBe('Front text.\n//\nBack text.');
  });

  it('falls back cmc/typeLine to the first face when top-level is absent', () => {
    // reversible_card / art_series style: top-level cmc + type_line missing.
    const result = mergeCard(
      row(),
      card({
        cmc: undefined,
        type_line: undefined,
        card_faces: [
          { name: 'A', type_line: 'Artifact', cmc: 1, colors: [] },
          { name: 'B', type_line: 'Artifact', cmc: 1, colors: [] },
        ],
      })
    );
    expect(result.cmc).toBe(1);
    expect(result.typeLine).toBe('Artifact');
  });
});
