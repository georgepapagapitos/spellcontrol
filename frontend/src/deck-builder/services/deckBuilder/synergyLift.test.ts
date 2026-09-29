import { describe, it, expect } from 'vitest';
import type { EDHRECCard } from '@/deck-builder/types';
import { parseEdhrecResponse } from '@/deck-builder/services/edhrec/client';
import {
  readSynergy,
  synergyStrength,
  isSignatureSynergy,
  isAntiSynergy,
  bySynergyStrength,
  SYNERGY_PRIOR_DECKS,
  BASELINE_FLOOR_PCT,
} from './synergyLift';

// Every row below is a real EDHREC cardview (json.edhrec.com, cached
// 2026-09-29): `n` = num_decks, `N` = potential_decks, `synergy` verbatim.
// `row` builds the EDHRECCard exactly the way edhrec/client.ts parseCard does.
function row(name: string, n: number, N: number, synergy: number): EDHRECCard {
  return {
    name,
    sanitized: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    primary_type: 'Unknown',
    inclusion: (n / N) * 100,
    num_decks: n,
    potential_decks: N,
    synergy,
  };
}

// Meren of Clan Nel Toth, 22,305 decks.
const SPORE_FROG = row('Spore Frog', 16855, 22305, 0.7009745070406005);
const GRIM_HARUSPEX = row('Grim Haruspex', 11022, 22305, 0.4571132790947646);
const SAKURA_TRIBE_ELDER = row('Sakura-Tribe Elder', 18523, 22305, 0.5470536716623432);
const BLOOD_ARTIST = row('Blood Artist', 12167, 22305, 0.33493362872713894);
const SOL_RING = row('Sol Ring', 19037, 22305, 0.06115836069838243);
const HEROIC_INTERVENTION = row('Heroic Intervention', 3789, 22305, -0.1513924847323302);
const PATH_OF_ANCESTRY = row('Path of Ancestry', 1680, 22305, -0.1663573341595228);
// Sythis, Harvest's Hand, 14,250 decks.
const OVERGROWTH = row('Overgrowth', 4519, 14250, 0.28031627345224963);
const RELIQUARY_TOWER = row('Reliquary Tower', 8495, 14250, 0.315);
const LLANOWAR_ELVES = row('Llanowar Elves', 2034, 14250, -0.16843939294844684);
const CULTIVATE = row('Cultivate', 2238, 14250, -0.25957261349878713);
// U.S.S. Enterprise-D, Galaxy-Class: a 15-deck page.
const POWER_CONDUIT = row('Power Conduit', 12, 15, 0.7856609682331996);
const JHOIRAS_FAMILIAR = row("Jhoira's Familiar", 12, 15, 0.44629673323180546);
const MOX_DIAMOND = row('Mox Diamond', 1, 15, 0.035500454015715374);
// Lim-Dûl the Necromancer: a 300-deck page.
const GRAVE_BETRAYAL = row('Grave Betrayal', 171, 300, 0.5468229773840055);
// Giada, Font of Hope × Angels: a THEME page (4,364 decks).
const LYRA = row('Lyra Dawnbringer', 3919, 4364, 0.7538286270093411);
const ROGUES_PASSAGE = row("Rogue's Passage", 727, 4364, -0.10652767881218514);
// Thrasios, Triton Hero // Tymna the Weaver: a PARTNER page (11,589 decks).
const SILENCE = row('Silence', 9679, 11589, 0.6525598666824483);
const PLAINS = row('Plains', 2075, 11589, -0.5844551346667248);
// The Tenth Doctor // Rose Tyler: a colour baseline below the floor (0.3%).
const JENNY = row('Jenny, Generated Anomaly', 757, 5642, 0.1311878059711292);

