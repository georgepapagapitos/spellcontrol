import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

// Must hoist the spy before the module import so the mock intercepts it.
const searchCards = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  searchCards: (...args: unknown[]) => searchCards(...args),
}));

import { buildModeConstraint, slugifyTag, buildAlternatePool } from './phaseAlternatePool';
import type { Customization } from '@/deck-builder/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function sc(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: ['G'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

/** Minimal Customization for tests — overrides applied on top. */
function cust(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99,
    landCount: 37,
    nonBasicLandCount: 25,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    targetBracket: 'all',
    maxRarity: null,
    tinyLeaders: false,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    hyperFocus: false,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    advancedTargets: {
      curvePercentages: null,
      typePercentages: null,
      roleTargets: null,
      edhrecBlendWeight: null,
      edhrecInclusionThreshold: null,
    },
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    brewLevel: 0.5,
    ...overrides,
  };
}

/** Fabricate N unique ScryfallCards of a given type. */
function makeCards(count: number, typeLine: string, baseRank = 1): ScryfallCard[] {
  return Array.from({ length: count }, (_, i) =>
    sc({
      id: `id-${typeLine}-${i}`,
      name: `${typeLine} Card ${i + 1}`,
      type_line: typeLine,
      edhrec_rank: baseRank + i,
      cmc: (i % 5) + 1,
    })
  );
}

/** Default "enough cards" mock response used by most tests. */
function okResponse(cards: ScryfallCard[]) {
  return { data: cards, has_more: false };
}

beforeEach(() => searchCards.mockReset());

// ── buildModeConstraint ───────────────────────────────────────────────────────

describe('buildModeConstraint', () => {
  it('art-theme: returns art:<slug> when artThemeTag is set', () => {
    expect(buildModeConstraint(cust({ generationMode: 'art-theme', artThemeTag: 'dragon' }))).toBe(
      'art:dragon'
    );
  });

  it('art-theme: returns empty string when artThemeTag is empty', () => {
    expect(buildModeConstraint(cust({ generationMode: 'art-theme', artThemeTag: '' }))).toBe('');
  });

  it('art-theme: slugifies multi-word artThemeTag', () => {
    expect(
      buildModeConstraint(cust({ generationMode: 'art-theme', artThemeTag: 'Sea Serpent' }))
    ).toBe('art:sea-serpent');
  });

  it('art-theme: returns empty string when artThemeTag is whitespace only', () => {
    expect(buildModeConstraint(cust({ generationMode: 'art-theme', artThemeTag: '   ' }))).toBe('');
  });

  it('historical: returns year<=YYYY', () => {
    expect(buildModeConstraint(cust({ generationMode: 'historical', historicalYear: 2000 }))).toBe(
      'year<=2000'
    );
  });

  it('oracle-role permanentsOnly=true: returns "is:permanent -t:land"', () => {
    expect(buildModeConstraint(cust({ generationMode: 'oracle-role', permanentsOnly: true }))).toBe(
      'is:permanent -t:land'
    );
  });

  it('oracle-role permanentsOnly=false: returns empty string', () => {
    expect(
      buildModeConstraint(cust({ generationMode: 'oracle-role', permanentsOnly: false }))
    ).toBe('');
  });

  it('edhrec: returns empty string', () => {
    expect(buildModeConstraint(cust({ generationMode: 'edhrec' }))).toBe('');
  });
});

// ── slugifyTag ────────────────────────────────────────────────────────────────

describe('slugifyTag', () => {
  it('"Sea Serpent" → "sea-serpent"', () => {
    expect(slugifyTag('Sea Serpent')).toBe('sea-serpent');
  });

  it('trims leading/trailing whitespace', () => {
    expect(slugifyTag('  dragon  ')).toBe('dragon');
  });

  it('strips punctuation and special characters', () => {
    expect(slugifyTag('fire & ice!')).toBe('fire-ice');
  });

  it('collapses multiple separators into one hyphen', () => {
    expect(slugifyTag('wolf---pack')).toBe('wolf-pack');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugifyTag('--moon--')).toBe('moon');
  });

  it('lowercases the result', () => {
    expect(slugifyTag('ZOMBIE')).toBe('zombie');
  });

  it('handles already-slugified input unchanged', () => {
    expect(slugifyTag('sea-serpent')).toBe('sea-serpent');
  });

  it('returns empty string for blank input', () => {
    expect(slugifyTag('   ')).toBe('');
  });
});

// ── buildAlternatePool — oracle-role ─────────────────────────────────────────

