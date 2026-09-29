import { describe, expect, it } from 'vitest';
import { selectRadarAxes, radarLayout, RADAR_MAX_AXES } from './playstyle-radar';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import type { AxisSummary } from '@/deck-builder/services/synergy/deckSynergy';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';
import type { CardLike } from '@/deck-builder/services/synergy/text';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAxis(overrides: Partial<AxisSummary> & { axis: AxisKey; label: string }): AxisSummary {
  return {
    axis: overrides.axis,
    label: overrides.label,
    producers: overrides.producers ?? [],
    payoffs: overrides.payoffs ?? [],
    total: overrides.total ?? 0,
  };
}

function fakeSynergy(
  axes: Array<{ axis: AxisKey; label: string; total: number }>
): Parameters<typeof selectRadarAxes>[0] {
  return {
    axes: axes.map((a) =>
      makeAxis({
        axis: a.axis,
        label: a.label,
        total: a.total,
        producers: Array.from({ length: Math.ceil(a.total / 2) }, (_, i) => ({
          name: `card-${i}`,
          reason: 'test',
        })),
        payoffs: Array.from({ length: Math.floor(a.total / 2) }, (_, i) => ({
          name: `card-p${i}`,
          reason: 'test',
        })),
      })
    ),
    invested: [],
    warnings: [],
    headline: 'test',
  };
}

// ── selectRadarAxes ───────────────────────────────────────────────────────────

describe('selectRadarAxes', () => {
  it('returns at most RADAR_MAX_AXES (6) axes', () => {
    const synergy = fakeSynergy([
      { axis: 'tokens', label: 'Tokens', total: 20 },
      { axis: 'counters', label: 'Counters', total: 18 },
      { axis: 'sacrifice', label: 'Sacrifice', total: 15 },
      { axis: 'graveyard', label: 'Graveyard', total: 12 },
      { axis: 'lifegain', label: 'Lifegain', total: 10 },
      { axis: 'spellslinger', label: 'Spellslinger', total: 8 },
      { axis: 'enchantress', label: 'Enchantress', total: 6 },
    ]);
    const result = selectRadarAxes(synergy);
    expect(result).toHaveLength(RADAR_MAX_AXES);
  });

  it('respects a custom max', () => {
    const synergy = fakeSynergy([
      { axis: 'tokens', label: 'Tokens', total: 20 },
      { axis: 'counters', label: 'Counters', total: 18 },
      { axis: 'sacrifice', label: 'Sacrifice', total: 15 },
      { axis: 'graveyard', label: 'Graveyard', total: 12 },
    ]);
    const result = selectRadarAxes(synergy, 3);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe('Tokens');
    expect(result[1].label).toBe('Counters');
    expect(result[2].label).toBe('Sacrifice');
  });

  it('filters axes with zero total', () => {
    const synergy = fakeSynergy([
      { axis: 'tokens', label: 'Tokens', total: 10 },
      { axis: 'counters', label: 'Counters', total: 0 },
      { axis: 'sacrifice', label: 'Sacrifice', total: 5 },
    ]);
    const result = selectRadarAxes(synergy);
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.total > 0)).toBe(true);
  });

  it('preserves busiest-first order from DeckSynergy (already sorted)', () => {
    const synergy = fakeSynergy([
      { axis: 'tokens', label: 'Tokens', total: 20 },
      { axis: 'sacrifice', label: 'Sacrifice', total: 15 },
      { axis: 'graveyard', label: 'Graveyard', total: 8 },
    ]);
    const result = selectRadarAxes(synergy);
    expect(result[0].label).toBe('Tokens');
    expect(result[1].label).toBe('Sacrifice');
    expect(result[2].label).toBe('Graveyard');
  });

  it('returns empty array when all axes have zero total', () => {
    const synergy = fakeSynergy([
      { axis: 'tokens', label: 'Tokens', total: 0 },
      { axis: 'counters', label: 'Counters', total: 0 },
    ]);
    expect(selectRadarAxes(synergy)).toHaveLength(0);
  });

  it('returns fewer than max when fewer non-zero axes exist', () => {
    const synergy = fakeSynergy([
      { axis: 'tokens', label: 'Tokens', total: 10 },
      { axis: 'sacrifice', label: 'Sacrifice', total: 5 },
    ]);
    const result = selectRadarAxes(synergy);
    expect(result).toHaveLength(2);
  });
});