describe('readSynergy', () => {
  it('recovers the colour-identity baseline from inclusion − synergy × 100', () => {
    const r = readSynergy(SPORE_FROG)!;
    expect(r.commanderPct).toBeCloseTo(75.566, 3);
    expect(r.baselinePct).toBeCloseTo(5.469, 3);
    expect(r.sampleDecks).toBe(22305);
  });

  it('reads Meren’s signature cards by ratio: Grim Haruspex (13× its colours) beats Sakura-Tribe Elder (2.9×)', () => {
    // The subtraction ranks them the other way (+0.55 vs +0.46).
    expect(SAKURA_TRIBE_ELDER.synergy!).toBeGreaterThan(GRIM_HARUSPEX.synergy!);
    const elder = readSynergy(SAKURA_TRIBE_ELDER)!;
    const haruspex = readSynergy(GRIM_HARUSPEX)!;
    expect(elder.lift).toBeCloseTo(2.93, 2);
    expect(haruspex.lift).toBeCloseTo(13.34, 2);
    expect(haruspex.strength).toBeCloseTo(1.847, 3);
    expect(elder.strength).toBeCloseTo(1.288, 3);
    expect(haruspex.strength).toBeGreaterThan(elder.strength);
  });

  it('barely shrinks a large page (22,305 decks)', () => {
    const r = readSynergy(SPORE_FROG)!;
    expect(r.shrunkPct).toBeCloseTo(75.55, 3);
    expect(r.lift).toBeCloseTo(13.815, 2);
    expect(r.strength).toBeCloseTo(2.862, 3);
  });

  it('shrinks a 15-deck page toward the colours: 12 of 15 decks keeps 75% of its own evidence', () => {
    const r = readSynergy(POWER_CONDUIT)!;
    const weight = 15 / (15 + SYNERGY_PRIOR_DECKS);
    expect(weight).toBeCloseTo(0.75, 5);
    expect(r.shrunkPct).toBeCloseTo(weight * 80 + (1 - weight) * r.baselinePct, 5);
    expect(r.shrunkPct).toBeCloseTo(60.358, 3);
    // Raw ratio 80 / 1.43 = 56×; shrunk 42×. Still an unmistakable signature card.
    expect(r.lift).toBeCloseTo(42.094, 2);
    expect(isSignatureSynergy(POWER_CONDUIT)).toBe(true);
  });

  it('does not let one deck of fifteen read as a signature card', () => {
    const r = readSynergy(MOX_DIAMOND)!;
    expect(r.strength).toBeCloseTo(0.051, 3);
    expect(isSignatureSynergy(MOX_DIAMOND)).toBe(false);
  });

  it('shrinks a 300-deck page only a little', () => {
    const r = readSynergy(GRAVE_BETRAYAL)!;
    expect(r.commanderPct).toBeCloseTo(57, 5);
    expect(r.shrunkPct).toBeCloseTo(56.104, 3);
    expect(isSignatureSynergy(GRAVE_BETRAYAL)).toBe(true);
  });

  it('floors a near-zero colour baseline so the ratio stays finite', () => {
    // Raw baseline 13.42% − 13.12 = 0.30%: a raw ratio of 45×.
    const r = readSynergy(JENNY)!;
    expect(r.baselinePct).toBe(BASELINE_FLOOR_PCT);
    expect(r.lift).toBeCloseTo(13.406, 2);
    expect(Number.isFinite(r.strength)).toBe(true);
  });

  it('floors a baseline the subtraction pushes below zero', () => {
    // EDHREC rounds its two rates separately; a card with synergy slightly
    // above its own inclusion reads a negative baseline.
    const r = readSynergy({
      inclusion: 3.1,
      synergy: 0.0312,
      num_decks: 31,
      potential_decks: 1000,
    })!;
    expect(r.baselinePct).toBe(BASELINE_FLOOR_PCT);
    expect(r.lift).toBeGreaterThan(1);
  });

  it('reads a theme page against the same colour baseline', () => {
    const r = readSynergy(LYRA)!;
    expect(r.baselinePct).toBeCloseTo(14.42, 2);
    expect(r.lift).toBeCloseTo(6.222, 2);
    expect(isSignatureSynergy(LYRA)).toBe(true);
  });

  it('reads a partner page against the pair’s colour baseline', () => {
    expect(readSynergy(SILENCE)!.lift).toBeCloseTo(4.572, 2);
    expect(isSignatureSynergy(SILENCE)).toBe(true);
  });

  it('is null for a row with no synergy, and strength reads 0', () => {
    const synthesized: EDHRECCard = {
      name: 'Arcane Signet',
      sanitized: 'arcane-signet',
      primary_type: 'Artifact',
      inclusion: 40,
      num_decks: 0,
    };
    expect(readSynergy(synthesized)).toBeNull();
    expect(synergyStrength(synthesized)).toBe(0);
    expect(isSignatureSynergy(synthesized)).toBe(false);
    expect(isAntiSynergy(synthesized)).toBe(false);
  });

  it('recovers the sample size from num_decks when potential_decks is missing', () => {
    const { potential_decks: _drop, ...noPotential } = POWER_CONDUIT;
    expect(readSynergy(noPotential)!.sampleDecks).toBeCloseTo(15, 5);
    expect(readSynergy(noPotential)!.shrunkPct).toBeCloseTo(
      readSynergy(POWER_CONDUIT)!.shrunkPct,
      5
    );
  });

  it('reads a row with no sample size at all unshrunk', () => {
    const r = readSynergy({ inclusion: 80, synergy: 0.7856609682331996, num_decks: 0 })!;
    expect(r.sampleDecks).toBeNull();
    expect(r.shrunkPct).toBe(80);
  });

  it('reads a 0% row with no sample as unplayed, not −∞', () => {
    const r = readSynergy({ inclusion: 0, synergy: -0.2, num_decks: 0 })!;
    expect(r.strength).toBe(0);
    expect(r.lift).toBe(0);
  });

  it('ignores a non-finite synergy', () => {
    expect(readSynergy({ inclusion: 20, synergy: Number.NaN, num_decks: 5 })).toBeNull();
  });
});

