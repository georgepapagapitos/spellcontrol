import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import type { Deck } from '@/store/decks';
import { parseDevTable, seedDevTable } from '../lib/dev-table';

/**
 * Seats the board at a fake table when the URL asks for one, in dev builds.
 *
 * See `lib/dev-table.ts` for what this exists for and how to drive it. The
 * hook is the whole integration: one effect, gated on
 * `import.meta.env.DEV`. Vite substitutes that to `false` in a production
 * build, which makes the body dead code, and Rollup then drops both it and
 * the now-unused `lib/dev-table` import. `dev-table.test.ts` asserts the
 * built bundle really is free of it rather than trusting that.
 */
export function useDevTable(deck: Deck | null | undefined): void {
  const { search } = useLocation();
  const userId = useAuth((s) => s.user?.id ?? null);
  const deckId = deck?.id ?? null;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!deckId) return;
    const opts = parseDevTable(search);
    if (!opts) return;
    seedDevTable({
      ...opts,
      userId,
      deckId,
      deckName: deck?.name ?? null,
      commander: deck?.commander?.name ?? null,
    });
    // Deliberately not cleaned up on unmount: leaving the fake table in the
    // store is what lets you navigate around it (to /play, say) and still see
    // the seat, exactly as a real one would behave. A reload without the
    // query drops it, since nothing persists it.
  }, [search, userId, deckId, deck?.name, deck?.commander?.name]);
}
