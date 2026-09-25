import { useEffect, useState } from 'react';
import { fetchProduct } from '../api';
import { importToDeck } from '../import-to-deck';
import { starterDeckLocalId } from '../starter-decks';

/**
 * Card names for the Horde ban-list check when a seat plays a starter deck
 * (a real MTGJSON precon, never in the decks store — see memory
 * `project_starter_decks_are_precons`). Resolved the same way the starter
 * playtest board resolves a starter (`fetchProduct` + `importToDeck`),
 * cached by file name since two seats can pick the same precon.
 */
const cache = new Map<string, readonly string[]>();

async function load(fileName: string): Promise<readonly string[]> {
  try {
    const resolved = await fetchProduct(fileName);
    const deck = importToDeck(resolved.deck, starterDeckLocalId(fileName), resolved.product.name);
    const names = [
      deck.commander?.name,
      deck.partnerCommander?.name,
      ...deck.cards.map((c) => c.card.name),
    ].filter((n): n is string => Boolean(n));
    cache.set(fileName, names);
    return names;
  } catch {
    // Best-effort, soft warning: a failed lookup checks nothing rather than
    // erroring the setup form.
    cache.set(fileName, []);
    return [];
  }
}

/**
 * Card names for each given starter file name, resolved lazily and cached.
 * A file name with no result yet is simply absent from the map (never a
 * loading state the form has to render) until the fetch lands, at which
 * point this re-renders with the resolved list.
 */
export function useStarterDeckCardNames(
  fileNames: readonly string[]
): ReadonlyMap<string, readonly string[]> {
  const [, bump] = useState(0);

  useEffect(() => {
    let cancelled = false;
    for (const fileName of fileNames) {
      if (cache.has(fileName)) continue;
      void load(fileName).then(() => {
        if (!cancelled) bump((n) => n + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [fileNames]);

  const result = new Map<string, readonly string[]>();
  for (const fileName of fileNames) {
    const names = cache.get(fileName);
    if (names) result.set(fileName, names);
  }
  return result;
}