describe('buildAlternatePool — oracle-role', () => {
  it('synthesizes EDHRECCommanderData with cardlists categorized by primary_type', async () => {
    // Return a mixed set for any search
    const creatures = makeCards(5, 'Creature', 1);
    const instants = makeCards(3, 'Instant', 100);
    const sorceries = makeCards(3, 'Sorcery', 200);

    searchCards.mockResolvedValue(okResponse([...creatures, ...instants, ...sorceries]));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    expect(result.dataSource).toBe('oracle-role');
    expect(result.data.cardlists.creatures.length).toBeGreaterThan(0);
    // Lands must never appear in allNonLand
    expect(result.data.cardlists.allNonLand.every((c) => c.primary_type !== 'Land')).toBe(true);
  });

  it('allNonLand excludes land cards', async () => {
    const cards = [
      ...makeCards(5, 'Creature', 1),
      ...makeCards(2, 'Basic Land — Forest', 50),
      ...makeCards(2, 'Land', 60),
    ];
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    const allNonLand = result.data.cardlists.allNonLand;
    expect(allNonLand.every((c) => c.primary_type !== 'Land')).toBe(true);
    expect(result.data.cardlists.lands).toEqual([]); // synthesize never pushes to lands
  });

  it('inclusion is monotonic-decreasing by edhrec_rank (best rank → highest inclusion)', async () => {
    // Cards with ascending edhrec_rank (lower = better)
    const cards = Array.from({ length: 5 }, (_, i) =>
      sc({ name: `Card ${i}`, type_line: 'Instant', edhrec_rank: i + 1 })
    );
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    const nonLand = result.data.cardlists.allNonLand;
    // Sorted by rank ascending → inclusion should be descending
    for (let i = 0; i < nonLand.length - 1; i++) {
      expect(nonLand[i].inclusion).toBeGreaterThanOrEqual(nonLand[i + 1].inclusion);
    }
  });

  it('flexible multi-facet cards get synergy>0 and isThemeSynergyCard=true', async () => {
    // A card that appears in multiple facet results will accumulate flexHits.
    // Mock every facet to return the same card set (triggering dedup + flexHits counting).
    const sharedCard = sc({ name: 'Multi-Role Star', type_line: 'Creature', edhrec_rank: 1 });
    // Return the shared card from every search call
    searchCards.mockResolvedValue(okResponse([sharedCard]));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    // With 10 ROLE_FACETS, the first facet (t:creature, non-flexible) adds it with flexHits=0,
    // then every subsequent flexible facet increments flexHits. After >=2 flexible hits, synergy>0.
    const star = result.data.cardlists.allNonLand.find((c) => c.name === 'Multi-Role Star');
    expect(star).toBeDefined();
    expect(star!.synergy).toBeGreaterThan(0);
    expect(star!.isThemeSynergyCard).toBe(true);
  });

  it('returns dataSource="oracle-role" and poolSize matches allNonLand.length', async () => {
    const cards = makeCards(10, 'Artifact', 1);
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    expect(result.poolSize).toBe(result.data.cardlists.allNonLand.length);
    expect(result.dataSource).toBe('oracle-role');
  });

  it('permanentsOnly detail is set when permanentsOnly=true', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Creature', 1)));
    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role', permanentsOnly: true }),
      ['G']
    );
    expect(result.detail).toBe('permanents only');
    expect(result.effectiveConstraint).toBe('is:permanent -t:land');
    // The permanents filter must also reach the pool queries themselves.
    expect(searchCards.mock.calls.every((c) => (c[0] as string).includes('is:permanent'))).toBe(
      true
    );
  });

  it('detail is undefined and no constraint when permanentsOnly=false', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Creature', 1)));
    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role', permanentsOnly: false }),
      ['G']
    );
    expect(result.detail).toBeUndefined();
    expect(result.effectiveConstraint).toBe('');
  });
});

// ── buildAlternatePool — art-theme ───────────────────────────────────────────

