/**
 * The EDHREC theme pages a deck is built from, fetched and merged into one
 * pool. Moved out of dataAcquisition.ts unchanged so the manual-deck analysis
 * (Coach) can read the same page a generated deck was built from (T171).
 */
import { logger } from '@/lib/util/logger';
import type {
  EDHRECCard,
  EDHRECCommanderData,
  TargetBracket,
  BudgetOption,
  ThemeResult,
} from '@/deck-builder/types';
import {
  fetchCommanderThemeData,
  fetchPartnerThemeData,
} from '@/deck-builder/services/edhrec/client';
import { calculateCardPriority } from '../cardPicking';

// ── Merge cardlists from multiple theme results ──
// Verbatim, relocated from deckGenerator.ts.
export function mergeThemeCardlists(themeDataResults: EDHRECCommanderData[]): {
  cardlists: EDHRECCommanderData['cardlists'];
  themeOverlapCounts: Map<string, number>;
} {
  // Track how many themes each card appears in (for hyper focus mode)
  const themeOverlapCounts = new Map<string, number>();

  // Merge all cards, keeping the best version for duplicates
  // Prioritize: highest synergy first, then highest inclusion
  const mergeCards = (cards: EDHRECCard[][]): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();

    for (const cardList of cards) {
      // Track which cards we've seen in THIS theme's list to avoid double-counting
      const seenInThisList = new Set<string>();
      for (const card of cardList) {
        if (!seenInThisList.has(card.name)) {
          seenInThisList.add(card.name);
          themeOverlapCounts.set(card.name, (themeOverlapCounts.get(card.name) ?? 0) + 1);
        }

        const existing = cardMap.get(card.name);
        if (!existing) {
          cardMap.set(card.name, card);
        } else {
          // Keep the card with better synergy, or if tied, better inclusion
          const existingSynergy = existing.synergy ?? 0;
          const newSynergy = card.synergy ?? 0;

          if (
            newSynergy > existingSynergy ||
            (newSynergy === existingSynergy && card.inclusion > existing.inclusion)
          ) {
            cardMap.set(card.name, card);
          }
        }
      }
    }

    // Sort by priority (synergy-aware)
    return Array.from(cardMap.values()).sort(
      (a, b) => calculateCardPriority(b) - calculateCardPriority(a)
    );
  };

  const cardlists = {
    creatures: mergeCards(themeDataResults.map((r) => r.cardlists.creatures)),
    instants: mergeCards(themeDataResults.map((r) => r.cardlists.instants)),
    sorceries: mergeCards(themeDataResults.map((r) => r.cardlists.sorceries)),
    artifacts: mergeCards(themeDataResults.map((r) => r.cardlists.artifacts)),
    enchantments: mergeCards(themeDataResults.map((r) => r.cardlists.enchantments)),
    planeswalkers: mergeCards(themeDataResults.map((r) => r.cardlists.planeswalkers)),
    lands: mergeCards(themeDataResults.map((r) => r.cardlists.lands)),
    allNonLand: mergeCards(themeDataResults.map((r) => r.cardlists.allNonLand)),
  };

  return { cardlists, themeOverlapCounts };
}

/**
 * Fetch + merge all selected EDHREC themes for a given bracket (or `undefined`
 * for the bracket-agnostic page). Each theme's fetch failure is swallowed
 * (logged) so one theme's 404/network error doesn't sink the others; returns
 * `null` only when every theme failed. Shared by the normal fetch phase and
 * the E93 thinness fallback ladder below, so both go through one fetch+merge
 * path instead of two hand-rolled copies.
 */
export async function fetchMergedThemeData(
  themes: ThemeResult[],
  commanderName: string,
  partnerCommanderName: string | undefined,
  budgetOption: BudgetOption | undefined,
  bracket: TargetBracket | undefined
): Promise<{ data: EDHRECCommanderData; themeOverlapCounts: Map<string, number> } | null> {
  const results = await Promise.all(
    themes.map((theme) =>
      (partnerCommanderName
        ? fetchPartnerThemeData(
            commanderName,
            partnerCommanderName,
            theme.slug!,
            budgetOption,
            bracket
          )
        : fetchCommanderThemeData(commanderName, theme.slug!, budgetOption, bracket)
      ).catch((err) => {
        logger.warn(`[DeckGen] theme fetch failed, skipping "${theme.slug}":`, err);
        return null;
      })
    )
  );
  const ok = results.filter((r): r is EDHRECCommanderData => r != null);
  if (ok.length === 0) return null;
  const merged = mergeThemeCardlists(ok);
  return {
    data: { themes: [], stats: ok[0].stats, cardlists: merged.cardlists, similarCommanders: [] },
    themeOverlapCounts: merged.themeOverlapCounts,
  };
}
