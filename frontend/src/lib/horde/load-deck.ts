import type { PlaytestCard } from '@/lib/playtest';
import type { HordeDeckDef } from './library';

/** Shape of the baked JSON under `./decks/*.json` — everything the board
 *  needs at play time, so nothing is fetched from Scryfall then. */
interface RawCardEntry {
  name: string;
  scryfallId: string;
  imageUrl?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
  manaCost?: string;
  count: number;
}

interface RawBossEntry {
  name: string;
  scryfallId: string;
  imageUrl?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
  manaCost?: string;
}

interface RawHordeDeck {
  id: string;
  name: string;
  specialRule: string;
  tokens: RawCardEntry[];
  spells: RawCardEntry[];
  bosses: RawBossEntry[];
  lateGame: string[];
}

/** One `import()` per deck id, kept as separate literal calls (not a
 *  template-string path) so the bundler splits each deck into its own
 *  lazily-loaded chunk — picking one horde never pulls in the other five. */
async function importDeckJson(id: string): Promise<RawHordeDeck> {
  switch (id) {
    case 'zombies':
      return (await import('./decks/zombies.json')).default;
    case 'slivers':
      return (await import('./decks/slivers.json')).default;
    case 'dinosaurs':
      return (await import('./decks/dinosaurs.json')).default;
    case 'eldrazi':
      return (await import('./decks/eldrazi.json')).default;
    case 'goblins':
      return (await import('./decks/goblins.json')).default;
    case 'battle-the-horde':
      return (await import('./decks/battle-the-horde.json')).default;
    default:
      throw new Error(`Unknown horde deck: ${id}`);
  }
}

function expandCopies(
  entries: RawCardEntry[],
  deckId: string,
  group: string,
  isToken: boolean
): PlaytestCard[] {
  const out: PlaytestCard[] = [];
  entries.forEach((entry, entryIndex) => {
    for (let copy = 0; copy < entry.count; copy++) {
      out.push({
        id: `${deckId}-${group}-${entryIndex}-${copy}`,
        name: entry.name,
        scryfallId: entry.scryfallId,
        imageUrl: entry.imageUrl,
        typeLine: entry.typeLine,
        power: entry.power,
        toughness: entry.toughness,
        manaCost: entry.manaCost,
        isToken,
      });
    }
  });
  return out;
}

function expandBosses(entries: RawBossEntry[], deckId: string): PlaytestCard[] {
  return entries.map((entry, i) => ({
    id: `${deckId}-boss-${i}`,
    name: entry.name,
    scryfallId: entry.scryfallId,
    imageUrl: entry.imageUrl,
    typeLine: entry.typeLine,
    power: entry.power,
    toughness: entry.toughness,
    manaCost: entry.manaCost,
  }));
}

/** cyrb53: a small, fast, non-cryptographic string hash, enough to tell two
 *  builds' copies of a deck apart. */
export function hashDeckSource(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

/** Load one horde's deck definition, expanding authored copy counts into one
 *  `PlaytestCard` per physical copy with a unique id. */
export async function loadHordeDeck(id: string): Promise<HordeDeckDef> {
  const raw = await importDeckJson(id);
  return {
    id: raw.id,
    name: raw.name,
    specialRule: raw.specialRule,
    tokens: expandCopies(raw.tokens, raw.id, 'token', true),
    spells: expandCopies(raw.spells, raw.id, 'spell', false),
    bosses: expandBosses(raw.bosses, raw.id),
    lateGame: raw.lateGame,
    rev: hashDeckSource(JSON.stringify(raw)),
  };
}