describe('buildAlternatePool — art-theme', () => {
  it('empty artThemeTag → poolSize 0 and empty data (no searchCards call)', async () => {
    const result = await buildAlternatePool(
      'art-theme',
      cust({ generationMode: 'art-theme', artThemeTag: '' }),
      ['G']
    );

    expect(result.poolSize).toBe(0);
    expect(result.dataSource).toBe('art-theme');
    expect(result.data.cardlists.allNonLand).toEqual([]);
    expect(searchCards).not.toHaveBeenCalled();
  });

  it('whitespace-only artThemeTag → poolSize 0', async () => {
    const result = await buildAlternatePool(
      'art-theme',
      cust({ generationMode: 'art-theme', artThemeTag: '   ' }),
      ['G']
    );
    expect(result.poolSize).toBe(0);
    expect(searchCards).not.toHaveBeenCalled();
  });

  it('valid artThemeTag → calls searchCards with art:<slug> and populates pool', async () => {
    const cards = makeCards(8, 'Creature', 1);
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'art-theme',
      cust({ generationMode: 'art-theme', artThemeTag: 'dragon' }),
      ['G']
    );

    expect(searchCards).toHaveBeenCalled();
    const query: string = searchCards.mock.calls[0][0];
    expect(query).toContain('art:dragon');
    expect(result.poolSize).toBeGreaterThan(0);
    expect(result.dataSource).toBe('art-theme');
    expect(result.detail).toBe('dragon');
    // The generator appends this verbatim to scryfallQuery to keep the strict
    // printing upgrade + fallback fills on the same art motif as the pool.
    expect(result.effectiveConstraint).toBe('art:dragon');
  });

  it('multi-word artThemeTag is slugified in the query', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(3, 'Enchantment', 1)));

    await buildAlternatePool(
      'art-theme',
      cust({ generationMode: 'art-theme', artThemeTag: 'Sea Serpent' }),
      ['G']
    );

    const query: string = searchCards.mock.calls[0][0];
    expect(query).toContain('art:sea-serpent');
  });
});

// ── buildAlternatePool — historical ──────────────────────────────────────────

describe('buildAlternatePool — historical', () => {
  it('returns dataSource="historical" with detail="year<=YYYY"', async () => {
    // Enough cards on the first attempt (requested year)
    const cards = makeCards(80, 'Creature', 1);
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'historical',
      cust({ generationMode: 'historical', historicalYear: 2000 }),
      ['G']
    );

    expect(result.dataSource).toBe('historical');
    expect(result.detail).toMatch(/^year<=/);
    expect(result.relaxedNote).toBeUndefined();
  });

  it('steps forward and sets relaxedNote when first year yields < 70 nonland cards', async () => {
    const requestedYear = 1995;
    // Return few cards for the initial (low-year) queries, many for the bumped year.
    // The query arg contains "year<=<year>" — inspect it to vary results.
    searchCards.mockImplementation((...args: unknown[]) => {
      const query = args[0] as string | undefined;
      // bump=0 → year=1995, bump=5 → year=2000 (enough)
      if (typeof query === 'string' && query.includes(`year<=${requestedYear}`)) {
        // Too few to meet HISTORICAL_MIN_POOL (70)
        return Promise.resolve(okResponse(makeCards(3, 'Creature', 1)));
      }
      // Any relaxed year → enough cards
      return Promise.resolve(okResponse(makeCards(80, 'Creature', 10)));
    });

    const result = await buildAlternatePool(
      'historical',
      cust({ generationMode: 'historical', historicalYear: requestedYear }),
      ['G']
    );

    expect(result.dataSource).toBe('historical');
    expect(result.relaxedNote).toBeDefined();
    expect(result.relaxedNote).toContain(String(requestedYear));
    // The relaxed year should be in the detail
    expect(result.detail).not.toBe(`year<=${requestedYear}`);
    // Regression guard: the effective constraint (what the generator appends to
    // scryfallQuery for the strict printing upgrade) MUST reflect the RELAXED
    // year, not the requested one — otherwise the upgrade deletes the cards the
    // relaxed pool just fetched.
    expect(result.effectiveConstraint).toBe(result.detail);
    expect(result.effectiveConstraint).not.toBe(`year<=${requestedYear}`);
  });

  it('no relaxedNote when first year is sufficient', async () => {
    const cards = makeCards(90, 'Artifact', 1);
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'historical',
      cust({ generationMode: 'historical', historicalYear: 2005 }),
      ['G']
    );

    expect(result.relaxedNote).toBeUndefined();
    expect(result.detail).toBe('year<=2005');
  });
});

// ── primaryType bucketing edge cases ─────────────────────────────────────────

