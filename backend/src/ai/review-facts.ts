import type { ScryfallCache } from '../cache';
import { logger } from '../logger';
import { loadRelevantCombos } from '../routes/combos';
import { estimateForNames } from './bracket';
import { buildFacts } from './facts-sheet';
import { commandZone, type OracleEntry } from './deck-review';
import { backendOracleTagLookup } from './otag-lookup';
import { getTagLookup } from './tags';

/**
 * The computed facts sheet for a review, or `undefined` when the tag data is
 * absent. Absent data must mean NO sheet: every tag predicate answers false on
 * a miss, so a sheet built over missing data would assert "Sweepers: none" for
 * every deck, which is the invented-gap failure it exists to prevent. The
 * bracket half is best-effort on top and never fails the review.
 */
export async function factsSheetFor(
  request: { cards: { name: string; qty: number }[]; commander: string; partnerCommander?: string },
  oracle: OracleEntry[],
  cache: ScryfallCache
): Promise<ReturnType<typeof buildFacts> | undefined> {
  const tags = getTagLookup();
  if (!tags) return undefined;
  const commanders = commandZone(request);
  const otags = backendOracleTagLookup();
  let bracket = null;
  try {
    bracket = await estimateForNames([...commanders, ...request.cards.map((c) => c.name)], {
      cache,
      tags,
      loadCombos: loadRelevantCombos,
      commanderNames: commanders,
      oracleTags: otags,
    });
  } catch (err) {
    logger.warn('[ai] facts sheet: bracket signals unavailable', err);
  }
  return buildFacts({
    commanders,
    cards: request.cards,
    oracle,
    taggerHas: (name, tag) => tags.hasTag(name, tag),
    otagHas: (name, slug) => otags.hasTag(name, slug),
    bracket,
  });
}
