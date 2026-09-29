import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { cardCmc, isLand } from '../hand-classify';
import { classifyManaCard } from './classify';
import fixture from './__fixtures__/cards.fixture.json';
import { card } from './__fixtures__/decks';
import {
  ANY_COLOR,
  MANA_B,
  MANA_C,
  MANA_G,
  MANA_R,
  MANA_U,
  MANA_W,
  type LandFace,
  type RampEffect,
} from './types';

const FIVE = ANY_COLOR;
const AZORIUS = MANA_W | MANA_U;

const land = (name: string, identity = FIVE): LandFace => {
  const face = classifyManaCard(card(name), identity).land;
  if (!face) throw new Error(`${name} has no land face`);
  return face;
};
const ramp = (name: string, identity = FIVE): RampEffect | null =>
  classifyManaCard(card(name), identity).ramp;

describe('land entry, read from Oracle text', () => {
  it.each([
    ['Plains', 'untapped'],
    ['Tundra', 'untapped'],
    ['City of Brass', 'untapped'],
    ['Hallowed Fountain', 'shock'],
    ['Glacial Fortress', 'check'],
    ['Seachrome Coast', 'fast'],
    ['Deserted Beach', 'slow'],
    ['Prairie Stream', 'basics'],
    ['Sea of Clouds', 'bond'],
    ['Port Town', 'reveal'],
    ['Shineshadow Snarl', 'reveal'],
    ['Minas Tirith', 'legendary'],
    ['Azorius Guildgate', 'tapped'],
    ['Raugrin Triome', 'tapped'],
    ['Thriving Isle', 'tapped'],
    ['Simic Growth Chamber', 'tapped'],
    ['Meticulous Archive', 'tapped'],
  ])('%s enters %s', (name, kind) => {
    expect(land(name).entry.kind).toBe(kind);
  });

  it('carries the basic types a check land or snarl looks for', () => {
    expect(land('Glacial Fortress').entry).toEqual({ kind: 'check', types: AZORIUS });
    expect(land('Shineshadow Snarl').entry).toEqual({ kind: 'reveal', types: MANA_W | MANA_B });
    expect(land('Prairie Stream').entry).toEqual({ kind: 'basics', count: 2 });
  });

  it('reads an MDFC land back, pay-life or tapped', () => {
    expect(land("Emeria's Call").entry.kind).toBe('shock');
    expect(land('Valakut Awakening').entry.kind).toBe('tapped');
  });
});

describe('land mana', () => {
  it('reads basic types and supertype', () => {
    expect(land('Hallowed Fountain')).toMatchObject({
      types: AZORIUS,
      basic: false,
      units: [AZORIUS],
    });
    expect(land('Forest')).toMatchObject({ types: MANA_G, basic: true, units: [MANA_G] });
    expect(land('Wastes')).toMatchObject({ types: 0, basic: true, units: [MANA_C] });
  });

  it('keeps a painland and a Talisman-style C option in the one unit', () => {
    expect(land('Adarkar Wastes').units).toEqual([AZORIUS | MANA_C]);
  });

  it('clamps commander-identity lands to the identity', () => {
    expect(land('Command Tower', AZORIUS).units).toEqual([AZORIUS]);
    expect(land('Exotic Orchard', MANA_B | MANA_G).units).toEqual([MANA_B | MANA_G]);
    expect(land('City of Brass', AZORIUS).units).toEqual([FIVE]);
  });

  it('reads multi-mana lands as several units', () => {
    expect(land('Ancient Tomb').units).toEqual([MANA_C, MANA_C]);
    expect(land('Simic Growth Chamber')).toMatchObject({ units: [MANA_G, MANA_U], bounce: true });
    expect(land('Temple of the False God')).toMatchObject({ units: [MANA_C, MANA_C], minLands: 5 });
  });

  it("takes Crystal Vein's repeatable {C}, not its sacrifice for two", () => {
    expect(land('Crystal Vein').units).toEqual([MANA_C]);
  });

  it('reads a land that makes no mana', () => {
    expect(land('Maze of Ith')).toMatchObject({ units: [], fetch: null });
  });

  it('reads choose-on-entry lands: Thriving and Pathways', () => {
    expect(land('Thriving Isle', AZORIUS).choice).toEqual({ fixed: MANA_U, options: MANA_W });
    expect(land('Thriving Heath', FIVE).choice).toEqual({ fixed: MANA_W, options: FIVE & ~MANA_W });
    expect(land('Hengegate Pathway', AZORIUS)).toMatchObject({
      choice: { fixed: 0, options: AZORIUS },
      units: [AZORIUS],
      entry: { kind: 'untapped' },
    });
  });

  it('reads a filter land as a dual and a Verge as a dual', () => {
    expect(land('Mystic Gate').units).toEqual([AZORIUS | MANA_C]);
    expect(land('Floodfarm Verge').units).toEqual([AZORIUS]);
  });

  it('reads a channel land as a plain untapped land', () => {
    expect(land('Boseiju, Who Endures')).toMatchObject({
      units: [MANA_G],
      entry: { kind: 'untapped' },
    });
  });
});