describe('primaryType bucketing via synthesize (observed through buildAlternatePool)', () => {
  it('"Legendary Artifact Creature — God" is bucketed as Creature', async () => {
    const cards = [
      sc({ name: 'Theros God', type_line: 'Legendary Artifact Creature — God', edhrec_rank: 1 }),
    ];
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    // Should appear in creatures, not artifacts
    const inCreatures = result.data.cardlists.creatures.some((c) => c.name === 'Theros God');
    const inArtifacts = result.data.cardlists.artifacts.some((c) => c.name === 'Theros God');
    expect(inCreatures).toBe(true);
    expect(inArtifacts).toBe(false);
  });

  it('"Land" type line is excluded from allNonLand', async () => {
    const cards = [
      sc({ name: 'A Land', type_line: 'Land', edhrec_rank: 1 }),
      sc({ name: 'A Creature', type_line: 'Creature', edhrec_rank: 2 }),
    ];
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    const names = result.data.cardlists.allNonLand.map((c) => c.name);
    expect(names).not.toContain('A Land');
    expect(names).toContain('A Creature');
  });

  it('"Planeswalker" type line is bucketed as Planeswalker', async () => {
    const cards = [
      sc({ name: 'Teferi', type_line: 'Legendary Planeswalker — Teferi', edhrec_rank: 1 }),
    ];
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    expect(result.data.cardlists.planeswalkers.some((c) => c.name === 'Teferi')).toBe(true);
  });

  it('"Artifact Creature" is bucketed as Creature (Creature wins over Artifact)', async () => {
    const cards = [
      sc({ name: 'Myr Battlesphere', type_line: 'Artifact Creature — Myr', edhrec_rank: 1 }),
    ];
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    expect(result.data.cardlists.creatures.some((c) => c.name === 'Myr Battlesphere')).toBe(true);
    expect(result.data.cardlists.artifacts.some((c) => c.name === 'Myr Battlesphere')).toBe(false);
  });

  it('double-faced card type line — uses front face type', async () => {
    // e.g. "Creature — Werewolf // Creature — Werewolf" → front = Creature
    const cards = [
      sc({
        name: 'Huntmaster',
        type_line: 'Creature — Human Werewolf // Creature — Werewolf',
        edhrec_rank: 1,
      }),
    ];
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );

    expect(result.data.cardlists.creatures.some((c) => c.name === 'Huntmaster')).toBe(true);
  });

  it('uses the first face type line when top-level type line is missing', async () => {
    const cards = [
      sc({
        name: 'Blood Crypt // Blood Crypt',
        type_line: undefined as unknown as string,
        card_faces: [
          { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
          { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
        ] as ScryfallCard['card_faces'],
        edhrec_rank: 1,
      }),
    ];
    searchCards.mockResolvedValue(okResponse(cards));

    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['B', 'R']
    );

    expect(
      result.data.cardlists.allNonLand.some((c) => c.name === 'Blood Crypt // Blood Crypt')
    ).toBe(false);
    expect(
      result.data.cardlists.artifacts.some((c) => c.name === 'Blood Crypt // Blood Crypt')
    ).toBe(false);
  });
});

// ── emptyStats shape ──────────────────────────────────────────────────────────

describe('synthesized stats', () => {
  it('numDecks is 0 so downstream uses balanced fallback curve/type targets', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Creature', 1)));
    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );
    expect(result.data.stats.numDecks).toBe(0);
  });

  it('themes and similarCommanders arrays are empty', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Sorcery', 1)));
    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );
    expect(result.data.themes).toEqual([]);
    expect(result.data.similarCommanders).toEqual([]);
  });
});

// ── buildAlternatePool — Pauper Commander (E92) ──────────────────────────────

describe('buildAlternatePool — Pauper Commander', () => {
  const pdhCust = (overrides: Partial<Customization> = {}) =>
    cust({ mtgFormat: 'paupercommander', ...overrides });

  it('edhrec mode routes to the function-faceted pool with f:paupercommander, reported as its own source', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Creature', 1)));
    const result = await buildAlternatePool('edhrec', pdhCust(), ['G']);

    expect(result.dataSource).toBe('paupercommander');
    expect(result.effectiveConstraint).toBe('f:paupercommander');
    // Every pool facet query carries the PDH constraint.
    for (const call of searchCards.mock.calls) {
      expect(call[0]).toContain('f:paupercommander');
    }
  });

  it('oracle-role mode keeps its own dataSource but still constrains the pool', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Creature', 1)));
    const result = await buildAlternatePool(
      'oracle-role',
      pdhCust({ generationMode: 'oracle-role' }),
      ['G']
    );
    expect(result.dataSource).toBe('oracle-role');
    expect(result.effectiveConstraint).toContain('f:paupercommander');
  });

  it('art-theme mode composes the motif with the PDH constraint', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Creature', 1)));
    const result = await buildAlternatePool(
      'art-theme',
      pdhCust({ generationMode: 'art-theme', artThemeTag: 'dragon' }),
      ['G']
    );
    expect(result.effectiveConstraint).toBe('art:dragon f:paupercommander');
    expect(searchCards.mock.calls[0][0]).toContain('art:dragon');
    expect(searchCards.mock.calls[0][0]).toContain('f:paupercommander');
  });

  it('non-PDH builds are byte-identical: no constraint appended anywhere', async () => {
    searchCards.mockResolvedValue(okResponse(makeCards(5, 'Creature', 1)));
    const result = await buildAlternatePool(
      'oracle-role',
      cust({ generationMode: 'oracle-role' }),
      ['G']
    );
    expect(result.effectiveConstraint).toBe('');
    for (const call of searchCards.mock.calls) {
      expect(call[0]).not.toContain('f:paupercommander');
    }
  });
});
