import { clear, createStore, get, set, type UseStore } from 'idb-keyval';
import type { Deck } from '../store/decks';
import { logger } from './logger';

/**
 * Device-local copy of each deck's last commander analysis (bracket, grade,
 * coach lanes, …), keyed by deck id.
 *
 * Analysis writes never reach IndexedDB through sync (`isApplyingAnalysis`
 * skips the persist on purpose, so opening a deck doesn't push it), so every
 * page load started from nothing and the Power tab read "Estimating bracket…"
 * for the whole combo match + analysis (~3 s on a warm device). This store
 * lets a revisit show the last result at once while the hook recomputes.
 *
 * It is a separate database, not the deck's entity row: writing the analysis
 * into the synced row would mark it unchanged for `persistKind`, which is what
 * currently carries a fresh analysis to the server on the next deck edit.
 *
 * Cleared with the rest of the account's local data (`stopSyncAndWipeLocal`).
 * ponytail: a deleted deck's entry lingers until that wipe; prune by live
 * deck ids if the store ever grows enough to matter.
 */
export type CachedAnalysis = Partial<Deck> & { gradeBracketSignature: string };

let store: UseStore | null = null;
function getStore(): UseStore | null {
  if (typeof indexedDB === 'undefined') return null;
  store ??= createStore('spellcontrol-deck-analysis', 'keyval');
  return store;
}

export async function readCachedAnalysis(deckId: string): Promise<CachedAnalysis | null> {
  const s = getStore();
  if (!s) return null;
  try {
    return (await get<CachedAnalysis>(deckId, s)) ?? null;
  } catch (err) {
    logger.warn('[analysis-cache] read failed (non-fatal):', err);
    return null;
  }
}

export function writeCachedAnalysis(deckId: string, analysis: CachedAnalysis): void {
  const s = getStore();
  if (!s) return;
  set(deckId, analysis, s).catch((err: unknown) =>
    logger.warn('[analysis-cache] write failed (non-fatal):', err)
  );
}

/** Drop every cached analysis. Part of the account-level local wipe. */
export async function clearAnalysisCache(): Promise<void> {
  const s = getStore();
  if (!s) return;
  try {
    await clear(s);
  } catch (err) {
    logger.warn('[analysis-cache] clear failed (non-fatal):', err);
  }
}
