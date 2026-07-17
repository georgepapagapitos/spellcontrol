import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import {
  computeHiddenGems,
  hiddenGemReason,
  hiddenGemSignalCopy,
  GEM_INCLUSION_CEILING,
  MAX_GEMS,
} from './hiddenGems';
import { clearPackageBoostCache } from './packageBoost';

function sCard(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line: 'Creature — Human',
    oracle_text: '',
    color_identity: ['U'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  };
}

function eCard(name: string, inclusion: number, over: Partial<EDHRECCard> = {}): EDHRECCard {
  return { name, sanitized: name, primary_type: 'Creature', inclusion, num_decks: 0, ...over };
}

function edhrec(allNonLand: EDHRECCard[] = []): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 0,
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
      allNonLand,
    },
    similarCommanders: [],
  };
}

const commander = sCard('Test Commander', { type_line: 'Legendary Creature — Wizard' });

function resolverFor(pool: ScryfallCard[]) {
  const byName = new Map(pool.map((c) => [c.name.toLowerCase(), c]));
  return vi.fn(async (names: string[]) => {
    const out = new Map<string, ScryfallCard>();
    for (const n of names) {
      const hit = byName.get(n.toLowerCase());
      if (hit) out.set(hit.name, hit);
    }
    return out;
  });
}

function lift(entries: Record<string, { clusterScore: number; liftedBy: string[] }>) {
  return new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
}

const baseOpts = {
  deckCards: [] as ScryfallCard[],
  commanders: [commander],
  colorIdentity: ['U'],
  edhrecData: edhrec(),
  gapNames: [] as string[],
};

beforeEach(() => clearPackageBoostCache());

describe('computeHiddenGems — lift signal', () => {
  it('surfaces a multi-seed lift candidate with the seed names', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      liftIndex: lift({ 'Hidden Pick': { clusterScore: 500, liftedBy: ['Seed A', 'Seed B'] } }),
      resolveCards: resolverFor([sCard('Hidden Pick')]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Hidden Pick');
    expect(rows[0].signals).toEqual([{ kind: 'lift', names: ['Seed A', 'Seed B'] }]);
    expect(hiddenGemReason(rows[0])).toBe('Lifted by Seed A, Seed B');
  });

  it('requires at least two seed connections', async () => {
    const resolve = resolverFor([sCard('Thin Evidence')]);
    const rows = await computeHiddenGems({
      ...baseOpts,
      liftIndex: lift({ 'Thin Evidence': { clusterScore: 900, liftedBy: ['Seed A'] } }),
      resolveCards: resolve,
    });
    expect(rows).toHaveLength(0);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('never duplicates a gapAnalysis staple, a deck card, or a DFC front face', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      deckCards: [sCard('Aberrant // Mind')],
      gapNames: ['Staple Pick'],
      liftIndex: lift({
        'Staple Pick': { clusterScore: 500, liftedBy: ['A', 'B'] },
        Aberrant: { clusterScore: 400, liftedBy: ['A', 'B'] },
        'Test Commander': { clusterScore: 300, liftedBy: ['A', 'B'] },
      }),
      resolveCards: resolverFor([sCard('Staple Pick'), sCard('Aberrant'), commander]),
    });
    expect(rows).toHaveLength(0);
  });

  it('drops candidates at/above the inclusion ceiling and keeps low-inclusion ones', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      edhrecData: edhrec([eCard('Popular Pick', GEM_INCLUSION_CEILING), eCard('Fringe Pick', 4)]),
      liftIndex: lift({
        'Popular Pick': { clusterScore: 500, liftedBy: ['A', 'B'] },
        'Fringe Pick': { clusterScore: 400, liftedBy: ['A', 'B'] },
      }),
      resolveCards: resolverFor([sCard('Popular Pick'), sCard('Fringe Pick')]),
    });
    expect(rows.map((r) => r.name)).toEqual(['Fringe Pick']);
    expect(rows[0].inclusion).toBe(4);
  });
});

describe('computeHiddenGems — hard gates on the resolved card', () => {
  const liftTwo = (name: string) => lift({ [name]: { clusterScore: 500, liftedBy: ['A', 'B'] } });

  it('drops off-identity cards', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      liftIndex: liftTwo('Green Pick'),
      resolveCards: resolverFor([sCard('Green Pick', { color_identity: ['G'] })]),
    });
    expect(rows).toHaveLength(0);
  });

  it('drops cards not legal in commander', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      liftIndex: liftTwo('Banned Pick'),
      resolveCards: resolverFor([sCard('Banned Pick', { legalities: { commander: 'not_legal' } })]),
    });
    expect(rows).toHaveLength(0);
  });

  it('drops lands — that lane belongs to landUpgrades', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      liftIndex: liftTwo('Utility Land'),
      resolveCards: resolverFor([sCard('Utility Land', { type_line: 'Land' })]),
    });
    expect(rows).toHaveLength(0);
  });

  it('skips candidates the resolver could not find', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      liftIndex: liftTwo('Ghost Card'),
      resolveCards: resolverFor([]),
    });
    expect(rows).toHaveLength(0);
  });
});

