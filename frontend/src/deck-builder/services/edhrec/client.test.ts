import { describe, it, expect } from 'vitest';
import {
  isPoolTooThin,
  parseEdhrecResponse,
  parseSaltIndex,
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

describe('parseEdhrecResponse — 2026-07-23 salt/prices/type_line drift (E126)', () => {
  // Real cardviews from a live curl of
  // json.edhrec.com/pages/commanders/atraxa-praetors-voice.json (2026-07-23).
  // Every cardview across the whole page (13 tags, 292 cardviews sampled)
  // carries only these 9 keys — salt, prices, type_line, color_identity, cmc,
  // and inclusion are all gone from cardlist cardviews (confirmed live).
  const liveShape = {
    container: {
      json_dict: {
        card: { name: "Atraxa, Praetors' Voice", num_decks: 19248 },
        cardlists: [
          {
            tag: 'creatures',
            header: 'Creatures',
            cardviews: [
              {
                id: '89b39293-6f57-4294-85fc-c718bdbb4d40',
                name: 'Cankerbloom',
                sanitized: 'cankerbloom',
                slug: 'cankerbloom',
                url: '/cards/cankerbloom',
                synergy: 0.12469872061553255,
                num_decks: 14148,
                potential_decks: 42853,
                trend_zscore: -0.029686577948208698,
              },
            ],
          },
        ],
      },
    },
  };

  it('parses cards with no salt/prices keys at all — both fields are gone upstream', () => {
    const data = parseEdhrecResponse(liveShape, 'atraxa-praetors-voice');
    const card = data.cardlists.creatures.find((c) => c.name === 'Cankerbloom')!;
    expect(card).not.toHaveProperty('salt');
    expect(card).not.toHaveProperty('prices');
  });

  it('still derives inclusion % and primary_type from num_decks + the cardlist tag alone', () => {
    const data = parseEdhrecResponse(liveShape, 'atraxa-praetors-voice');
    const card = data.cardlists.creatures.find((c) => c.name === 'Cankerbloom')!;
    // 'Creature' comes from the 'creatures' tag hint, not a type_line fallback
    // — the cardview above carries no type_line at all, matching live data.
    expect(card.primary_type).toBe('Creature');
    expect(card.num_decks).toBe(14148);
    expect(card.inclusion).toBeCloseTo((14148 / 42853) * 100, 5);
    expect(card.synergy).toBeCloseTo(0.12469872061553255, 10);
  });
});

describe('parseSaltIndex — E126 salt-gate reactivation (2026-07-23)', () => {
  // Real cardviews from a live curl of json.edhrec.com/pages/top/salt.json
  // (2026-07-23): salt is a DIRECT numeric field; no `label` exists anywhere
  // in the page's 100 cardviews. The old parser regexed `label` only, so it
  // returned an empty Map on every live fetch — the silently-inert salt gate.
  const liveShape = [
    { name: 'Stasis', salt: 3.0572033898305087 },
    { name: 'Winter Orb', salt: 2.961818181818181 },
    { name: 'Rhystic Study', salt: 2.729052466718872 },
  ];

  it('reads the live schema: direct numeric salt fields', () => {
    const map = parseSaltIndex(liveShape);
    expect(map.size).toBe(3);
    expect(map.get('Stasis')).toBeCloseTo(3.0572, 3);
    expect(map.get('Rhystic Study')).toBeCloseTo(2.7291, 3);
  });

  it('still reads the legacy label schema as a fallback', () => {
    const map = parseSaltIndex([{ name: 'Armageddon', label: 'Salt Score: 3.06\n16316 decks' }]);
    expect(map.get('Armageddon')).toBeCloseTo(3.06, 2);
  });

  it('prefers the direct field, ignores non-finite salt, skips unparseable rows', () => {
    const map = parseSaltIndex([
      { name: 'Both', salt: 2.5, label: 'Salt Score: 9.99\n1 decks' },
      { name: 'BadSalt', salt: Number.NaN, label: 'Salt Score: 1.25\n2 decks' },
      { name: 'Neither' },
    ]);
    expect(map.get('Both')).toBe(2.5);
    expect(map.get('BadSalt')).toBeCloseTo(1.25, 2); // falls through to label
    expect(map.has('Neither')).toBe(false);
  });
});
