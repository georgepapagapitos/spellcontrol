/**
 * Unit tests for the deck-analysis library. Exercises the pure analysis
 * pipeline (composition, curve verdict, role classification via tagger,
 * color-identity check, format-aware deficit detection).
 *
 * Tagger data is module-cached at the singleton level — tests that need a
 * specific tag set call `loadTaggerWithTags()` which resets the module
 * registry, primes a fetch mock, and re-imports both the tagger client AND
 * deck-analysis so they share the same module instance. Otherwise
 * `deck-analysis.ts`'s top-level imports would bind to a stale tagger.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { analyzeDeck as AnalyzeDeck } from './deck-analysis';

beforeEach(() => {
  vi.resetModules();
});

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    oracle_id: 'oid-1',
    name: 'Test Card',
    mana_cost: '{2}{G}',
    cmc: 3,
    type_line: 'Creature — Beast',
    oracle_text: '',
    color_identity: ['G'],
    colors: ['G'],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    image_uris: { normal: 'https://example.com/img.jpg' },
    legalities: { commander: 'legal' },
    layout: 'normal',
    ...overrides,
  } as ScryfallCard;
}

function slot(card: ScryfallCard, slotId = `slot-${Math.random().toString(36).slice(2, 8)}`) {
  return { slotId, card };
}

/**
 * Load deck-analysis WITHOUT priming the tagger — used by tests that
 * don't depend on role classification. Returns a fresh module instance
 * so prior test mutations don't leak.
 */
async function loadDeckAnalysis() {
  return import('./deck-analysis');
}

/**
 * Prime the tagger fetch mock, load the tagger so its module-level cache
 * is populated, then return the freshly-imported deck-analysis module so
 * both share the same `tagSets` instance.
 */
async function loadDeckAnalysisWithTags(tags: Record<string, string[]>): Promise<{
  analyzeDeck: typeof AnalyzeDeck;
  classifyCandidate: typeof import('./deck-analysis').classifyCandidate;
  getRoleDeficits: typeof import('./deck-analysis').getRoleDeficits;
}> {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ generatedAt: 'test', tags }),
  }) as unknown as typeof fetch;

  const tagger = await import('@/deck-builder/services/tagger/client');
  await tagger.loadTaggerData();
  return import('./deck-analysis');
}

describe('analyzeDeck — composition', () => {
  it('counts cards against the format expected size', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = Array.from({ length: 50 }, () => slot(makeCard()));
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.totalNonCommander).toBe(50);
    expect(result.expectedSize).toBe(99);
    expect(result.sizeDelta).toBe(-49);
  });

  it('buckets type lines including front-face split cards', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = [
      slot(makeCard({ type_line: 'Creature — Beast' })),
      slot(makeCard({ type_line: 'Instant' })),
      slot(makeCard({ type_line: 'Sorcery' })),
      slot(makeCard({ type_line: 'Artifact — Equipment' })),
      slot(makeCard({ type_line: 'Enchantment — Aura' })),
      slot(makeCard({ type_line: 'Planeswalker — Jace' })),
      slot(makeCard({ type_line: 'Battle — Siege' })),
      slot(makeCard({ type_line: 'Land' })),
      slot(makeCard({ type_line: 'Land // Creature' })), // front face = Land
    ];
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.types.creatures).toBe(1);
    expect(result.types.instants).toBe(1);
    expect(result.types.sorceries).toBe(1);
    expect(result.types.artifacts).toBe(1);
    expect(result.types.enchantments).toBe(1);
    expect(result.types.planeswalkers).toBe(1);
    expect(result.types.battles).toBe(1);
    expect(result.types.lands).toBe(2);
  });

  it('falls back to "other" for unknown type lines', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const result = analyzeDeck(
      {
        format: 'commander',
        commander: null,
        partnerCommander: null,
        mainboard: [slot(makeCard({ type_line: 'Phenomenon' }))],
      },
      false
    );
    expect(result.types.other).toBe(1);
  });
});