describe('isSignatureSynergy (the shared replacement for synergy > 0.3)', () => {
  it('re-selects by ratio: Overgrowth (8.6×) is a Sythis signature card, Reliquary Tower (2.1×) is not', () => {
    // The old threshold said the opposite: +0.28 misses it, +0.315 clears it.
    expect(OVERGROWTH.synergy!).toBeLessThan(0.3);
    expect(RELIQUARY_TOWER.synergy!).toBeGreaterThan(0.3);
    expect(isSignatureSynergy(OVERGROWTH)).toBe(true);
    expect(isSignatureSynergy(RELIQUARY_TOWER)).toBe(false);
  });

  it('keeps Meren’s signature package', () => {
    for (const card of [SPORE_FROG, GRIM_HARUSPEX, SAKURA_TRIBE_ELDER]) {
      expect(isSignatureSynergy(card)).toBe(true);
    }
  });

  it('does not call a colour staple a signature card', () => {
    expect(isSignatureSynergy(SOL_RING)).toBe(false);
    expect(isSignatureSynergy(BLOOD_ARTIST)).toBe(false);
  });

  it('needs the commander to play it at least twice as often as its colours', () => {
    // 12 of 15 decks vs 35% in the colours: shrunk lift 1.95.
    expect(readSynergy(JHOIRAS_FAMILIAR)!.lift).toBeLessThan(2);
    expect(isSignatureSynergy(JHOIRAS_FAMILIAR)).toBe(false);
  });
});

describe('isAntiSynergy', () => {
  it('flags a staple the commander’s players avoid', () => {
    // Sythis decks ramp with enchantments: Llanowar Elves 14% vs 31%, Cultivate 16% vs 42%.
    expect(isAntiSynergy(LLANOWAR_ELVES)).toBe(true);
    expect(isAntiSynergy(CULTIVATE)).toBe(true);
    expect(isAntiSynergy(PATH_OF_ANCESTRY)).toBe(true);
    expect(isAntiSynergy(PLAINS)).toBe(true);
  });

  it('stays quiet on a mild dip', () => {
    // Heroic Intervention in Meren: 17% vs 32%, lift 0.53, just above the halving.
    expect(readSynergy(HEROIC_INTERVENTION)!.lift).toBeCloseTo(0.529, 3);
    expect(isAntiSynergy(HEROIC_INTERVENTION)).toBe(false);
    expect(isAntiSynergy(ROGUES_PASSAGE)).toBe(false);
  });

  it('needs a baseline the colours genuinely play', () => {
    // 1 deck in 15 of a card its colours play at 10%: below the 15% bar, so
    // a dip there says nothing about avoidance.
    expect(isAntiSynergy(row('Field of the Dead', 1, 15, -0.030424772813395964))).toBe(false);
  });

  it('reads avoidance as negative strength', () => {
    expect(synergyStrength(CULTIVATE)).toBeCloseTo(-0.221, 3);
    expect(synergyStrength(HEROIC_INTERVENTION)).toBeLessThan(0);
  });
});

describe('bySynergyStrength', () => {
  it('orders by strength, not by the subtraction', () => {
    const sorted = [SAKURA_TRIBE_ELDER, BLOOD_ARTIST, SPORE_FROG, GRIM_HARUSPEX, SOL_RING].sort(
      bySynergyStrength
    );
    expect(sorted.map((c) => c.name)).toEqual([
      'Spore Frog',
      'Grim Haruspex',
      'Sakura-Tribe Elder',
      'Blood Artist',
      'Sol Ring',
    ]);
  });
});

describe('parseCard carries the sample size', () => {
  it('keeps potential_decks from a live-shape cardview', () => {
    const data = parseEdhrecResponse(
      {
        container: {
          json_dict: {
            card: { name: 'Meren of Clan Nel Toth', num_decks: 22305 },
            cardlists: [
              {
                tag: 'highsynergycards',
                cardviews: [
                  {
                    name: 'Grim Haruspex',
                    sanitized: 'grim-haruspex',
                    num_decks: 11022,
                    potential_decks: 22305,
                    synergy: 0.4571132790947646,
                  },
                ],
              },
            ],
          },
        },
      },
      'meren-of-clan-nel-toth'
    );
    const card = data.cardlists.allNonLand.find((c) => c.name === 'Grim Haruspex')!;
    expect(card.potential_decks).toBe(22305);
    expect(readSynergy(card)!.strength).toBeCloseTo(1.847, 3);
  });

  it('leaves it off when EDHREC sent none', () => {
    const data = parseEdhrecResponse(
      {
        container: {
          json_dict: {
            card: { name: 'X', num_decks: 10 },
            cardlists: [
              {
                tag: 'topcards',
                cardviews: [{ name: 'Old Card', sanitized: 'old-card', inclusion: 5 }],
              },
            ],
          },
        },
      },
      'x'
    );
    expect('potential_decks' in data.cardlists.allNonLand[0]).toBe(false);
  });
});