describe('computeHiddenGems — similar signal', () => {
  it('surfaces a close substitute of an in-deck card', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      deckCards: [sCard('Rhystic Study', { type_line: 'Enchantment' })],
      similarRankFor: (name) => (name === 'Rhystic Study' ? new Map([['Mystic Remora', 1]]) : null),
      resolveCards: resolverFor([sCard('Mystic Remora', { type_line: 'Enchantment' })]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].signals).toEqual([{ kind: 'similar', names: ['Rhystic Study'] }]);
    expect(hiddenGemReason(rows[0])).toBe('Plays like Rhystic Study');
  });

  it('ignores matches deeper than the similar-rank window', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      deckCards: [sCard('Rhystic Study', { type_line: 'Enchantment' })],
      similarRankFor: (name) =>
        name === 'Rhystic Study' ? new Map([['Distant Cousin', 9]]) : null,
      resolveCards: resolverFor([sCard('Distant Cousin')]),
    });
    expect(rows).toHaveLength(0);
  });
});

describe('computeHiddenGems — axis signal', () => {
  // Real oracle text: three sac producers make the aristocrats axis live with
  // zero payoffs, so a payoff candidate completes the scarcer side.
  const sacDeck = [
    sCard('Viscera Seer', {
      color_identity: ['B'],
      oracle_text: 'Sacrifice a creature: Scry 1.',
    }),
    sCard('Carrion Feeder', {
      color_identity: ['B'],
      oracle_text: 'Sacrifice a creature: Put a +1/+1 counter on Carrion Feeder.',
    }),
    sCard('Yawgmoth, Thran Physician', {
      color_identity: ['B'],
      oracle_text:
        '{B}, Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.',
    }),
  ];
  const bloodArtist = sCard('Blood Artist', {
    color_identity: ['B'],
    oracle_text:
      'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
  });

  it('surfaces a low-inclusion tail card that completes a live engine', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      colorIdentity: ['B'],
      deckCards: sacDeck,
      edhrecData: edhrec([eCard('Blood Artist', 3, { synergy: 0.4 })]),
      resolveCards: resolverFor([bloodArtist]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].signals[0].kind).toBe('axis');
    expect(hiddenGemReason(rows[0])).toBe('Completes your Sacrifice / aristocrats engine');
  });

  it('gives no axis row when the deck has no live engine', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      colorIdentity: ['B'],
      deckCards: [],
      edhrecData: edhrec([eCard('Blood Artist', 3, { synergy: 0.4 })]),
      resolveCards: resolverFor([bloodArtist]),
    });
    expect(rows).toHaveLength(0);
  });
});

describe('computeHiddenGems — ranking and caps', () => {
  it('floats multi-signal candidates above single-signal ones', async () => {
    const rows = await computeHiddenGems({
      ...baseOpts,
      deckCards: [sCard('Rhystic Study', { type_line: 'Enchantment' })],
      liftIndex: lift({
        'Lift Only': { clusterScore: 9000, liftedBy: ['A', 'B'] },
        'Both Signals': { clusterScore: 100, liftedBy: ['A', 'B'] },
      }),
      similarRankFor: (name) => (name === 'Rhystic Study' ? new Map([['Both Signals', 0]]) : null),
      resolveCards: resolverFor([
        sCard('Lift Only'),
        sCard('Both Signals', { type_line: 'Enchantment' }),
      ]),
    });
    expect(rows.map((r) => r.name)).toEqual(['Both Signals', 'Lift Only']);
    expect(rows[0].signals.map((s) => s.kind).sort()).toEqual(['lift', 'similar']);
  });

  it('caps the lane at MAX_GEMS rows', async () => {
    const names = Array.from({ length: MAX_GEMS + 5 }, (_, i) => `Pick ${i}`);
    const rows = await computeHiddenGems({
      ...baseOpts,
      liftIndex: lift(
        Object.fromEntries(
          names.map((n, i) => [n, { clusterScore: 100 + i, liftedBy: ['A', 'B'] }])
        )
      ),
      resolveCards: resolverFor(names.map((n) => sCard(n))),
    });
    expect(rows).toHaveLength(MAX_GEMS);
  });

  it('returns [] without resolving when no signal produced a candidate', async () => {
    const resolve = resolverFor([]);
    const rows = await computeHiddenGems({ ...baseOpts, resolveCards: resolve });
    expect(rows).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('hiddenGemSignalCopy', () => {
  it('uses the fixed vocabulary for all three kinds', () => {
    expect(hiddenGemSignalCopy({ kind: 'lift', names: ['A', 'B'] })).toBe('Lifted by A, B');
    expect(hiddenGemSignalCopy({ kind: 'similar', names: ['X'] })).toBe('Plays like X');
    expect(hiddenGemSignalCopy({ kind: 'axis', names: ['Tokens / go-wide'] })).toBe(
      'Completes your Tokens / go-wide engine'
    );
  });

  it('combines multiple signals with the mid-dot separator', () => {
    expect(
      hiddenGemReason({
        signals: [
          { kind: 'lift', names: ['A'] },
          { kind: 'similar', names: ['X'] },
        ],
      })
    ).toBe('Lifted by A · Plays like X');
  });
});