describe('analyzeDeck — curve', () => {
  it('excludes lands from curve buckets and averages', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = [
      slot(makeCard({ cmc: 1, type_line: 'Creature' })),
      slot(makeCard({ cmc: 2, type_line: 'Creature' })),
      slot(makeCard({ cmc: 3, type_line: 'Creature' })),
      slot(makeCard({ cmc: 0, type_line: 'Land' })),
    ];
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.curve.averageCmc).toBeCloseTo(2, 5);
    expect(result.curve.buckets[0].count).toBe(0);
    expect(result.curve.buckets[1].count).toBe(1);
    expect(result.curve.buckets[2].count).toBe(1);
    expect(result.curve.buckets[3].count).toBe(1);
  });

  it('caps the curve into a 7+ bucket', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = [
      slot(makeCard({ cmc: 7, type_line: 'Creature' })),
      slot(makeCard({ cmc: 10, type_line: 'Creature' })),
      slot(makeCard({ cmc: 15, type_line: 'Creature' })),
    ];
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.curve.buckets[7].count).toBe(3);
  });

  it('flags top-heavy curves at avg >= 3.8', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = Array.from({ length: 5 }, () =>
      slot(makeCard({ cmc: 4, type_line: 'Creature' }))
    );
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.curve.verdict).toBe('top-heavy');
    expect(result.curve.message).toMatch(/top-heavy/i);
  });

  it('flags low-curve decks under avg 2.5', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = [
      slot(makeCard({ cmc: 1, type_line: 'Creature' })),
      slot(makeCard({ cmc: 2, type_line: 'Creature' })),
      slot(makeCard({ cmc: 2, type_line: 'Creature' })),
    ];
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.curve.verdict).toBe('low-curve');
  });

  it('uses curve-ok for empty decks (avg = 0)', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: [] },
      false
    );
    expect(result.curve.verdict).toBe('curve-ok');
    expect(result.curve.averageCmc).toBe(0);
  });

  it('ignores cards with missing or NaN cmc', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = [
      slot(makeCard({ cmc: NaN, type_line: 'Creature' })),
      slot(makeCard({ cmc: undefined as unknown as number, type_line: 'Creature' })),
      slot(makeCard({ cmc: 3, type_line: 'Creature' })),
    ];
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.curve.averageCmc).toBeCloseTo(3, 5);
  });
});

describe('analyzeDeck — color identity check', () => {
  it('returns no off-color cards when there is no commander', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = [slot(makeCard({ color_identity: ['R'] }))];
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.colorIdentity.commanderColors).toEqual([]);
    expect(result.colorIdentity.offColorCards).toEqual([]);
  });

  it('flags cards with color identity outside commander pair', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const commander = makeCard({ name: 'Cmd', color_identity: ['W', 'U'] });
    const inIdentity = slot(makeCard({ name: 'Counterspell', color_identity: ['U'] }));
    const offIdentity = slot(makeCard({ name: 'Lightning Bolt', color_identity: ['R'] }));
    const result = analyzeDeck(
      {
        format: 'commander',
        commander,
        partnerCommander: null,
        mainboard: [inIdentity, offIdentity],
      },
      false
    );
    expect(result.colorIdentity.commanderColors.sort()).toEqual(['U', 'W']);
    expect(result.colorIdentity.offColorCards).toHaveLength(1);
    expect(result.colorIdentity.offColorCards[0].cardName).toBe('Lightning Bolt');
    expect(result.colorIdentity.offColorCards[0].offColors).toEqual(['R']);
  });

  it('unions partner commander colors into the allowed identity', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const commander = makeCard({ name: 'A', color_identity: ['W'] });
    const partner = makeCard({ name: 'B', color_identity: ['U'] });
    const blueCard = slot(makeCard({ name: 'Blue', color_identity: ['U'] }));
    const result = analyzeDeck(
      {
        format: 'commander',
        commander,
        partnerCommander: partner,
        mainboard: [blueCard],
      },
      false
    );
    expect(result.colorIdentity.offColorCards).toHaveLength(0);
  });
});

