import { useCallback, useEffect, useState } from 'react';
import { getPublication, type Publication } from './publications-client';
import { listShares } from './share-client';
import type { ShareRow } from './shared-types';
import { useAuth } from '../store/auth';
import { useDecksStore } from '../store/decks';

const CHANGED_EVENT = 'sc:deck-visibility-changed';

/** Tell every mounted visibility reader for `deckId` to look again, e.g. the
 *  header chip after the post-create nudge made the deck private. */
export function notifyDeckVisibilityChanged(deckId: string): void {
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: deckId }));
}

/** How many times to look again for a new deck's default publish to land. */
const PENDING_TRIES = 4;
const PENDING_RETRY_MS = 1000;

export type DeckVisibility = 'public' | 'friends' | 'link' | 'private';

/**
 * Precedence for the header chip and the decks-index badge — mirrors
 * ShareDialog's own ladder ordering exactly. A live `deck_publications` row
 * wins over any share; 'direct' (send-to-a-friend) shares are deliberately
 * excluded, same as ShareDialog's `LadderValue` — a direct share is
 * recipient-targeted, not a visibility level. Pure + exported so the
 * precedence is unit-testable without mounting the hook.
 */
export function resolveDeckVisibility(
  publication: Publication | null,
  shares: Pick<ShareRow, 'kind' | 'resourceId' | 'audience'>[],
  deckId: string
): DeckVisibility {
  if (publication && !publication.unpublishedAt) return 'public';
  const mine = shares.filter((s) => s.kind === 'deck' && s.resourceId === deckId);
  if (mine.some((s) => s.audience === 'friends')) return 'friends';
  if (mine.some((s) => s.audience === 'link')) return 'link';
  return 'private';
}

interface Result {
  visibility: DeckVisibility;
  loading: boolean;
  /** Re-run the fetch — call after the ShareDialog closes so the chip
   *  reflects whatever changed inside it immediately. */
  refetch: () => void;
}

/**
 * Current sharing state for one deck, for the deck-editor visibility chip.
 * Gates on `status === 'authed'` (not just `!== 'guest'`) so it never fires
 * mid-bootstrap ('unknown'/'loading') and re-runs once bootstrap resolves —
 * guests (and the pre-bootstrap window) simply read as 'private' with no
 * network call.
 */
export function useDeckVisibility(deckId: string): Result {
  const status = useAuth((s) => s.status);
  // Last resolved value, or null before the first fetch. `visibility` itself
  // is derived below rather than reset synchronously inside the effect
  // (react-hooks/set-state-in-effect) — not-authed simply has nothing to
  // fetch, so the effect returns early with no setState at all.
  const [fetched, setFetched] = useState<DeckVisibility | null>(null);
  const [loading, setLoading] = useState(false);
  const [gen, setGen] = useState(0);
  // A deck created as public has no publication row until the server's
  // first sync of it lands, a moment after the editor opens. Read as Public
  // meanwhile and look again, rather than flashing Private.
  const intent = useDecksStore((s) => s.decks.find((d) => d.id === deckId)?.initialVisibility);

  useEffect(() => {
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<string>).detail === deckId) setGen((g) => g + 1);
    };
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, [deckId]);

  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;
    let tries = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    // Nested (not a direct effect-body statement) so the initial setLoading
    // isn't read as a synchronous reset-in-effect — mirrors use-inbox.ts's
    // refetch() shape.
    const load = () => {
      setLoading(true);
      Promise.all([
        getPublication(deckId).catch(() => null),
        listShares().catch((): ShareRow[] => []),
      ])
        .then(([publication, shares]) => {
          if (cancelled) return;
          if (publication === null && intent === 'public' && tries < PENDING_TRIES) {
            tries++;
            setFetched('public');
            retry = setTimeout(load, PENDING_RETRY_MS);
            return;
          }
          setFetched(resolveDeckVisibility(publication, shares, deckId));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();

    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [deckId, status, gen, intent]);

  const refetch = useCallback(() => setGen((g) => g + 1), []);
  const visibility: DeckVisibility = status === 'authed' && fetched ? fetched : 'private';
  return { visibility, loading, refetch };
}
