/**
 * Real decklists for the mana-sim tests, over the real Scryfall records in
 * `cards.fixture.json`.
 *
 * - JODAH_5C: a tuned five-colour list: ten fetches, ten shocks, six
 *   tri-lands, Command Tower, City of Brass, Mana Confluence, Exotic Orchard,
 *   Prismatic Vista, Fabled Passage, one of each basic; twelve ramp pieces.
 * - BRAGO_UNTAPPED / BRAGO_TAPPED: the same Azorius 63 spells over 36 lands,
 *   12 duals + 12 Plains + 12 Islands, where the twelve duals are untapped
 *   (shock, original dual, Command Tower, bond, pain, check, slow, fast,
 *   snarl, tango, Pathway, filter) or tapped (gate, gain, Karoo-free
 *   taplands, Thriving, scry, surveil, cycling, man-lands).
 */

import type { ScryfallCard } from '@/deck-builder/types';
import fixture from './cards.fixture.json';

const byName = new Map<string, ScryfallCard>(
  (fixture.cards as unknown as ScryfallCard[]).map((c) => [c.name, c])
);

/** A fixture card by exact name, or by front-face name for a double-faced card. */
export function card(name: string): ScryfallCard {
  const hit =
    byName.get(name) ?? [...byName.values()].find((c) => c.name.split(' // ')[0] === name);
  if (!hit) throw new Error(`no fixture card named ${name}`);
  return hit;
}

/** Expand `[name, copies]` pairs (bare names are one copy) into cards. */
export function cards(list: ReadonlyArray<string | readonly [string, number]>): ScryfallCard[] {
  return list.flatMap((entry) =>
    typeof entry === 'string'
      ? [card(entry)]
      : Array.from({ length: entry[1] }, () => card(entry[0]))
  );
}

export const JODAH_COMMANDER = 'Jodah, the Unifier';

export const JODAH_LANDS = [
  'Command Tower',
  'City of Brass',
  'Mana Confluence',
  'Exotic Orchard',
  'Flooded Strand',
  'Polluted Delta',
  'Bloodstained Mire',
  'Wooded Foothills',
  'Windswept Heath',
  'Marsh Flats',
  'Scalding Tarn',
  'Verdant Catacombs',
  'Arid Mesa',
  'Misty Rainforest',
  'Prismatic Vista',
  'Fabled Passage',
  'Hallowed Fountain',
  'Watery Grave',
  'Blood Crypt',
  'Stomping Ground',
  'Temple Garden',
  'Godless Shrine',
  'Steam Vents',
  'Overgrown Tomb',
  'Sacred Foundry',
  'Breeding Pool',
  'Raugrin Triome',
  'Savai Triome',
  'Zagoth Triome',
  'Ketria Triome',
  'Indatha Triome',
  "Spara's Headquarters",
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
];

export const JODAH_RAMP = [
  'Sol Ring',
  'Arcane Signet',
  'Chromatic Lantern',
  'Fellwar Stone',
  'Talisman of Dominance',
  'Birds of Paradise',
  'Noble Hierarch',
  'Cultivate',
  "Kodama's Reach",
  'Farseek',
  "Nature's Lore",
  'Three Visits',
];

export const JODAH_SPELLS = [
  'Swords to Plowshares',
  'Path to Exile',
  'Counterspell',
  'Cyclonic Rift',
  'Toxic Deluge',
  'Lightning Bolt',
  'Chaos Warp',
  'Beast Within',
  'Anguished Unmaking',
  "Assassin's Trophy",
  'Mortify',
  'Putrefy',
  'Vindicate',
  'Utter End',
  'Despark',
  'Wrath of God',
  'Supreme Verdict',
  'Terminate',
  'Lightning Helix',
  'Mystic Confluence',
  'Rhystic Study',
  'Demonic Tutor',
  'Vampiric Tutor',
  'Eternal Witness',
  'Growth Spiral',
  'Fact or Fiction',
  'Phyrexian Arena',
  'Sylvan Library',
  "Kolaghan's Command",
  "Esika's Chariot",
  'Niv-Mizzet Reborn',
  "Atraxa, Praetors' Voice",
  'Sisay, Weatherlight Captain',
  'Jhoira, Weatherlight Captain',
  'Urza, Lord High Artificer',
  'Korvold, Fae-Cursed King',
  'Garruk, Primal Hunter',
  "Elspeth, Sun's Champion",
  'Teferi, Hero of Dominaria',
  'Nicol Bolas, Dragon-God',
  'Kaalia of the Vast',
  'Maelstrom Wanderer',
  'Tatyova, Benthic Druid',
  'Thrasios, Triton Hero',
  'Tymna the Weaver',
  'Kenrith, the Returned King',
  'Omnath, Locus of Creation',
  'Kynaios and Tiro of Meletis',
  'Sliver Overlord',
  'The Ur-Dragon',
];

