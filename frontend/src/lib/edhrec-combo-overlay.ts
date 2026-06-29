import { useEffect, useState } from 'react';
import { fetchCommanderCombos, fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import type { EDHRECCombo } from '@/deck-builder/types';

/**
 * Per-commander EDHREC combo stats, overlaid onto the Spellbook combo matches
 * shown in the deck combos panel (E63). EDHREC has no global combo dump — its
 * combo data lives per-commander at /pages/combos/{slug}.json — so this is a
 * client-side enrichment keyed by commander, never a backend join. When EDHREC
 * has no entry for a combo (or the deck has no commander, or we're offline) the
 * combo simply keeps its global Spellbook `popularity` ordering. That preserves
 * full offline Spellbook coverage by construction.
 */
export interface EdhrecComboStat {
  /** EDHREC's rank for this combo among the commander's combos (1 = top). */
  rank: number;
  /** Decks of this commander running the combo (EDHREC's own count). */
  deckCount: number;
  /** Share of this commander's sampled decks running the combo, 0–100, or
   *  null when the commander deck total is unknown. */
  percent: number | null;
  /** EDHREC combo-page path (e.g. "/combos/golgari/250-779"), or null. */
  href: string | null;
}

/** Map from a combo's card-name-set key (see {@link comboNameKey}) to its
 *  EDHREC stats. */
export type EdhrecComboOverlay = Map<string, EdhrecComboStat>;

/**
 * Join key for matching an EDHREC combo to a Spellbook combo: the set of card
 * names, normalized (lowercased, trimmed) and sorted so order doesn't matter.
 * The two datasets use different combo id spaces (EDHREC "250-779" vs Spellbook
 * UUID), so a name-set join is the only cross-link. Combos whose names don't
 * line up (rare spelling/DFC differences) just don't get overlaid.
 */
export function comboNameKey(cardNames: string[]): string {
  return cardNames
    .map((n) => n.trim().toLowerCase())
    .sort()
    .join('|');
}

/** Pure builder — exported for testing without React/network. */
export function buildComboOverlay(combos: EDHRECCombo[], totalDecks: number): EdhrecComboOverlay {
  const map: EdhrecComboOverlay = new Map();
  for (const c of combos) {
    const key = comboNameKey(c.cards.map((cc) => cc.name));
    if (!key) continue;
    const percent =
      totalDecks > 0 ? Math.min(100, Math.max(0, (c.deckCount / totalDecks) * 100)) : null;
    // EDHREC returns combos sorted by deckCount desc; on a name-key collision
    // keep the more-popular (first) entry.
    if (!map.has(key)) {
      map.set(key, { rank: c.rank, deckCount: c.deckCount, percent, href: c.href ?? null });
    }
  }
  return map;
}

/**
 * Fetches the commander's EDHREC combo page (+ deck total for the percent
 * denominator) and returns the overlay map. Both fetches are cached and
 * best-effort; a null/empty commander yields an empty map (no overlay). The
 * commander page fetch only powers `percent`, so its failure degrades to
 * percent-less stats rather than dropping the overlay.
 */
const EMPTY_OVERLAY: EdhrecComboOverlay = new Map();

export function useEdhrecComboOverlay(
  commanderName: string | null | undefined
): EdhrecComboOverlay {
  // Tagged with the commander it was built for, so a commander switch returns
  // the empty overlay until the new fetch resolves rather than flashing the
  // previous commander's stats. setState only fires inside the async callback.
  const [resolved, setResolved] = useState<{ name: string; map: EdhrecComboOverlay } | null>(null);

  useEffect(() => {
    if (!commanderName) return;
    let cancelled = false;
    void (async () => {
      const [combos, data] = await Promise.all([
        fetchCommanderCombos(commanderName),
        fetchCommanderData(commanderName).catch(() => null),
      ]);
      if (cancelled) return;
      setResolved({
        name: commanderName,
        map: buildComboOverlay(combos, data?.stats?.numDecks ?? 0),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [commanderName]);

  return commanderName && resolved?.name === commanderName ? resolved.map : EMPTY_OVERLAY;
}