describe('fetch lands', () => {
  it('reads a typed fetch: any land with the types, untapped', () => {
    expect(land('Flooded Strand').fetch).toEqual({
      basicOnly: false,
      types: AZORIUS,
      count: 1,
      toHand: 0,
      tapped: false,
      untapAtLands: 0,
    });
    expect(land('Flooded Strand').units).toEqual([]);
  });

  it('reads basic-only fetches, tapped or not', () => {
    expect(land('Evolving Wilds').fetch).toMatchObject({
      basicOnly: true,
      types: FIVE,
      tapped: true,
    });
    expect(land('Prismatic Vista').fetch).toMatchObject({ basicOnly: true, tapped: false });
    expect(land('Fabled Passage').fetch).toMatchObject({ tapped: true, untapAtLands: 4 });
  });

  it('does not read a fetch that costs mana to crack (Myriad Landscape)', () => {
    expect(land('Myriad Landscape')).toMatchObject({ fetch: null, units: [MANA_C] });
  });
});

describe('ramp', () => {
  it('reads rocks, usable the turn they land', () => {
    expect(ramp('Sol Ring')).toEqual({
      kind: 'source',
      units: [MANA_C, MANA_C],
      delay: 0,
      oneShot: false,
      choice: null,
    });
    expect(ramp('Arcane Signet', AZORIUS)).toMatchObject({ units: [AZORIUS], delay: 0 });
    expect(ramp('Azorius Signet')).toMatchObject({ units: [AZORIUS], delay: 0 });
    expect(ramp('Talisman of Progress')).toMatchObject({ units: [AZORIUS | MANA_C] });
    expect(ramp('Mind Stone')).toMatchObject({ units: [MANA_C] });
    expect(ramp('Chromatic Lantern')).toMatchObject({ units: [FIVE] });
  });

  it('reads a rock that enters tapped and chooses its colour', () => {
    expect(ramp('Coldsteel Heart', AZORIUS)).toMatchObject({
      delay: 1,
      choice: { fixed: 0, options: AZORIUS },
      units: [AZORIUS],
    });
  });

  it('reads dorks as summoning sick', () => {
    expect(ramp('Llanowar Elves')).toMatchObject({ units: [MANA_G], delay: 1 });
    expect(ramp('Birds of Paradise')).toMatchObject({ units: [FIVE], delay: 1 });
    expect(ramp('Noble Hierarch')).toMatchObject({ units: [MANA_W | MANA_U | MANA_G], delay: 1 });
  });

  it('reads Mana Vault and Grim Monolith as one-shot mana', () => {
    expect(ramp('Mana Vault')).toMatchObject({ units: [MANA_C, MANA_C, MANA_C], oneShot: true });
    expect(ramp('Grim Monolith')).toMatchObject({ oneShot: true });
  });

  it('reads Gilded Lotus as three any-colour units', () => {
    expect(ramp('Gilded Lotus')).toMatchObject({ units: [FIVE, FIVE, FIVE] });
  });

  it('reads land searches: to the battlefield, tapped or not, and to hand', () => {
    expect(ramp('Cultivate')).toEqual({
      kind: 'search',
      search: { basicOnly: true, types: FIVE, count: 1, toHand: 1, tapped: true, untapAtLands: 0 },
      sacrificeLand: false,
    });
    expect(ramp("Nature's Lore")).toMatchObject({ search: { types: MANA_G, tapped: false } });
    expect(ramp('Farseek')).toMatchObject({
      search: { types: MANA_W | MANA_U | MANA_B | MANA_R, tapped: true, basicOnly: false },
    });
    expect(ramp('Skyshroud Claim')).toMatchObject({ search: { count: 2, tapped: false } });
    expect(ramp('Explosive Vegetation')).toMatchObject({ search: { count: 2, tapped: true } });
    expect(ramp('Harrow')).toMatchObject({
      search: { count: 2, tapped: false },
      sacrificeLand: true,
    });
  });

  it('reads creature searches on entry or on a free sacrifice', () => {
    expect(ramp('Wood Elves')).toMatchObject({ kind: 'search', search: { types: MANA_G } });
    expect(ramp('Sakura-Tribe Elder')).toMatchObject({ kind: 'search', search: { tapped: true } });
    expect(ramp('Solemn Simulacrum')).toMatchObject({ kind: 'search' });
  });

  it('skips searches that cost mana to activate or depend on opponents', () => {
    expect(ramp('Burnished Hart')).toBeNull();
    expect(ramp('Knight of the White Orchid')).toBeNull();
  });

  it('reads one-shot Treasures, and not X Treasures or engines', () => {
    expect(ramp('Big Score')).toEqual({ kind: 'treasure', count: 2 });
    expect(ramp('Dockside Extortionist')).toBeNull();
    expect(ramp('Smothering Tithe')).toBeNull();
  });

  it('ignores granted and aura mana and non-mana cards', () => {
    expect(ramp('Cryptolith Rite')).toBeNull();
    expect(ramp('Wild Growth')).toBeNull();
    expect(ramp('Land Tax')).toBeNull();
    expect(ramp('Exploration')).toBeNull();
    expect(ramp('Demonic Tutor')).toBeNull();
    expect(ramp('Lightning Bolt')).toBeNull();
  });
});

