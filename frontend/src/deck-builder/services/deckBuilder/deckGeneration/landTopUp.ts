import { logger } from '@/lib/util/logger';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import {
  getCardByName,
  getCachedCard,
  getFrontFaceTypeLine,
} from '@/deck-builder/services/scryfall/client';
import { countColorPips } from '../landGenerator';

// Basics (and Wastes, which this generator treats as a duplicable basic
// stand-in for colorless identities — see the colorless branch below) are
// the one card type Commander's singleton rule doesn't apply to; every other
// land is still one-of. The padding passes below are the last code to touch
// `categories.lands` before the deck ships, so they're the right choke point
// to collapse an exact-name nonbasic duplicate that slipped in upstream
// (observed: Sokenzan, Crucible of Defiance 2x on a land-heavy deck) rather
// than trusting every upstream land-generation path to have deduped already.
function isDuplicableLand(card: ScryfallCard): boolean {
  return card.name === 'Wastes' || getFrontFaceTypeLine(card).toLowerCase().includes('basic');
}

function dedupeNonbasicLands(categories: Record<DeckCategory, ScryfallCard[]>): void {
  const seen = new Set<string>();
  categories.lands = categories.lands.filter((card) => {
    if (isDuplicableLand(card)) return true;
    if (seen.has(card.name)) return false;
    seen.add(card.name);
    return true;
  });
}

// E68 phase 4 (mechanical split, final seam): the land top-up/backfill block
// from generateDeckInner. Extracted verbatim — see deckGenerator.ts's two
// call sites for the ~600-line generic nonland shortage fill that runs
// BETWEEN them (EDHREC fill / Scryfall fallback / owned-collection
// relaxation tiers), which is untouched and out of scope for this split.

/** Everything addBasicLands reads/mutates from generateDeckInner's state. */
export interface LandTopUpContext {
  colorIdentity: string[];
  categories: Record<DeckCategory, ScryfallCard[]>;
  // Prefer an Arena-legal basic printing over the cheapest paper one (E271).
  arenaOnly?: boolean;
}

/**
 * Add `amount` basic lands (Wastes for a colorless identity), split across
 * colors by weighted mana-pip demand of the deck's non-land cards so far.
 * Shared by the land-specific top-up (runLandDeficitTopUp) and the
 * total-count last-resort fallback (runLastResortLandFill) — same fill, two
 * different reasons to reach for it.
 */
export async function addBasicLands(ctx: LandTopUpContext, amount: number): Promise<void> {
  if (amount <= 0) return;
  const { colorIdentity, categories, arenaOnly = false } = ctx;
  const basicTypes: Record<string, string> = {
    W: 'Plains',
    U: 'Island',
    B: 'Swamp',
    R: 'Mountain',
    G: 'Forest',
  };
  const colorsWithBasics = colorIdentity.filter((c) => basicTypes[c]);

  if (colorsWithBasics.length > 0) {
    const allNonLands = [
      ...categories.creatures,
      ...categories.ramp,
      ...categories.cardDraw,
      ...categories.singleRemoval,
      ...categories.boardWipes,
      ...categories.utility,
      ...categories.synergy,
    ];
    const pipCounts = countColorPips(allNonLands);
    const totalPips = colorsWithBasics.reduce((sum, c) => sum + (pipCounts[c] || 0), 0);

    const landsPerColor: Record<string, number> = {};
    if (totalPips > 0) {
      let assigned = 0;
      for (let i = 0; i < colorsWithBasics.length; i++) {
        const color = colorsWithBasics[i];
        if (i === colorsWithBasics.length - 1) {
          landsPerColor[color] = amount - assigned;
        } else {
          landsPerColor[color] = Math.round((amount * (pipCounts[color] || 0)) / totalPips);
          assigned += landsPerColor[color];
        }
      }
    } else {
      const perColor = Math.floor(amount / colorsWithBasics.length);
      const remainder = amount % colorsWithBasics.length;
      for (let i = 0; i < colorsWithBasics.length; i++) {
        landsPerColor[colorsWithBasics[i]] = perColor + (i < remainder ? 1 : 0);
      }
    }

    for (const color of colorsWithBasics) {
      const basicName = basicTypes[color];
      const countForColor = landsPerColor[color];

      let basicCard = getCachedCard(basicName, arenaOnly);
      if (!basicCard) {
        try {
          basicCard = await getCardByName(basicName, arenaOnly);
        } catch {
          continue;
        }
      }

      // Top-up copies share card.id so the deck view aggregates them into
      // one row; allocation still claims any free owned copy by name.
      for (let j = 0; j < countForColor; j++) {
        categories.lands.push({ ...basicCard });
      }
    }
  } else {
    // Colorless deck — use Wastes as the basic land
    let wastesCard = getCachedCard('Wastes', arenaOnly);
    if (!wastesCard) {
      try {
        wastesCard = await getCardByName('Wastes', arenaOnly);
      } catch {
        // Skip if can't fetch
      }
    }
    if (wastesCard) {
      for (let j = 0; j < amount; j++) {
        categories.lands.push({ ...wastesCard });
      }
    }
  }
}

/**
 * Land top-up (Fix 1, iter-6 Slice B): gated on the land-specific deficit
 * (categories.lands.length vs targetLands), not total card count — and run
 * BEFORE the generic nonland shortage fill in deckGenerator.ts. generateLands()
 * can silently under-deliver (a basic-land fetch throws and that color's
 * allocation is dropped — landGenerator.ts's retry+reallocate hardening makes
 * this rare but not impossible); the old last-resort top-up was gated on
 * total count and ran AFTER the nonland fill, so a land shortfall shipped as
 * a full-size deck with a spell squatting in a land slot.
 */
export async function runLandDeficitTopUp(
  ctx: LandTopUpContext,
  targetLands: number
): Promise<void> {
  dedupeNonbasicLands(ctx.categories);
  const landDeficit = targetLands - ctx.categories.lands.length;
  if (landDeficit > 0) {
    logger.debug(`[DeckGen] Land top-up: ${landDeficit} land(s) short of target, adding basics`);
    await addBasicLands(ctx, landDeficit);
  }
}

/**
 * Absolute last resort: if the deck is STILL short of targetDeckSize after
 * every EDHREC/Scryfall/collection-relaxation fill tier in deckGenerator.ts
 * has run, pad the remainder with basic lands. Returns the fill count so the
 * caller can surface it in the build report (`basicLandFillCount`); 0 when
 * no fill was needed.
 */
export async function runLastResortLandFill(
  ctx: LandTopUpContext,
  targetDeckSize: number,
  currentCount: number
): Promise<number> {
  const beforeDedupe = ctx.categories.lands.length;
  dedupeNonbasicLands(ctx.categories);
  // currentCount was counted by the caller before this dedupe — correct it
  // by however many duplicate nonbasics this pass just collapsed, or the
  // shortage math below under-pads by that same amount.
  currentCount -= beforeDedupe - ctx.categories.lands.length;
  if (currentCount >= targetDeckSize) return 0;
  const remainingShortage = targetDeckSize - currentCount;
  logger.debug(`[DeckGen] Still need ${remainingShortage} more cards, adding basic lands`);
  await addBasicLands(ctx, remainingShortage);
  return remainingShortage;
}
