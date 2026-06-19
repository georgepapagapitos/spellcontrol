// Fetches official card rulings from the backend (`/api/cards/:id/rulings`,
// Scryfall-sourced, SQLite-cached server-side). Promises are memoized per
// Scryfall ID so re-opening the same card doesn't refetch; failures evict so a
// later attempt can retry.

export interface Ruling {
  published_at: string;
  comment: string;
  source: string;
}

const cache = new Map<string, Promise<Ruling[]>>();

export function fetchCardRulings(scryfallId: string): Promise<Ruling[]> {
  let p = cache.get(scryfallId);
  if (!p) {
    p = fetch(`/api/cards/${scryfallId}/rulings`)
      .then((r) => {
        if (!r.ok) throw new Error(`Rulings request failed (${r.status})`);
        return r.json() as Promise<{ rulings: Ruling[] }>;
      })
      .then((d) => d.rulings)
      .catch((err) => {
        cache.delete(scryfallId);
        throw err;
      });
    cache.set(scryfallId, p);
  }
  return p;
}
