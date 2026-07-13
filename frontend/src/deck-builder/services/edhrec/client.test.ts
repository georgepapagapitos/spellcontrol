import { describe, it, expect } from 'vitest';
import {
  isPoolTooThin,
  parseEdhrecResponse,
  MIN_HEALTHY_POOL_DECKS,
  MIN_HEALTHY_POOL_CARDS,
} from './client';
import type { EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';

// E93: isPoolTooThin gates the fallback ladder — these fixtures are the exact
// shapes seen live for "Mr. House, President and CEO" + Die Roll theme.
function card(name: string): EDHRECCard {
  return {
    name,
    sanitized: name.toLowerCase(),
    primary_type: 'Creature',
    inclusion: 10,
    num_decks: 10,
  };
}

function pool(numDecks: number, nonLandCount: number): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks,
      deckSize: 99,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 0, nonbasic: 0, total: 0 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: Array.from({ length: nonLandCount }, (_, i) => card(`Card ${i}`)),
    },
    similarCommanders: [],
  };
}

describe('isPoolTooThin', () => {
  it('flags a 0-deck, 0-card page as thin (Mr. House bracket-5 + Die Roll)', () => {
    expect(isPoolTooThin(pool(0, 0))).toBe(true);
  });

  it('flags a 19-deck cEDH-only page as thin even with a populated cardlist', () => {
    expect(isPoolTooThin(pool(19, 50))).toBe(true);
  });

  it('flags a page with plenty of decks but almost no distinct cards as thin', () => {
    expect(isPoolTooThin(pool(1000, 3))).toBe(true);
  });

  it('treats a healthy theme page (768 decks / 267 cards) as not thin', () => {
    expect(isPoolTooThin(pool(768, 267))).toBe(false);
  });

  it('sits right at the boundary', () => {
    expect(isPoolTooThin(pool(MIN_HEALTHY_POOL_DECKS - 1, MIN_HEALTHY_POOL_CARDS))).toBe(true);
    expect(isPoolTooThin(pool(MIN_HEALTHY_POOL_DECKS, MIN_HEALTHY_POOL_CARDS - 1))).toBe(true);
    expect(isPoolTooThin(pool(MIN_HEALTHY_POOL_DECKS, MIN_HEALTHY_POOL_CARDS))).toBe(false);
  });
});

describe('parseEdhrecResponse — 2026-07 schema drift', () => {
  // Modeled on the live json.edhrec.com response of 2026-07-12: no top-level
  // num_decks_avg (deck count moved to container.json_dict.card.num_decks) and
  // cardviews carry num_decks (+ potential_decks) instead of inclusion. A
  // parser reading only the old fields sees numDecks=0 → EVERY generation
  // silently falls back to no-EDHREC targets (the broken-panel incident).
  const newSchema = {
    creature: 24,
    instant: 10,
    sorcery: 8,
    artifact: 9,
    enchantment: 7,
    land: 35,
    basic: 12,
    nonbasic: 23,
    panels: { mana_curve: { '1': 8, '2': 12, '3': 14 }, taglinks: [] },
    container: {
      json_dict: {
        card: { name: 'Atraxa, Praetors’ Voice', num_decks: 42495 },
        cardlists: [
          {
            tag: 'topcards',
            header: 'Top Cards',
            cardviews: [
              {
                name: 'The Serpent Society',
                sanitized: 'the-serpent-society',
                num_decks: 75,
                potential_decks: 3668,
                synergy: 0.008,
              },
            ],
          },
        ],
      },
    },
  };

  it('reads the commander deck count from container.json_dict.card.num_decks', () => {
    const data = parseEdhrecResponse(newSchema, 'atraxa-praetors-voice');
    expect(data.stats.numDecks).toBe(42495);
  });

  it('derives card inclusion % from num_decks when the old inclusion field is absent', () => {
    const data = parseEdhrecResponse(newSchema, 'atraxa-praetors-voice');
    const card = data.cardlists.allNonLand.find((c) => c.name === 'The Serpent Society')!;
    expect(card.inclusion).toBeCloseTo((75 / 3668) * 100, 5);
    expect(card.num_decks).toBe(75);
  });

  it('still honors the old schema (inclusion + num_decks_avg) unchanged', () => {
    const old = {
      ...newSchema,
      num_decks_avg: 1234,
      container: {
        json_dict: {
          card: { name: 'X' },
          cardlists: [
            {
              tag: 'topcards',
              header: 'Top Cards',
              cardviews: [
                { name: 'Old Card', sanitized: 'old-card', inclusion: 50, potential_decks: 100 },
              ],
            },
          ],
        },
      },
    };
    const data = parseEdhrecResponse(old, 'x');
    expect(data.stats.numDecks).toBe(1234);
    expect(data.cardlists.allNonLand.find((c) => c.name === 'Old Card')!.inclusion).toBe(50);
  });
});
