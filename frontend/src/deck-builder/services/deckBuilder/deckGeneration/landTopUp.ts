import { logger } from '@/lib/logger';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import { getCardByName, getCachedCard } from '@/deck-builder/services/scryfall/client';
import { countColorPips } from '../landGenerator';

// E68 phase 4 (mechanical split, final seam): the land top-up/backfill block
// from generateDeckInner. Extracted verbatim — see deckGenerator.ts's two
// call sites for the ~600-line generic nonland shortage fill that runs
// BETWEEN them (EDHREC fill / Scryfall fallback / owned-collection
// relaxation tiers), which is untouched and out of scope for this split.

/** Everything addBasicLands reads/mutates from generateDeckInner's state. */
export interface LandTopUpContext {
  colorIdentity: string[];
  categories: Record<DeckCategory, ScryfallCard[]>;
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
  const { colorIdentity, categories } = ctx;
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

      let basicCard = getCachedCard(basicName);
      if (!basicCard) {
        try {
          basicCard = await getCardByName(basicName, true);
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
    let wastesCard = getCachedCard('Wastes');
    if (!wastesCard) {
      try {
        wastesCard = await getCardByName('Wastes', true);
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
  if (currentCount >= targetDeckSize) return 0;
  const remainingShortage = targetDeckSize - currentCount;
  logger.debug(`[DeckGen] Still need ${remainingShortage} more cards, adding basic lands`);
  await addBasicLands(ctx, remainingShortage);
  return remainingShortage;
}
