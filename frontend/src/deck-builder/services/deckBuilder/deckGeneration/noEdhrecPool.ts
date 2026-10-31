import { logger } from '@/lib/util/logger';
import type { EDHRECCommanderData } from '@/deck-builder/types';
import { setForceLiveSearch } from '@/deck-builder/services/scryfall/client';
import { buildAlternatePool } from '../phaseAlternatePool';
import type { GenerationState } from './state';

/** Why generation has no EDHREC pool: no page could be loaded (outage, block,
 *  a commander EDHREC has no page for), or a page loaded with no decks in it
 *  (offline, or a commander too new to have any). */
export type NoEdhrecReason = 'unreachable' | 'no-decks';

/** True when there is nothing to build from: no page at all, or a page with no
 *  decks and no cards. A thin page (few decks, some cards) is NOT this: the E93
 *  ladder owns it and generation still reads it. */
export function hasNoEdhrecPool(data: EDHRECCommanderData | null): boolean {
  return !data || (data.stats.numDecks === 0 && data.cardlists.allNonLand.length === 0);
}

/**
 * E1057: with no EDHREC data, build the candidate pool the way the
 * Pauper Commander and "by function" modes do: Scryfall's function tags
 * (ramp, removal, draw, board wipes, creatures, protection and the rest),
 * ranked by playability, synthesized into the shape EDHREC pages have. The
 * whole pipeline then runs on it (role targets, curve, grading, bracket)
 * instead of the bare Scryfall fills a null pool left, which shipped no board
 * wipes, no synergy cards and no grade.
 *
 * The pool is tagged `scryfall` so the build report says it was built without
 * EDHREC, and is never put in the regeneration cache (a retry should ask
 * EDHREC again). Offline, or when the search comes back empty, state is left
 * as it was and the old Scryfall-fill path runs.
 */
export async function applyNoEdhrecPool(
  state: GenerationState,
  onProgress?: (message: string, percent: number) => void
): Promise<void> {
  if (!hasNoEdhrecPool(state.edhrecData)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const reason: NoEdhrecReason = state.edhrecData ? 'no-decks' : 'unreachable';
  const { customization, colorIdentity } = state.context;

  setForceLiveSearch(true);
  try {
    const pool = await buildAlternatePool(
      'oracle-role',
      { ...customization, permanentsOnly: false },
      colorIdentity,
      onProgress
    );
    if (pool.poolSize === 0) return;
    state.edhrecData = pool.data;
    state.dataSource = 'scryfall';
    state.noEdhrecReason = reason;
    if (state.cfg.selectedThemesWithSlugs.length > 0) {
      const names = state.cfg.selectedThemesWithSlugs.map((t) => t.name).join(', ');
      state.bracketPoolFallbackNote = `${names} comes from EDHREC's data, so this build doesn't follow it.`;
    }
  } catch (error) {
    logger.warn('[DeckGen] No-EDHREC pool build failed — using Scryfall fills only:', error);
  } finally {
    setForceLiveSearch(false);
  }
}
