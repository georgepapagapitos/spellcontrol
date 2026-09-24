import type { HordeSettings } from './settings';

/** Metadata for one horde, shown on the setup screen before its deck JSON is
 *  ever fetched (see `load-deck.ts`). */
export interface HordeCatalogEntry {
  id: string;
  name: string;
  badge: string;
  /** Mana-symbol letters ('W'|'U'|'B'|'R'|'G'|'C') for the setup tile. */
  themeColors: string[];
  credit: string;
  specialRule: string;
  /** Scryfall `art_crop` of a signature card. */
  tileArt: string;
  librarySize: number;
  /** Field-by-field overrides layered onto the chosen difficulty preset. */
  settings?: Partial<HordeSettings>;
}

export const HORDE_CATALOG: HordeCatalogEntry[] = [
  {
    id: 'zombies',
    name: 'Zombies',
    badge: 'Classic',
    themeColors: ['B'],
    credit: "After Peter Knudson's original horde (2011)",
    specialRule:
      'Every Zombie has haste and must attack each turn if able. When a card forces the Horde to choose, make that choice at random.',
    tileArt:
      'https://cards.scryfall.io/art_crop/front/3/b/3b4faa6e-5013-4c59-80f5-662a386672eb.jpg?1783904558',
    librarySize: 100,
  },
  {
    id: 'slivers',
    name: 'Slivers',
    badge: 'Horde',
    themeColors: ['W', 'U', 'B', 'R', 'G'],
    credit: 'SpellControl',
    specialRule:
      "Some Sliver lords buff every Sliver on the battlefield, including any the survivors control, not just the Horde's own.",
    tileArt:
      'https://cards.scryfall.io/art_crop/front/8/7/87545415-2e27-4841-a3af-7653af2ba6d3.jpg?1783927759',
    librarySize: 100,
  },
  {
    id: 'dinosaurs',
    name: 'Dinosaurs',
    badge: 'Horde',
    themeColors: ['R', 'G', 'W'],
    credit: 'SpellControl',
    specialRule:
      'Enrage triggers whenever a Dinosaur is dealt damage in combat and survives it. Resolve the bonus immediately.',
    tileArt:
      'https://cards.scryfall.io/art_crop/front/b/c/bc4a65de-23b5-48f0-b8b7-94608eaced3e.jpg?1783913733',
    librarySize: 100,
  },
  {
    id: 'eldrazi',
    name: 'Eldrazi',
    badge: 'Horde',
    themeColors: ['C'],
    credit: 'SpellControl',
    specialRule:
      'Eldrazi Spawn and Scion tokens have a sacrifice-for-mana ability the Horde never activates. Treat it as inert flavor text.',
    tileArt:
      'https://cards.scryfall.io/art_crop/front/c/7/c74ae706-b3b3-4097-a387-6f6c38a9b603.jpg?1783915730',
    librarySize: 100,
  },
  {
    id: 'goblins',
    name: 'Goblins',
    badge: 'Horde',
    themeColors: ['R'],
    credit: 'SpellControl',
    specialRule:
      'Activated abilities on Horde permanents are never used since the Horde has no pilot. When Mob Rule resolves, flip a coin to choose its mode.',
    tileArt:
      'https://cards.scryfall.io/art_crop/front/2/c/2c716d10-2130-43b7-a939-349d437e1091.jpg?1783930502',
    librarySize: 100,
  },
  {
    id: 'battle-the-horde',
    name: 'Battle the Horde',
    badge: 'Official',
    themeColors: ['R'],
    credit: 'Wizards of the Coast, Born of the Gods (2014)',
    specialRule:
      "Each horde turn reveals the top two cards, plus one more for every artifact the horde controls, and each artifact's hero's reward can be claimed once the horde is defeated.",
    tileArt:
      'https://cards.scryfall.io/art_crop/front/5/5/553ae9d2-3807-4ca8-a575-7fa6667ee212.jpg?1783939504',
    librarySize: 60,
    settings: { reveal: { kind: 'fixed', count: 2, plusPerArtifact: true } },
  },
];
