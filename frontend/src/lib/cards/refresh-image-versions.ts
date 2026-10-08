/**
 * Moves the in-memory collection and decks onto the newest image stamps, and
 * asks the server for the stamps of deck cards. See `card-image-versions.ts`
 * for why a stored image URL goes stale.
 */

import { fetchWithAbortTimeout } from '@/lib/api/fetch-utils';
import { logger } from '@/lib/util/logger';
import { isApplyingServer, setApplyingServer } from '@/lib/sync/applying-server';
import { useCollectionStore } from '@/store/collection';
import { useDecksStore } from '@/store/decks';
import {
  deckPrintingIds,
  freshenCollectionImages,
  freshenDeckImages,
  setImageVersions,
} from './card-image-versions';

/**
 * Re-apply the known stamps to the live stores. Marked as applying server
 * state: a fresher URL is reference data, not an edit, so it must not re-save
 * and re-push every deck through the decks subscriber.
 */
export function applyImageVersionsToStores(): void {
  const cards = useCollectionStore.getState().cards;
  const decks = useDecksStore.getState().decks;
  const freshCards = freshenCollectionImages(cards);
  const freshDecks = freshenDeckImages(decks);
  if (freshCards === cards && freshDecks === decks) return;
  const was = isApplyingServer();
  setApplyingServer(true);
  try {
    if (freshCards !== cards) useCollectionStore.setState({ cards: freshCards });
    if (freshDecks !== decks) useDecksStore.setState({ decks: freshDecks });
  } finally {
    setApplyingServer(was);
  }
}

const CHECKED_KEY = 'spellcontrol:deck-image-versions-checked';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 1000;
let inFlight = false;

/**
 * Ask the server for the image stamps of every card in every deck, at most once
 * a day per device. Collection cards get theirs from the price refresh; this is
 * for the frozen deck copies, which include cards the user doesn't own. The
 * check is stamped only after it succeeds with something to ask about, so a
 * fresh device whose decks arrive with the first pull still runs it then.
 */
export async function refreshDeckImageVersions(now = Date.now()): Promise<void> {
  if (inFlight) return;
  try {
    const last = Number(localStorage.getItem(CHECKED_KEY) ?? 0);
    if (now - last < CHECK_EVERY_MS) return;
  } catch {
    /* storage blocked: check every session, still cheap */
  }
  const ids = deckPrintingIds(useDecksStore.getState().decks);
  if (ids.length === 0) return;
  inFlight = true;
  try {
    let moved = false;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await fetchWithAbortTimeout(
        '/api/cards/image-versions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scryfallIds: ids.slice(i, i + CHUNK) }),
        },
        30_000,
        'Image check timed out.'
      );
      if (!res.ok) {
        await res.body?.cancel();
        return;
      }
      const json = (await res.json()) as { imageVersions?: Record<string, string> };
      if (json.imageVersions && setImageVersions(json.imageVersions)) moved = true;
    }
    if (moved) applyImageVersionsToStores();
    try {
      localStorage.setItem(CHECKED_KEY, String(now));
    } catch {
      /* see above */
    }
  } catch (err) {
    // Offline or a server blip: the stored URLs still render; try next session.
    logger.warn('[images] deck image check failed:', err);
  } finally {
    inFlight = false;
  }
}

/** Test-only. */
export function _resetForTests(): void {
  inFlight = false;
}