export const BRAGO_COMMANDER = 'Brago, King Eternal';

export const BRAGO_UNTAPPED_DUALS = [
  'Hallowed Fountain',
  'Tundra',
  'Command Tower',
  'Sea of Clouds',
  'Adarkar Wastes',
  'Glacial Fortress',
  'Deserted Beach',
  'Seachrome Coast',
  'Port Town',
  'Prairie Stream',
  'Hengegate Pathway',
  'Mystic Gate',
];

export const BRAGO_TAPPED_DUALS = [
  'Azorius Guildgate',
  'Tranquil Cove',
  'Meandering River',
  'Sejiri Refuge',
  'Irrigated Farmland',
  'Thriving Isle',
  'Thriving Heath',
  'Temple of Enlightenment',
  'Restless Anchorage',
  'Celestial Colonnade',
  'Idyllic Beachfront',
  'Meticulous Archive',
];

export const BRAGO_SPELLS = [
  'Sol Ring',
  'Arcane Signet',
  'Azorius Signet',
  'Talisman of Progress',
  'Mind Stone',
  'Thought Vessel',
  'Fellwar Stone',
  'Coldsteel Heart',
  'Swords to Plowshares',
  'Path to Exile',
  'Counterspell',
  'Mana Leak',
  'Arcane Denial',
  'Swan Song',
  'Brainstorm',
  'Ponder',
  'Absorb',
  "Dovin's Veto",
  'Supreme Verdict',
  'Wrath of God',
  'Cyclonic Rift',
  'Rhystic Study',
  'Mystic Remora',
  'Esper Sentinel',
  'Mother of Runes',
  'Thraben Inspector',
  'Spell Queller',
  'Deputy of Detention',
  'Teferi, Time Raveler',
  'Teferi, Hero of Dominaria',
  "Elspeth, Sun's Champion",
  'Sun Titan',
  'Consecrated Sphinx',
  'Restoration Angel',
  'Brutal Cathar',
  'Ephemerate',
  'Cloudshift',
  'Soulherder',
  'Felidar Guardian',
  'Charming Prince',
  'Flickerwisp',
  'Venser, Shaper Savant',
  'Archaeomancer',
  'Wall of Omens',
  'Thassa, Deep-Dwelling',
  "Conjurer's Closet",
  'Mulldrifter',
  'Reflector Mage',
  'Fact or Fiction',
  'Oblivion Ring',
  'Detention Sphere',
  'Banishing Light',
  "Sphinx's Revelation",
  'Lyra Dawnbringer',
  'Dream Trawler',
  'Grand Arbiter Augustin IV',
  'Timely Reinforcements',
  'Enlightened Tutor',
  'Mystical Tutor',
  'Fierce Guardianship',
  'Stoneforge Mystic',
  'Aven Mindcensor',
  'Opposition',
];

/** A deck as the simulator takes it. */
export interface FixtureDeck {
  commanders: ScryfallCard[];
  library: ScryfallCard[];
}

export function jodah(
  lands: ReadonlyArray<string | readonly [string, number]> = JODAH_LANDS
): FixtureDeck {
  return {
    commanders: [card(JODAH_COMMANDER)],
    library: cards([...lands, ...JODAH_RAMP, ...JODAH_SPELLS]),
  };
}

export function brago(
  duals: readonly string[],
  basics: { plains: number; islands: number } = { plains: 12, islands: 12 },
  spells: readonly string[] = BRAGO_SPELLS
): FixtureDeck {
  return {
    commanders: [card(BRAGO_COMMANDER)],
    library: cards([...duals, ['Plains', basics.plains], ['Island', basics.islands], ...spells]),
  };
}
