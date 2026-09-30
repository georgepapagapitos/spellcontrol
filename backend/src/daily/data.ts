import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RARITIES, type CardAttrs, type Rarity } from './score';

/** One answer-pool entry, exactly as refresh-daily-cards.mjs writes it. */
export interface PoolCard {
  name: string;
  colors: string;
  mv: number;
  typeLine: string;
  rarity: Rarity;
  year: number;
  setName: string;
  rulesText: string;
  flavor: string;
  art: string;
}

interface CardsFile {
  rarities: string[];
  cards: [string, string, number, string, number, number][];
}

interface Loaded {
  pool: PoolCard[];
  byKey: Map<string, CardAttrs>;
}

let dirOverride: string | null = null;
let loaded: Loaded | null = null;

/** Point the loader at another directory (tests) and drop the cache. Null restores the default. */
export function setDailyDataDir(dir: string | null): void {
  dirOverride = dir;
  loaded = null;
}

function dataDir(): string {
  return (
    dirOverride ?? process.env.DAILY_DATA_DIR ?? path.join(__dirname, '..', '..', 'data', 'daily')
  );
}

/** Case- and accent-insensitive key, so an accented name and its plain spelling match. */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function load(): Loaded {
  if (loaded) return loaded;
  const dir = dataDir();
  const pool = (
    JSON.parse(readFileSync(path.join(dir, 'pool.json'), 'utf8')) as { cards: PoolCard[] }
  ).cards;
  const cards = JSON.parse(readFileSync(path.join(dir, 'cards.json'), 'utf8')) as CardsFile;
  const byKey = new Map<string, CardAttrs>();
  const faces = new Map<string, CardAttrs>();
  for (const [name, colors, mv, typeLine, rarityIdx, year] of cards.cards) {
    const attrs: CardAttrs = {
      name,
      colors,
      mv,
      typeLine,
      rarity: (cards.rarities[rarityIdx] as Rarity | undefined) ?? RARITIES[RARITIES.length - 1]!,
      year,
    };
    byKey.set(nameKey(name), attrs);
    if (name.includes(' // ')) {
      for (const face of name.split(' // ')) {
        const k = nameKey(face);
        if (!faces.has(k)) faces.set(k, attrs);
      }
    }
  }
  // A full name always beats a face that happens to spell the same.
  for (const [k, v] of faces) if (!byKey.has(k)) byKey.set(k, v);
  loaded = { pool, byKey };
  return loaded;
}

export function getAnswerPool(): PoolCard[] {
  return load().pool;
}

/** Resolve a typed name to its card, matching either face of a double-faced card. */
export function findCard(name: string): CardAttrs | null {
  return load().byKey.get(nameKey(name)) ?? null;
}

export function attrsOf(p: PoolCard): CardAttrs {
  return {
    name: p.name,
    colors: p.colors,
    mv: p.mv,
    typeLine: p.typeLine,
    rarity: p.rarity,
    year: p.year,
  };
}
