import type { EnrichedCard, MaterializedBinder } from '../types';
import { scryfallArtCrop } from './offline/slim-to-scryfall';

/**
 * Cover art URL for a binder tile — the binder's face at index level (E132).
 *
 * An explicit `def.coverScryfallId` (the card preview's "Set cover" action)
 * wins while a matching copy with art is still in the binder; when that card
 * leaves — or has no image — the cover falls back to the automatic pick: the
 * most valuable card, ties broken toward the more iconic one (lower EDHREC
 * rank). Art derives from the stored `imageNormal` via `scryfallArtCrop`, so
 * offline-resolved copies never leak a full card frame into the banner (the
 * slim offline bundle carries no real art_crop — see #843).
 */
export function binderCoverArt(binder: MaterializedBinder): string | undefined {
  const cards = binder.sections.flatMap((s) => s.cards);
  const override = binder.def.coverScryfallId;
  if (override) {
    const chosen = cards.find((c) => c.scryfallId === override);
    if (chosen?.imageNormal) return scryfallArtCrop(chosen.imageNormal);
  }
  let best: EnrichedCard | undefined;
  for (const c of cards) {
    if (!c.imageNormal) continue;
    if (
      !best ||
      c.purchasePrice > best.purchasePrice ||
      (c.purchasePrice === best.purchasePrice &&
        (c.edhrecRank ?? Infinity) < (best.edhrecRank ?? Infinity))
    ) {
      best = c;
    }
  }
  return best?.imageNormal ? scryfallArtCrop(best.imageNormal) : undefined;
}
