import type { ReactNode } from 'react';
import type { ScryfallCard, EDHRECTopCommander } from '@/deck-builder/types';
import type { Idea } from '@/lib/deck/idea-index';
import { buildCommanderKey } from '@/lib/deck/commander-key';
import type { CommanderStats } from '@/lib/discover/aggregates-client';
import {
  fetchCommandersWithinColors,
  fetchTopCommanders,
} from '@/deck-builder/services/edhrec/client';
import type { ColorMode, FinderEntry } from '@/lib/deck/commander-finder';
import type { EnrichedCard } from '../../types';

/** Parallel EDHREC page fetches while scoring a whole list (the client throttles too). */
export const SCORE_CONCURRENCY = 4;

/** A result, with whatever it came from: an owned copy, a Scryfall card, or only a name. */
export type Entry = FinderEntry & {
  owned?: EnrichedCard;
  card?: ScryfallCard;
  imageUrl?: string;
};

export async function runPool<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
  cancelled: () => boolean
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SCORE_CONCURRENCY, items.length) }, async () => {
      while (!cancelled() && next < items.length) await fn(items[next++]);
    })
  );
}

/** EDHREC's popular list for the color filter. */
export function fetchPopular(
  colors: ReadonlySet<string>,
  mode: ColorMode
): Promise<EDHRECTopCommander[]> {
  if (colors.size === 0) return fetchTopCommanders([]);
  return mode === 'within' && !colors.has('C')
    ? fetchCommandersWithinColors([...colors])
    : fetchTopCommanders([...colors]);
}

export const identityOf = (ci: readonly string[] | undefined): string[] =>
  ci && ci.length > 0 ? [...ci] : ['C'];

export const popularEntry = (c: EDHRECTopCommander, i: number): Entry => ({
  key: c.sanitized || c.name,
  name: c.name,
  colors: c.colorsUnknown ? [] : identityOf(c.colorIdentity),
  colorsUnknown: c.colorsUnknown,
  popularity: i,
  numDecks: c.numDecks,
  playstyleIds: [],
});

/**
 * Resolves the commander-picker platform-deck-count badge (social W4) for a
 * settled list of visible commanders: looks up each one's oracle id via the
 * already cache-backed `getCardByName`, builds each commander key, and fires
 * ONE batch lookup — never per row. A candidate whose name fails to resolve
 * (offline, or a name Scryfall doesn't recognize) is skipped rather than
 * failing the whole batch.
 *
 * Exported and dependency-injected so it's directly unit-testable.
 */
export async function resolvePlatformCounts(
  candidates: Array<{ name: string }>,
  deps: {
    getCardByName: (name: string) => Promise<ScryfallCard>;
    getCommanderStatsBatch: (keys: string[]) => Promise<Map<string, CommanderStats>>;
  }
): Promise<Map<string, number>> {
  const resolved = await Promise.all(
    candidates.map(async (c) => {
      try {
        return await deps.getCardByName(c.name);
      } catch {
        return null;
      }
    })
  );
  const keyToName = new Map<string, string>();
  resolved.forEach((card, i) => {
    if (card) keyToName.set(buildCommanderKey(card.oracle_id), candidates[i].name);
  });
  if (keyToName.size === 0) return new Map();

  const stats = await deps.getCommanderStatsBatch([...keyToName.keys()]);
  const out = new Map<string, number>();
  for (const [key, name] of keyToName) {
    const s = stats.get(key);
    if (s) out.set(name.toLowerCase(), s.deckCount);
  }
  return out;
}

/**
 * The generator's finder layout (E1113): one search box that also takes a deck idea as a chip,
 * build-around rows while nothing is applied, and a one-row summary once a commander is chosen.
 * An idea is a filter on the one grid: with it, the grid's source is the idea's EDHREC list.
 * Other pickers (Brew, the deck editor, the import dialogs) don't pass it and keep the plain finder.
 */
export interface IdeaFinderProps {
  /** An idea to apply on open (the `?idea=` link). */
  initialSlug?: string | null;
  /**
   * A pick made while an idea is applied. Resolves once the caller has taken the commander, so the
   * tile can say "Loading…" until then.
   */
  onPickWithIdea: (card: ScryfallCard, idea: Idea, numDecks?: number) => Promise<void>;
  /** The line under the chosen commander's name ("From the Angels idea · 175 decks"). */
  selectedNote?: string | null;
  /** Beside "Change commander" in the summary row. */
  selectedExtra?: ReactNode;
}
