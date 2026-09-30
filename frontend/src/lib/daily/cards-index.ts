import { RARITIES, type CardAttrs } from './score';

/** `public/daily-cards.json` as scripts/refresh-daily-cards.mjs writes it. */
interface DailyCardsFile {
  version: number;
  generatedAt: string;
  rarities: string[];
  /** [name, colors, mv, typeLine, rarityIndex, year] */
  cards: [string, string, number, string, number, number][];
}

export interface DailyCardIndex {
  /** Exact lookup by lower-cased full name or by any single face's name. */
  get(name: string): CardAttrs | undefined;
  /** Name suggestions: prefix matches first, then matches inside the name. */
  suggest(query: string, limit?: number): string[];
  size: number;
}

/** Lower-case and strip accents, so "lim-dul" finds "Lim-Dûl". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function buildCardIndex(file: DailyCardsFile): DailyCardIndex {
  const rarityNames = file.rarities.length > 0 ? file.rarities : [...RARITIES];
  const byKey = new Map<string, CardAttrs>();
  const entries: { key: string; faces: string[]; name: string }[] = [];
  for (const [name, colors, mv, typeLine, rarityIdx, year] of file.cards) {
    const rarity = (rarityNames[rarityIdx] ?? 'special') as CardAttrs['rarity'];
    const attrs: CardAttrs = { name, colors, mv, typeLine, rarity, year };
    const key = fold(name);
    byKey.set(key, attrs);
    const faces = name.includes(' // ') ? name.split(' // ').map(fold) : [];
    for (const f of faces) if (!byKey.has(f)) byKey.set(f, attrs);
    entries.push({ key, faces, name });
  }

  return {
    size: entries.length,
    get: (name) => byKey.get(fold(name)),
    suggest(query, limit = 8) {
      const q = fold(query);
      if (q.length < 2) return [];
      const prefix: string[] = [];
      const inside: string[] = [];
      for (const e of entries) {
        if (e.key.startsWith(q) || e.faces.some((f) => f.startsWith(q))) prefix.push(e.name);
        else if (inside.length < limit && e.key.includes(q)) inside.push(e.name);
        if (prefix.length >= limit) break;
      }
      return [...prefix, ...inside].slice(0, limit);
    },
  };
}

let indexPromise: Promise<DailyCardIndex> | null = null;

/** Fetched once per app-open (~460 KB compressed); a failure clears the memo. */
export function loadCardIndex(): Promise<DailyCardIndex> {
  indexPromise ??= fetch('/daily-cards.json')
    .then((res) => {
      if (!res.ok) throw new Error("Couldn't load the card list. Try again in a moment.");
      return res.json() as Promise<DailyCardsFile>;
    })
    .then(buildCardIndex)
    .catch((err: unknown) => {
      indexPromise = null;
      throw err;
    });
  return indexPromise;
}

/** Test hook: forget the memoised fetch. */
export function resetCardIndexCache(): void {
  indexPromise = null;
}