describe('analyzeDeck — roles (tagger-driven)', () => {
  it('returns "low" status for every non-land role when tagger is not ready', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const cards = Array.from({ length: 30 }, () => slot(makeCard({ type_line: 'Creature' })));
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: cards },
      false
    );
    expect(result.taggerReady).toBe(false);
    const lands = result.roles.find((r) => r.key === 'lands')!;
    expect(lands.count).toBe(0);
    expect(lands.status).toBe('low');
    const ramp = result.roles.find((r) => r.key === 'ramp')!;
    expect(ramp.count).toBe(0);
    expect(ramp.status).toBe('low');
  });

  it('classifies cards into all matching roles when tagger is ready', async () => {
    const { analyzeDeck } = await loadDeckAnalysisWithTags({
      ramp: ['Sol Ring'],
      'mana-rock': ['Sol Ring'],
      removal: ['Beast Within'],
      boardwipe: ['Wrath of God'],
      draw: ['Rhystic Study'],
      'card-advantage': ['Rhystic Study'],
    });

    const mainboard = [
      slot(makeCard({ name: 'Sol Ring', type_line: 'Artifact' })),
      slot(makeCard({ name: 'Beast Within', type_line: 'Instant' })),
      slot(makeCard({ name: 'Wrath of God', type_line: 'Sorcery' })),
      slot(makeCard({ name: 'Rhystic Study', type_line: 'Enchantment' })),
      slot(makeCard({ name: 'Forest', type_line: 'Basic Land — Forest' })),
    ];

    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard },
      true
    );
    expect(result.taggerReady).toBe(true);

    const role = (key: string) => result.roles.find((r) => r.key === key)!;
    expect(role('ramp').count).toBe(1);
    expect(role('removal').count).toBe(1);
    expect(role('boardwipe').count).toBe(1);
    expect(role('cardDraw').count).toBe(1);
    expect(role('lands').count).toBe(1);
  });

  it('produces status="ok" when role count falls within the format target band', async () => {
    const rampNames = Array.from({ length: 10 }, (_, i) => `Ramp ${i}`);
    const { analyzeDeck } = await loadDeckAnalysisWithTags({ ramp: rampNames });
    const mainboard = rampNames.map((name) => slot(makeCard({ name, type_line: 'Artifact' })));
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard },
      true
    );
    const ramp = result.roles.find((r) => r.key === 'ramp')!;
    expect(ramp.status).toBe('ok');
    expect(ramp.message).toMatch(/healthy/i);
  });

  it('produces status="high" when role count exceeds the format ceiling', async () => {
    const rampNames = Array.from({ length: 20 }, (_, i) => `Ramp ${i}`);
    const { analyzeDeck } = await loadDeckAnalysisWithTags({ ramp: rampNames });
    const mainboard = rampNames.map((name) => slot(makeCard({ name, type_line: 'Artifact' })));
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard },
      true
    );
    const ramp = result.roles.find((r) => r.key === 'ramp')!;
    expect(ramp.status).toBe('high');
    expect(ramp.message).toMatch(/over/i);
  });

  it('scales role targets down for non-commander formats', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const result = analyzeDeck(
      { format: 'standard', commander: null, partnerCommander: null, mainboard: [] },
      false
    );
    const ramp = result.roles.find((r) => r.key === 'ramp')!;
    expect(ramp.range).toEqual([0, 4]);
    expect(ramp.status).toBe('ok');
  });

  it('uses land-specific copy in the lands message', async () => {
    const { analyzeDeck } = await loadDeckAnalysis();
    const result = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: [] },
      false
    );
    const lands = result.roles.find((r) => r.key === 'lands')!;
    expect(lands.message).toMatch(/below the floor/i);
  });
});

describe('getRoleDeficits + classifyCandidate', () => {
  it('returns deficient roles in severity order (largest deficit first), excluding lands', async () => {
    const { analyzeDeck, getRoleDeficits } = await loadDeckAnalysis();
    const analysis = analyzeDeck(
      { format: 'commander', commander: null, partnerCommander: null, mainboard: [] },
      true
    );
    const deficits = getRoleDeficits(analysis);
    expect(deficits).not.toContain('lands');
    // Largest deficit first: ramp (8) and cardDraw (8) tie, then removal
    // (5), then boardwipe (2). Boardwipe must be last.
    expect(deficits[0]).toMatch(/ramp|cardDraw/);
    expect(deficits[deficits.length - 1]).toBe('boardwipe');
  });

  it('classifyCandidate returns null when tagger is unavailable', async () => {
    const { classifyCandidate } = await loadDeckAnalysis();
    expect(classifyCandidate('Anything')).toBeNull();
  });

  it('classifyCandidate exposes the tagger primary-role result', async () => {
    const { classifyCandidate } = await loadDeckAnalysisWithTags({ ramp: ['Sol Ring'] });
    expect(classifyCandidate('Sol Ring')).toBe('ramp');
    expect(classifyCandidate('Unknown Card')).toBeNull();
  });
});