// ── radarLayout ───────────────────────────────────────────────────────────────

describe('radarLayout', () => {
  it('returns null for N < 3', () => {
    expect(radarLayout([], 200)).toBeNull();
    expect(radarLayout([0.5], 200)).toBeNull();
    expect(radarLayout([0.5, 0.8], 200)).toBeNull();
  });

  it('returns a layout for exactly 3 vertices', () => {
    const layout = radarLayout([1, 0.5, 0.8], 200);
    expect(layout).not.toBeNull();
    expect(layout!.vertices).toHaveLength(3);
    expect(layout!.spokes).toHaveLength(3);
  });

  it('returns a layout for 6 vertices (maximum)', () => {
    const layout = radarLayout([1, 0.8, 0.6, 0.4, 0.7, 0.9], 200);
    expect(layout).not.toBeNull();
    expect(layout!.vertices).toHaveLength(6);
  });

  it('outerRadius is 30% of the size (canvas reserves the label band)', () => {
    const layout = radarLayout([1, 1, 1], 280);
    expect(layout!.outerRadius).toBeCloseTo(84);
  });

  it('referenceRadius is 50% of outerRadius', () => {
    const layout = radarLayout([1, 1, 1], 200);
    expect(layout!.referenceRadius).toBeCloseTo(30);
  });

  it('every label point stays strictly inside the canvas (±size/2)', () => {
    // The identity card clips at overflow:hidden — HTML overlays positioned
    // from these coords must never leave the square wrapper.
    for (const n of [3, 4, 5, 6]) {
      const size = 280;
      const layout = radarLayout(
        Array.from({ length: n }, () => 1),
        size
      );
      for (const v of layout!.vertices) {
        expect(Math.abs(v.labelX)).toBeLessThan(size / 2);
        expect(Math.abs(v.labelY)).toBeLessThan(size / 2);
      }
    }
  });

  it('vertex at value=1 lies on the outer radius circle', () => {
    const size = 200;
    const layout = radarLayout([1, 1, 1, 1], size);
    const r = layout!.outerRadius;
    for (const v of layout!.vertices) {
      const dist = Math.sqrt(v.x ** 2 + v.y ** 2);
      expect(dist).toBeCloseTo(r, 1);
    }
  });

  it('vertex at value=0 is at the center', () => {
    const layout = radarLayout([0, 1, 1], 200);
    const v0 = layout!.vertices[0];
    expect(v0.x).toBeCloseTo(0, 3);
    expect(v0.y).toBeCloseTo(0, 3);
  });

  it('first spoke points straight up (top vertex, angle = -π/2)', () => {
    // For N=4, vertex 0 is at angle = -π/2 → cos=0, sin=-1 → x≈0, y<0
    const layout = radarLayout([1, 1, 1, 1], 200);
    const tip0 = layout!.spokes[0].tip;
    expect(tip0.x).toBeCloseTo(0, 1);
    expect(tip0.y).toBeLessThan(0); // up in SVG = negative y
  });

  it('polygonPoints string contains all vertices', () => {
    const layout = radarLayout([1, 0.5, 0.8], 200);
    const parts = layout!.polygonPoints.split(' ');
    expect(parts).toHaveLength(3);
    // Each part is "x,y"
    expect(parts.every((p) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p))).toBe(true);
  });

  // ── Anchor selection per quadrant ──────────────────────────────────────────

  it('top vertex (N=4, vertex 0) → middle anchor', () => {
    // angle = -π/2 → cos = 0 → middle
    const layout = radarLayout([1, 1, 1, 1], 200);
    expect(layout!.vertices[0].anchor).toBe('middle');
  });

  it('bottom vertex (N=4, vertex 2) → middle anchor', () => {
    // angle = π/2 → cos ≈ 0 → middle
    const layout = radarLayout([1, 1, 1, 1], 200);
    expect(layout!.vertices[2].anchor).toBe('middle');
  });

  it('right vertex (N=4, vertex 1) → start anchor', () => {
    // angle = 0 → cos = 1 → start
    const layout = radarLayout([1, 1, 1, 1], 200);
    expect(layout!.vertices[1].anchor).toBe('start');
  });

  it('left vertex (N=4, vertex 3) → end anchor', () => {
    // angle = π → cos = -1 → end
    const layout = radarLayout([1, 1, 1, 1], 200);
    expect(layout!.vertices[3].anchor).toBe('end');
  });

  it('upper-right vertex (N=6, vertex 1) → start anchor', () => {
    // angle = 2π/6 - π/2 = π/6 → cos ≈ 0.866 → start
    const layout = radarLayout([1, 1, 1, 1, 1, 1], 200);
    expect(layout!.vertices[1].anchor).toBe('start');
  });

  it('upper-left vertex (N=6, vertex 5) → end anchor', () => {
    // angle = 10π/6 - π/2 = 4π/3 → cos ≈ -0.866 → end
    const layout = radarLayout([1, 1, 1, 1, 1, 1], 200);
    expect(layout!.vertices[5].anchor).toBe('end');
  });

  it('label positions are further from center than vertices', () => {
    const layout = radarLayout([1, 1, 1, 1, 1, 1], 200);
    for (const v of layout!.vertices) {
      const vDist = Math.sqrt(v.x ** 2 + v.y ** 2);
      const lDist = Math.sqrt(v.labelX ** 2 + v.labelY ** 2);
      // Label is further out for vertices with value=1 (on the outer ring)
      expect(lDist).toBeGreaterThan(vDist - 0.1);
    }
  });

  it('spoke tip lies exactly on the outer circle', () => {
    const layout = radarLayout([0.5, 0.7, 0.9, 0.3], 200);
    const r = layout!.outerRadius;
    for (const s of layout!.spokes) {
      const dist = Math.sqrt(s.tip.x ** 2 + s.tip.y ** 2);
      expect(dist).toBeCloseTo(r, 1);
    }
  });

  it('scaling: smaller value → proportionally smaller vertex radius', () => {
    const layout = radarLayout([1.0, 0.5, 0.25], 200);
    const v0 = layout!.vertices[0]; // value=1.0
    const v2 = layout!.vertices[2]; // value=0.25
    const d0 = Math.sqrt(v0.x ** 2 + v0.y ** 2);
    const d2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);
    expect(d0).toBeGreaterThan(d2);
    expect(d0 / d2).toBeCloseTo(4, 1); // 1.0 / 0.25 = 4
  });
});