describe('spells and faces', () => {
  it('measures the front face of split, adventure and transform cards', () => {
    expect(classifyManaCard(card('Fire // Ice'), FIVE).cost?.text).toBe('{1}{R}');
    expect(classifyManaCard(card('Bonecrusher Giant'), FIVE).cost?.text).toBe('{2}{R}');
    expect(classifyManaCard(card('Reckless Stormseeker'), FIVE).cost?.text).toBe('{2}{R}');
  });

  it('reads a spell//land MDFC as both', () => {
    const c = classifyManaCard(card('Bala Ged Recovery'), FIVE);
    expect(c).toMatchObject({ landCard: false, mdfc: true, cost: { text: '{2}{G}' } });
    expect(c.land?.units).toEqual([MANA_G]);
  });

  it('reads a Pathway as a land, not an MDFC', () => {
    expect(classifyManaCard(card('Blightstep Pathway'), FIVE)).toMatchObject({
      landCard: true,
      mdfc: false,
      cost: null,
    });
  });

  it('has no cost for a card without one (Ancestral Vision)', () => {
    expect(classifyManaCard(card('Ancestral Vision'), FIVE).cost).toBeNull();
  });

  it('flags legendary creatures', () => {
    expect(classifyManaCard(card('Brago, King Eternal'), AZORIUS).legendaryCreature).toBe(true);
    expect(classifyManaCard(card('Teferi, Hero of Dominaria'), AZORIUS).legendaryCreature).toBe(
      false
    );
  });

  it('takes the role from the caller when given one', () => {
    expect(classifyManaCard(card('Sol Ring'), FIVE).sim.role).toBe('ramp');
    expect(classifyManaCard(card('Counterspell'), FIVE).sim.role).toBeNull();
    const roleOf = (name: string) => (name === 'Counterspell' ? ('removal' as const) : null);
    expect(classifyManaCard(card('Counterspell'), FIVE, { roleOf }).sim.role).toBe('removal');
    expect(classifyManaCard(card('Sol Ring'), FIVE, { roleOf }).sim.role).toBeNull();
  });

  it("reduces every fixture card for the keep rule exactly as the deck view's hand-classify does", () => {
    for (const c of fixture.cards as unknown as ScryfallCard[]) {
      const sim = classifyManaCard(c, FIVE).sim;
      expect(sim.isLand, c.name).toBe(isLand(c));
      expect(sim.cmc, c.name).toBe(cardCmc(c));
      expect(sim.colors, c.name).toEqual(c.color_identity);
    }
  });
});
