import { describe, it, expect } from 'vitest';
import {
  isLegendCandidate,
  legendIdentityOf,
  distributeLegendQuota,
  selectLegends,
  selectBackgrounds,
  partnerKindOf,
  partnerNameOf,
  isPartnerLegend,
  isChooseABackgroundLegend,
  isBackground,
  legendKindLabel,
  LEGEND_TARGET,
  type LegendIdentity,
  type LegendPick,
} from './legend';
import { COLOR_PAIRS } from './core';
import type { CubeCard } from './core';
import type { CubeSize } from './targets';

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['W'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Human',
    role: p.role ?? null,
    rank: p.rank,
    cubePop: p.cubePop,
    cubeElo: p.cubeElo,
    colorIdentity: p.colorIdentity,
    producedMana: p.producedMana,
    oracleText: p.oracleText,
  };
}

describe('isLegendCandidate', () => {
  it('is true for a legendary creature', () => {
    expect(isLegendCandidate(card({ typeLine: 'Legendary Creature — Human Wizard' }))).toBe(true);
  });

  it('is false for a nonlegendary creature and a legendary noncreature', () => {
    expect(isLegendCandidate(card({ typeLine: 'Creature — Human Wizard' }))).toBe(false);
    expect(isLegendCandidate(card({ typeLine: 'Legendary Sorcery' }))).toBe(false);
  });

  it('is true for oracle text carrying "can be your commander" (planeswalkers, backgrounds)', () => {
    expect(
      isLegendCandidate(
        card({
          typeLine: 'Legendary Planeswalker — Daretti',
          oracleText: 'Daretti, Scrap Savant can be your commander.',
        })
      )
    ).toBe(true);
  });

  it('is false for a legendary planeswalker with no such text', () => {
    expect(
      isLegendCandidate(
        card({ typeLine: 'Legendary Planeswalker — Jace', oracleText: '+1: Draw a card.' })
      )
    ).toBe(false);
  });
});

describe('legendIdentityOf', () => {
  it('classifies mono, pair, and other (3+/colorless)', () => {
    expect(legendIdentityOf(card({ colors: ['G'] }))).toBe('G');
    expect(legendIdentityOf(card({ colors: ['B', 'R'] }))).toBe('BR');
    expect(legendIdentityOf(card({ colors: ['W', 'U', 'B'] }))).toBe('other');
    expect(legendIdentityOf(card({ colors: [] }))).toBe('other');
  });

  it('prefers colorIdentity over colors when both are present', () => {
    // A hybrid/hint card whose cast colors differ from its command-zone identity.
    expect(legendIdentityOf(card({ colors: ['G'], colorIdentity: ['G', 'W'] }))).toBe('GW');
  });
});

describe('distributeLegendQuota', () => {
  const ALL_BUCKETS: LegendIdentity[] = ['W', 'U', 'B', 'R', 'G', ...COLOR_PAIRS, 'other'];

  function fullSupply(perBucket = 20): Record<LegendIdentity, CubeCard[]> {
    const supply = {} as Record<LegendIdentity, CubeCard[]>;
    for (const b of ALL_BUCKETS) supply[b] = Array.from({ length: perBucket }, () => card({}));
    return supply;
  }

  it('sums to the target when supply is abundant everywhere', () => {
    const out = distributeLegendQuota(100, fullSupply());
    const total = ALL_BUCKETS.reduce((s, b) => s + out[b], 0);
    expect(total).toBe(100);
  });

  it('gives every supplied bucket at least one slot (coverage guarantee)', () => {
    const out = distributeLegendQuota(100, fullSupply(3));
    for (const b of ALL_BUCKETS) expect(out[b]).toBeGreaterThanOrEqual(1);
  });

  it('caps a bucket at its own supply rather than over-allocating', () => {
    const supply = fullSupply();
    supply.G = [card({}), card({})]; // only 2 green legends owned
    const out = distributeLegendQuota(100, supply);
    expect(out.G).toBeLessThanOrEqual(2);
    // the rest of the target still lands somewhere else
    const total = ALL_BUCKETS.reduce((s, b) => s + out[b], 0);
    expect(total).toBeGreaterThan(90);
  });

  it('never exceeds the target even when supply is scarce everywhere', () => {
    const out = distributeLegendQuota(60, fullSupply(1));
    const total = ALL_BUCKETS.reduce((s, b) => s + out[b], 0);
    expect(total).toBeLessThanOrEqual(60);
    expect(total).toBe(ALL_BUCKETS.length); // exactly 1 each, since supply=1 everywhere
  });

  it('gives no slots to a bucket with zero supply', () => {
    const supply = fullSupply();
    supply.other = [];
    const out = distributeLegendQuota(100, supply);
    expect(out.other).toBe(0);
  });
});