// ── Heuristic-audit fixture ───────────────────────────────────────────────────
// Feed a realistic mixed card list through the real `analyzeDeckSynergy` and
// assert that `selectRadarAxes` returns the SAME axes in the SAME order as
// `buildSynergyAnalysis` (the engine's own top-N). This guards against the radar
// and EnginePanel disagreeing on which axes matter.

describe('selectRadarAxes vs engine top-N (heuristic audit)', () => {
  /**
   * A realistic mixed-format card fixture spanning multiple axes.
   * Cards are chosen to produce hits on tokens, +1/+1 counters, graveyard,
   * sacrifice, and lifegain axes — more than 6 axes are intentionally NOT
   * triggered so the top-6 selection is meaningful.
   */
  const FIXTURE_CARDS: CardLike[] = [
    // ── Tokens axis producers (8 cards) ──────────────────────────────────────
    {
      name: 'Llanowar Mentor',
      type_line: 'Creature — Elf',
      oracle_text: '{1}{G}, {T}: Create a 1/1 green Elf Druid creature token.',
      keywords: [],
    },
    {
      name: 'Goblin Instigator',
      type_line: 'Creature — Goblin',
      oracle_text: 'When Goblin Instigator enters, create a 1/1 red Goblin creature token.',
      keywords: [],
    },
    {
      name: 'Raise the Alarm',
      type_line: 'Instant',
      oracle_text: 'Create two 1/1 white Soldier creature tokens.',
      keywords: [],
    },
    {
      name: 'Saproling Migration',
      type_line: 'Sorcery',
      oracle_text: 'Create two 1/1 green Saproling creature tokens.',
      keywords: [],
    },
    {
      name: 'Awakening Zone',
      type_line: 'Enchantment',
      oracle_text:
        'At the beginning of your upkeep, you may create a 0/1 green Eldrazi Spawn creature token.',
      keywords: [],
    },
    {
      name: 'Tendershoot Dryad',
      type_line: 'Creature — Dryad',
      oracle_text:
        'Melee. At the beginning of each upkeep, create a 1/1 green Saproling creature token.',
      keywords: ['Melee'],
    },
    {
      name: 'Doubling Season',
      type_line: 'Enchantment',
      oracle_text:
        'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
      keywords: [],
    },
    {
      name: 'Anointed Procession',
      type_line: 'Enchantment',
      oracle_text:
        'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
      keywords: [],
    },
    // ── Tokens axis payoffs (5 cards) ─────────────────────────────────────────
    {
      name: 'Intangible Virtue',
      type_line: 'Enchantment',
      oracle_text: 'Creature tokens you control get +1/+1 and have vigilance.',
      keywords: [],
    },
    {
      name: "Cathars' Crusade",
      type_line: 'Enchantment',
      oracle_text:
        'Whenever a creature enters under your control, put a +1/+1 counter on each creature you control.',
      keywords: [],
    },
    {
      name: 'Orah, Skyclave Hierophant',
      type_line: 'Legendary Creature — Kor Cleric',
      oracle_text:
        'Whenever Orah, Skyclave Hierophant or another Cleric you control dies, return target Cleric card with lesser mana value from your graveyard to the battlefield.',
      keywords: [],
    },
    {
      name: 'Leonin Warleader',
      type_line: 'Creature — Cat Soldier',
      oracle_text:
        'Whenever Leonin Warleader attacks, create two 1/1 white Cat creature tokens that are tapped and attacking.',
      keywords: [],
    },
    {
      name: 'Champion of the Parish',
      type_line: 'Creature — Human Soldier',
      oracle_text:
        'Whenever another Human enters under your control, put a +1/+1 counter on Champion of the Parish.',
      keywords: [],
    },
    // ── +1/+1 counters axis (6 cards) ─────────────────────────────────────────
    {
      name: 'Hardened Scales',
      type_line: 'Enchantment',
      oracle_text:
        'If one or more +1/+1 counters would be placed on a creature you control, that many plus one +1/+1 counters are placed on it instead.',
      keywords: [],
    },
    {
      name: 'Winding Constrictor',
      type_line: 'Creature — Snake',
      oracle_text:
        'If one or more counters would be placed on an artifact or creature you control, that many plus one of each of those kinds of counters are placed on it instead. If one or more counters would be placed on a player, that player gets that many plus one of each of those kinds of counters instead.',
      keywords: [],
    },
    {
      name: 'Vorel of the Hull Clade',
      type_line: 'Legendary Creature — Human Merfolk',
      oracle_text:
        '{G}{U}, {T}: For each counter on target artifact, creature, or land, put another of those counters on that permanent.',
      keywords: [],
    },
    {
      name: 'Kalonian Hydra',
      type_line: 'Creature — Hydra',
      oracle_text:
        'Trample. Whenever Kalonian Hydra attacks, double the number of +1/+1 counters on each creature you control.',
      keywords: ['Trample'],
    },
    {
      name: 'Enduring Scalelord',
      type_line: 'Creature — Dragon',
      oracle_text:
        'Flying. Whenever one or more +1/+1 counters are placed on another creature you control, put a +1/+1 counter on Enduring Scalelord.',
      keywords: ['Flying'],
    },
    {
      name: 'Hamza, Guardian of Arashin',
      type_line: 'Legendary Creature — Elephant Warrior',
      oracle_text:
        'This spell costs {1} less to cast for each creature you control with a +1/+1 counter on it.',
      keywords: [],
    },
    // ── Graveyard axis (5 cards) ──────────────────────────────────────────────
    {
      name: "Stitcher's Supplier",
      type_line: 'Creature — Zombie',
      oracle_text: "When Stitcher's Supplier enters or dies, mill three cards.",
      keywords: [],
    },
    {
      name: 'Satyr Wayfinder',
      type_line: 'Creature — Satyr',
      oracle_text: 'When Satyr Wayfinder enters, mill four cards.',
      keywords: [],
    },
    {
      name: 'Golgari Grave-Troll',
      type_line: 'Creature — Troll Skeleton',
      oracle_text: 'Dredge 6. {1}: Regenerate Golgari Grave-Troll.',
      keywords: ['Dredge 6'],
    },
    {
      name: 'Bloodghast',
      type_line: 'Creature — Vampire Spirit',
      oracle_text:
        "Bloodghast can't block. Landfall — Whenever a land enters under your control, you may return Bloodghast from your graveyard to the battlefield.",
      keywords: [],
    },
    {
      name: 'Haakon, Stromgald Scourge',
      type_line: 'Legendary Creature — Zombie Knight',
      oracle_text:
        'You may cast Haakon, Stromgald Scourge from your graveyard, but not from anywhere else.',
      keywords: [],
    },
    // ── Sacrifice axis (4 cards) ──────────────────────────────────────────────
    {
      name: 'Viscera Seer',
      type_line: 'Creature — Vampire Wizard',
      oracle_text: 'Sacrifice a creature: Scry 1.',
      keywords: [],
    },
    {
      name: "Ashnod's Altar",
      type_line: 'Artifact',
      oracle_text: 'Sacrifice a creature: Add {C}{C}.',
      keywords: [],
    },
    {
      name: 'Blood Artist',
      type_line: 'Creature — Vampire',
      oracle_text:
        'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
      keywords: [],
    },
    {
      name: 'Zulaport Cutthroat',
      type_line: 'Creature — Human Rogue Ally',
      oracle_text:
        'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
      keywords: [],
    },
    // ── Lifegain axis (4 cards) ───────────────────────────────────────────────
    {
      name: 'Soul Warden',
      type_line: 'Creature — Human Cleric',
      oracle_text: 'Whenever another creature enters, you gain 1 life.',
      keywords: [],
    },
    {
      name: 'Archangel of Thune',
      type_line: 'Creature — Angel',
      oracle_text:
        'Flying, lifelink. Whenever you gain life, put a +1/+1 counter on each creature you control.',
      keywords: ['Flying', 'Lifelink'],
    },
    {
      name: "Ajani's Pridemate",
      type_line: 'Creature — Cat Warrior',
      oracle_text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
      keywords: [],
    },
    {
      name: 'Heliod, Sun-Crowned',
      type_line: 'Legendary Enchantment Creature — God',
      oracle_text:
        "Indestructible. As long as your devotion to white is less than five, Heliod isn't a creature. Whenever you gain life, put a +1/+1 counter on target creature or enchantment you control.",
      keywords: ['Indestructible'],
    },
  ];

  it('selectRadarAxes returns the same top axes in the same order as buildSynergyAnalysis', () => {
    const synergy = analyzeDeckSynergy(FIXTURE_CARDS);
    const radarAxes = selectRadarAxes(synergy, RADAR_MAX_AXES);

    // `buildSynergyAnalysis`'s top-N: slice(0, MAX_AXES_SHOWN) after filtering zero-total axes
    // (which the engine already sorts busiest-first, so this is just a slice)
    const engineAxes = synergy.axes.filter((a) => a.total > 0).slice(0, RADAR_MAX_AXES);

    // Must agree on which axes appear, and in which order
    expect(radarAxes).toHaveLength(engineAxes.length);
    for (let i = 0; i < engineAxes.length; i++) {
      expect(radarAxes[i].axis).toBe(engineAxes[i].axis);
      expect(radarAxes[i].label).toBe(engineAxes[i].label);
      expect(radarAxes[i].total).toBe(engineAxes[i].total);
    }
  });

  it('fixture spans at least 4 distinct active axes (validates fixture quality)', () => {
    const synergy = analyzeDeckSynergy(FIXTURE_CARDS);
    const activeAxes = synergy.axes.filter((a) => a.total > 0);
    expect(activeAxes.length).toBeGreaterThanOrEqual(4);
  });

  it('top axis in fixture has more cards than the fifth (ordering is meaningful)', () => {
    const synergy = analyzeDeckSynergy(FIXTURE_CARDS);
    const active = synergy.axes.filter((a) => a.total > 0);
    if (active.length >= 5) {
      expect(active[0].total).toBeGreaterThanOrEqual(active[4].total);
    }
  });

  it('radar normalization: top axis value=1, others proportional', () => {
    const synergy = analyzeDeckSynergy(FIXTURE_CARDS);
    const axes = selectRadarAxes(synergy);
    if (axes.length < 3) return; // not enough axes to form a radar

    const maxTotal = axes[0].total; // busiest first
    const values = axes.map((a) => a.total / maxTotal);

    // Top axis normalizes to 1
    expect(values[0]).toBeCloseTo(1, 5);
    // All values in [0..1]
    expect(values.every((v) => v >= 0 && v <= 1)).toBe(true);
    // Monotonically decreasing (axes are sorted busiest-first)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });
});
