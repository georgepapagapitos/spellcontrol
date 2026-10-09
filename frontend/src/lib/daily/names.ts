/**
 * Every card name, for the guess box's suggestions. Names only: the server
 * scores guesses, so the browser holds nothing that points at the answer.
 * `public/daily-names.json` is written by scripts/refresh-daily-cards.mjs.
 */
export interface DailyNames {
  suggest(query: string, limit?: number): string[];
  size: number;
}

/** Lower-case and strip accents, so "lim-dul" finds "Lim-Dûl". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function buildNames(names: readonly string[]): DailyNames {
  const entries = names.map((name) => ({
    name,
    key: fold(name),
    faces: name.includes(' // ') ? name.split(' // ').map(fold) : [],
  }));
  return {
    size: entries.length,
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

let namesPromise: Promise<DailyNames> | null = null;

/** Fetched once per app-open; a failure clears the memo so a retry refetches. */
export function loadDailyNames(): Promise<DailyNames> {
  namesPromise ??= fetch('/daily-names.json')
    .then((res) => {
      if (!res.ok) throw new Error("Couldn't load the card list. Try again in a moment.");
      return res.json() as Promise<{ names: string[] }>;
    })
    .then((file) => buildNames(file.names))
    .catch((err: unknown) => {
      namesPromise = null;
      throw err;
    });
  return namesPromise;
}

/** Test hook: forget the memoized fetch. */
export function resetDailyNamesCache(): void {
  namesPromise = null;
}