describe('LEGEND_TARGET', () => {
  it('covers every offered cube size with a positive, additional count', () => {
    const sizes: CubeSize[] = [180, 270, 360, 450, 540, 720];
    for (const size of sizes) expect(LEGEND_TARGET[size]).toBeGreaterThan(0);
    // Rising with pod headroom, never a flat ratio of size (design doc finding 2).
    expect(LEGEND_TARGET[720] / 720).toBeLessThan(LEGEND_TARGET[180] / 180);
  });
});

describe('selectLegends', () => {
  function pool(): CubeCard[] {
    const cards: CubeCard[] = [];
    const colorSets: CubeCard['colors'][] = [
      ['W'],
      ['U'],
      ['B'],
      ['R'],
      ['G'],
      ['W', 'U'],
      ['B', 'R'],
      ['R', 'G'],
    ];
    for (const colors of colorSets) {
      for (let i = 0; i < 10; i++) {
        cards.push(
          card({
            colors,
            typeLine: 'Legendary Creature — Test',
            cubePop: 10 - i,
            rank: i,
          })
        );
      }
    }
    // Plenty of ordinary (non-legendary) spells too, so "already picked" has
    // real cards to exclude from and legends aren't the whole pool.
    for (let i = 0; i < 50; i++) cards.push(card({ typeLine: 'Instant', rank: 1000 + i }));
    return cards;
  }

  it('returns exactly the size target when the pool comfortably supports it', () => {
    const p = pool();
    const legends = selectLegends(p, 180, new Set());
    expect(legends.length).toBe(LEGEND_TARGET[180]);
  });

  it('excludes anything already placed as a spell', () => {
    const p = pool();
    const firstLegend = p.find((c) => /legendary/i.test(c.typeLine))!;
    const legends = selectLegends(p, 180, new Set([firstLegend.oracleId]));
    expect(legends.some((l) => l.card.oracleId === firstLegend.oracleId)).toBe(false);
  });

  it('never includes a nonlegendary card', () => {
    const p = pool();
    const legends = selectLegends(p, 360, new Set());
    for (const l of legends) expect(isLegendCandidate(l.card)).toBe(true);
  });

  it('picks the best-ranked candidates first within a bucket', () => {
    const p = pool();
    const legends = selectLegends(p, 180, new Set());
    const mono = legends.filter((l) => l.identity === 'W').map((l) => l.card);
    const sortedByPop = [...mono].sort((a, b) => (b.cubePop ?? 0) - (a.cubePop ?? 0));
    expect(mono.map((c) => c.oracleId)).toEqual(sortedByPop.map((c) => c.oracleId));
  });

  it('is a no-op (empty) when the pool has no legend candidates', () => {
    const p = Array.from({ length: 50 }, (_, i) => card({ typeLine: 'Instant', rank: i }));
    expect(selectLegends(p, 360, new Set())).toEqual([]);
  });
});

// ── Partner / Background (board E462) ───────────────────────────────────────

describe('partnerKindOf / partnerNameOf / isPartnerLegend', () => {
  it('recognizes plain Partner', () => {
    const c = card({ oracleText: 'First strike, menace\nPartner (You can have two commanders…)' });
    expect(partnerKindOf(c)).toBe('partner');
    expect(isPartnerLegend(c)).toBe(true);
    expect(partnerNameOf(c)).toBeNull();
  });

  it('recognizes Partner with <Name> and captures the exact name', () => {
    const c = card({
      oracleText: 'Partner with Haldan, Avid Arcanist (When this creature enters…)',
    });
    expect(partnerKindOf(c)).toBe('partner-with');
    expect(partnerNameOf(c)).toBe('Haldan, Avid Arcanist');
  });

  it("recognizes Friends forever and Doctor's companion", () => {
    expect(partnerKindOf(card({ oracleText: 'Friends forever (…)' }))).toBe('friends-forever');
    expect(partnerKindOf(card({ oracleText: "Doctor's companion (…)" }))).toBe('doctors-companion');
  });

  it('is null for an ordinary legend with no Partner keyword', () => {
    const c = card({ oracleText: 'Flying, vigilance' });
    expect(partnerKindOf(c)).toBeNull();
    expect(isPartnerLegend(c)).toBe(false);
  });
});

