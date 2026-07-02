// Scryfall-search fallback fill: used when EDHREC pools can't satisfy a slot
// target. Extracted verbatim from deckGenerator.ts.
import { logger } from '@/lib/logger';
import type { ScryfallCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import { BudgetTracker } from './budgetTracker';
import {
  exceedsMaxPrice,
  exceedsMaxRarity,
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
} from './deckFilters';
import { frontFaceName } from '@/lib/card-text';
import { buildSynergyFingerprint, synergyScore } from './synergyFingerprint';
import type { BracketGuard } from './bracketGuard';

// Hard gates the EDHREC-pool picker (cardPicking.ts) enforces but a raw
// Scryfall search can't express in its query string. Threaded here so the
// fallback fill can never admit a card the primary path would have rejected
// (E71 controls audit): salt tolerance, the game-changer cap, and the
// target-bracket ceilings. All shared refs — counts accumulate across every
// fill in the same generation, exactly like the picking phases.
export interface FillHardGates {
  isSaltBlocked?: (name: string) => boolean;
  bracketGuard?: BracketGuard;
  gameChangerNames?: Set<string>;
  gameChangerCount?: { value: number };
  maxGameChangers?: number;
}

// Fill remaining slots with Scryfall search (fallback)
export async function fillWithScryfall(
  query: string,
  colorIdentity: string[],
  count: number,
  usedNames: Set<string>,
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  currency: 'USD' | 'EUR' = 'USD',
  arenaOnly: boolean = false,
  scryfallQuery: string = '',
  collectionStrategy: CollectionStrategy = 'full',
  ignoreOwnedBudget: boolean = false,
  ignoreOwnedRarity: boolean = false,
  cardAllowed?: (card: ScryfallCard) => boolean,
  // EDHREC lift clusterScore lookup (E71 slice 2), lowercase name -> score,
  // 0 for cards with no lift connectivity. Primary re-rank key below — with
  // no lift data every score is 0, so the sort falls through to today's
  // fingerprint order unchanged.
  liftScoreOf?: (name: string) => number,
  gates?: FillHardGates
): Promise<ScryfallCard[]> {
  if (count <= 0) return [];

  // Add rarity filter to Scryfall query if set (skip when owned cards can bypass rarity)
  let fullQuery = query;
  if (maxRarity && !ignoreOwnedRarity) {
    fullQuery += ` r<=${maxRarity}`;
  }
  // Add CMC cap to Scryfall query (Tiny Leaders)
  if (maxCmc !== null) {
    fullQuery += ` cmc<=${maxCmc}`;
  }
  // Restrict to Arena-available cards
  if (arenaOnly) {
    fullQuery += ` game:arena`;
  }
  // Append user's additional Scryfall filters
  if (scryfallQuery.trim()) {
    fullQuery += ` ${scryfallQuery.trim()}`;
  }

  try {
    const response = await searchCards(fullQuery, colorIdentity, { order: 'edhrec' });

    // Pass 1: cards clearing the static gates, in Scryfall's global edhrec order.
    // Budget is applied in pass 2 since its cap moves as we deduct.
    const passing: ScryfallCard[] = [];
    for (const card of response.data) {
      if (usedNames.has(card.name)) continue; // Commander format is always singleton
      if (bannedCards.has(card.name)) continue; // Skip banned cards
      if (cardAllowed && !cardAllowed(card)) continue;
      if (constrainsToCollection(collectionStrategy) && notInCollection(card.name, collectionNames))
        continue;
      if (!isOwnedRarityExempt(card.name, collectionNames, ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, maxRarity)) continue;
      }
      if (exceedsCmcCap(card, maxCmc)) continue;
      if (notOnArena(card, arenaOnly)) continue;
      if (gates?.isSaltBlocked?.(card.name)) continue;
      passing.push(card);
    }

    // In owned-only modes the candidates are all cards the user happens to own of
    // this type — Scryfall's global edhrec_rank says nothing about their fit with
    // this commander. Re-rank by how well each card's tagger tags match the deck
    // built so far (usedNames), so slots fill with the most on-theme owned card
    // rather than just the globally-best legal one. Stable sort → cards with no
    // shared tags keep their edhrec order. Other modes are left untouched.
    if (constrainsToCollection(collectionStrategy)) {
      const fingerprint = buildSynergyFingerprint(usedNames);
      if (fingerprint.size > 0) {
        const scored = passing.map((card, i) => ({
          card,
          i,
          l: liftScoreOf?.(card.name) ?? 0,
          s: synergyScore(card.name, fingerprint),
        }));
        scored.sort((a, b) => b.l - a.l || b.s - a.s || a.i - b.i);
        passing.length = 0;
        for (const { card } of scored) passing.push(card);
      }
    }

    // Pass 2: take up to `count`, applying the dynamic budget/price gate in order.
    const result: ScryfallCard[] = [];
    for (const card of passing) {
      if (result.length >= count) break;
      const ownedExempt = isOwnedBudgetExempt(card.name, collectionNames, ignoreOwnedBudget);
      if (!ownedExempt) {
        const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
        if (exceedsMaxPrice(card, effectiveCap, currency)) continue;
      }
      // Running-count gates (checked at accept time, like cardPicking's tryPick,
      // so counts shared with the picking phases stay accurate).
      if (gates?.bracketGuard?.exceedsCeiling(card.name)) continue;
      const isGC = gates?.gameChangerNames?.has(card.name) ?? false;
      if (
        isGC &&
        gates?.gameChangerCount &&
        gates.maxGameChangers !== undefined &&
        gates.gameChangerCount.value >= gates.maxGameChangers
      )
        continue;
      if (isGC && gates?.gameChangerCount) {
        card.isGameChanger = true;
        gates.gameChangerCount.value++;
      }
      gates?.bracketGuard?.record(card.name);
      result.push(card);
      usedNames.add(card.name);
      // Also mark front-face name for DFCs so EDHREC-sourced checks match
      if (card.name.includes(' // ')) usedNames.add(frontFaceName(card.name));
      if (!ownedExempt) budgetTracker?.deductCard(card);
    }

    return result;
  } catch (error) {
    logger.error(`Scryfall fallback failed for query "${query}":`, error);
    return [];
  }
}
