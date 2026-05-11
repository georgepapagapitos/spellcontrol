/**
 * Sample binder definitions + a small bundled card pack used by the
 * "Load samples" flow. The intent is to demo the rule system: each sample
 * binder shows off a different filter pattern, and the bundled cards are
 * curated so every sample binder has visible matches.
 *
 * Both pieces ship together. Loading samples imports the bundled cards
 * (tagged via import history with isSample) and creates the binder defs
 * (each with isSample on BinderDef). Users delete cards from import history
 * and binders via each binder's X — the explainer modal walks them through
 * this once when they click "Load samples".
 */

import type { BinderInput } from '../types';

export interface SampleBinderTemplate {
  /** Stable id for the template — used only for keys, not persisted. */
  templateId: string;
  /** Used to seed the BinderInput. The input is given a fresh id at create time. */
  input: Omit<BinderInput, 'position'>;
}

/**
 * Three binders, each one a *compound* filter so the demo highlights what
 * the rule editor can actually do — stacking type + legality, type + oracle
 * text, CMC + oracle chips. Routing is first-match-wins (see
 * `materialize.ts`), so order is chosen so each binder catches cards
 * without starving the next.
 *
 *   1. Commanders         — typeChip 'legendary creature' + commander legal
 *   2. Removal & counters — oracle text chips (multi-value OR)
 *   3. Mana rocks         — typeChip 'artifact' + oracle text 'add'
 */
export const SAMPLE_BINDERS: SampleBinderTemplate[] = [
  {
    templateId: 'commanders',
    input: {
      name: 'Commanders',
      color: '#c89820',
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      filterGroups: [
        {
          filter: {
            typeChips: [{ value: 'legendary creature', negate: false }],
            legalities: [{ value: 'commander', negate: false }],
          },
        },
      ],
      sorts: ['color', 'name'],
      isSample: true,
    },
  },
  {
    templateId: 'removal',
    input: {
      name: 'Removal & counters',
      color: '#d05030',
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      filterGroups: [
        {
          filter: {
            oracleChips: [
              { value: 'destroy target', negate: false },
              { value: 'exile target', negate: false },
              { value: 'counter target spell', negate: false },
            ],
          },
        },
      ],
      sorts: ['cmc', 'color', 'name'],
      isSample: true,
    },
  },
  {
    templateId: 'mana-rocks',
    input: {
      name: 'Mana rocks',
      color: '#7060a0',
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      filterGroups: [
        {
          filter: {
            typeChips: [{ value: 'artifact', negate: false }],
            oracleChips: [{ value: 'add', negate: false }],
          },
        },
      ],
      sorts: ['cmc', 'name'],
      isSample: true,
    },
  },
];

interface SampleCardEntry {
  name: string;
  foil?: boolean;
}

/**
 * Curated starter pack — chosen so each sample binder above lights up with
 * visible matches. A handful are flagged as foil so the demo also shows
 * foil-vs-nonfoil rendering and price differentiation. Sent to the import
 * endpoint as a tiny CSV (name,foil header) so the foil column is honored
 * by the generic-csv parser.
 */
export const SAMPLE_CARDS: SampleCardEntry[] = [
  // Mythics + premium overlap
  { name: "Atraxa, Praetors' Voice", foil: true },
  { name: 'Sheoldred, the Apocalypse', foil: true },
  { name: 'Wurmcoil Engine' },
  { name: 'Ulamog, the Ceaseless Hunger' },
  { name: 'Liliana of the Veil', foil: true },
  { name: 'Wrenn and Six' },
  { name: 'Teferi, Time Raveler' },
  { name: 'Grand Abolisher' },
  { name: 'Maelstrom Wanderer' },
  { name: 'Niv-Mizzet, Parun' },
  { name: "Kroxa, Titan of Death's Hunger" },

  // Premium / expensive staples
  { name: 'Mana Crypt', foil: true },
  { name: 'Mana Drain' },
  { name: 'Force of Will' },
  { name: 'Wheel of Fortune', foil: true },
  { name: 'Chrome Mox' },
  { name: 'Mox Diamond' },

  // Commander / EDH staples (cheap to mid)
  { name: 'Sol Ring', foil: true },
  { name: 'Arcane Signet' },
  { name: 'Cyclonic Rift' },
  { name: 'Counterspell' },
  { name: 'Swords to Plowshares' },
  { name: 'Path to Exile' },
  { name: 'Rhystic Study' },
  { name: 'Smothering Tithe' },
  { name: 'Lightning Greaves' },
  { name: 'Sword of Feast and Famine' },
  { name: 'Eternal Witness' },
  { name: 'Solemn Simulacrum' },
  { name: 'Birds of Paradise' },
  { name: 'Demonic Tutor' },

  // Lands
  { name: 'Command Tower' },
  { name: 'Reliquary Tower' },
  { name: 'Bojuka Bog' },
  { name: 'Reflecting Pool' },
  { name: 'Strip Mine' },
  { name: 'Wasteland' },
  { name: 'Misty Rainforest', foil: true },
  { name: 'Verdant Catacombs' },
  { name: 'Scalding Tarn' },
  { name: 'Polluted Delta' },

  // More commanders + removal + mana rocks (rounding to 50 with extra coverage)
  { name: 'Edgar Markov' },
  { name: "Yuriko, the Tiger's Shadow" },
  { name: 'Kenrith, the Returned King' },
  { name: 'Beast Within' },
  { name: 'Anguished Unmaking' },
  { name: 'Generous Gift' },
  { name: 'Thran Dynamo' },
  { name: 'Worn Powerstone' },
  { name: 'Talisman of Dominance' },
];

export const SAMPLE_IMPORT_LABEL = 'Sample: starter pack';

/**
 * Build the CSV payload sent to /api/import. Headers are `name,foil`; the
 * backend's generic-csv parser maps both columns by name so the order is
 * just for readability. Names are double-quoted because some include commas
 * (e.g. "Atraxa, Praetors' Voice").
 */
export function sampleCardsAsCsv(): string {
  const rows = SAMPLE_CARDS.map(
    (c) => `"${c.name.replace(/"/g, '""')}",${c.foil ? 'foil' : 'nonfoil'}`
  );
  return ['name,finish', ...rows].join('\n');
}