describe('isChooseABackgroundLegend / isBackground / legendKindLabel', () => {
  it('recognizes a chooser by oracle text, case-insensitively', () => {
    expect(isChooseABackgroundLegend(card({ oracleText: 'Choose a Background (…)' }))).toBe(true);
    expect(isChooseABackgroundLegend(card({ oracleText: 'choose a background (…)' }))).toBe(true);
    expect(isChooseABackgroundLegend(card({ oracleText: 'Flying' }))).toBe(false);
  });

  it('recognizes a Background by type line alone, never by oracle text', () => {
    const bg = card({ typeLine: 'Legendary Enchantment — Background', oracleText: 'Whenever…' });
    expect(isBackground(bg)).toBe(true);
    expect(isBackground(card({ typeLine: 'Legendary Enchantment — Background' }))).toBe(true);
    expect(
      isBackground(card({ typeLine: 'Legendary Creature — Human', oracleText: 'Background' }))
    ).toBe(false);
  });

  it('labels Partner-family and Background/chooser cards, and nothing else', () => {
    expect(legendKindLabel(card({ oracleText: 'Partner (…)' }))).toBe('Partner');
    expect(legendKindLabel(card({ oracleText: "Doctor's companion (…)" }))).toBe('Partner');
    expect(legendKindLabel(card({ oracleText: 'Choose a Background (…)' }))).toBe('Background');
    expect(legendKindLabel(card({ typeLine: 'Legendary Enchantment — Background' }))).toBe(
      'Background'
    );
    expect(legendKindLabel(card({ oracleText: 'Flying' }))).toBeNull();
  });
});

describe('selectBackgrounds', () => {
  function chooserPick(overrides: Partial<CubeCard> = {}): LegendPick {
    const c = card({
      typeLine: 'Legendary Creature — Test',
      oracleText: 'Choose a Background (…)',
      colors: ['W'],
      ...overrides,
    });
    return { card: c, identity: 'W', reason: 'test chooser' };
  }
  function backgroundCard(overrides: Partial<CubeCard> = {}): CubeCard {
    return card({
      typeLine: 'Legendary Enchantment — Background',
      colors: ['W'],
      cubePop: 0.5,
      ...overrides,
    });
  }

  it('adds nothing when there is no choose-a-Background legend', () => {
    const legends = [
      {
        card: card({ typeLine: 'Legendary Creature — Test' }),
        identity: 'W',
        reason: 'x',
      } as LegendPick,
    ];
    const pool = [backgroundCard(), backgroundCard()];
    expect(selectBackgrounds(legends, pool, new Set())).toEqual([]);
  });

  it('pairs one Background per chooser when supply is plentiful', () => {
    const legends = [chooserPick(), chooserPick({ colors: ['U'] })];
    const pool = [
      backgroundCard({ cubePop: 0.9 }),
      backgroundCard({ cubePop: 0.7, colors: ['U'] }),
      backgroundCard({ cubePop: 0.3 }),
    ];
    const picks = selectBackgrounds(legends, pool, new Set());
    expect(picks).toHaveLength(2);
    for (const p of picks) expect(isBackground(p.card)).toBe(true);
  });

  it('prefers a colour-matching Background over a higher-quality mismatch', () => {
    const legends = [chooserPick({ colors: ['U'] })]; // one U chooser
    const pool = [
      backgroundCard({ cubePop: 0.99, colors: ['R'] }), // best quality, wrong colour
      backgroundCard({ cubePop: 0.2, colors: ['U'] }), // worse quality, matches
    ];
    const picks = selectBackgrounds(legends, pool, new Set());
    expect(picks).toHaveLength(1);
    expect(picks[0].card.colors).toEqual(['U']);
  });

  it('takes whatever supply exists when short of one-per-chooser', () => {
    const legends = [chooserPick(), chooserPick({ colors: ['U'] }), chooserPick({ colors: ['B'] })];
    const pool = [backgroundCard()]; // only one Background owned
    const picks = selectBackgrounds(legends, pool, new Set());
    expect(picks).toHaveLength(1);
  });

  it('never picks a banned Background (absent from pool) or one already used as a spell', () => {
    const legends = [chooserPick(), chooserPick({ colors: ['U'] })];
    const bannedAwayBg = backgroundCard({ cubePop: 0.99 }); // simulates a ban: just not in pool
    const lockedAsSpell = backgroundCard({ cubePop: 0.9, oracleId: 'locked-bg' });
    const available = backgroundCard({ cubePop: 0.5, oracleId: 'available-bg' });
    const pool = [lockedAsSpell, available]; // bannedAwayBg deliberately omitted from pool
    const picks = selectBackgrounds(legends, pool, new Set(['locked-bg']));
    expect(picks.map((p) => p.card.oracleId)).toEqual(['available-bg']);
    expect(picks.some((p) => p.card.oracleId === bannedAwayBg.oracleId)).toBe(false);
  });
});
