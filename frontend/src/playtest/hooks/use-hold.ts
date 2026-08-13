import { useCallback, useEffect, useState } from 'react';
import { usePlayStore } from '@/store/play';
import { toast } from '@/store/toasts';
import { TAKEBACK_EXPIRY_GRACE_MS } from '../lib/takeback';
import type { GameRequest } from '@/lib/games-api';
import { useOnlineSignals } from './use-online-signals';

export interface HoldStatus {
  /** This seat's own pending hold, id-tracked by this hook instance the same
   *  way use-takeback.ts tracks its own request — null once released or
   *  expired, even before any terminal server frame confirms it. */
  pending: GameRequest | null;
  /** Raise a hold, or release this seat's own pending one — one control,
   *  two actions, never both available at once. */
  toggle(): void;
}

/**
 * The Hold button's own state machine (requester side only — the table-wide
 * view of every seat's hold is `<HoldBanner>`, read straight off the
 * store). Deliberately online-only: `useOnlineSignals` returns null in solo
 * playtest, and so does this hook — there's no table to pause for.
 *
 * Mirrors use-takeback.ts's request lifecycle (id-tracked pending, a
 * grace-windowed local revert against a dropped terminal frame) but with no
 * approval branch at all, since a hold has none — see games-api.ts's doc
 * comment. It only ever resolves via this seat's own cancel or the
 * server's 90s TTL, both of which surface here as the tracked request's
 * `status` turning non-`'pending'`.
 */
export function useHold(): HoldStatus | null {
  const linked = useOnlineSignals();
  const onlineRequests = usePlayStore((s) => s.onlineRequests);
  const raiseGameRequest = usePlayStore((s) => s.raiseGameRequest);
  const cancelGameRequest = usePlayStore((s) => s.cancelGameRequest);

  const mySeat = linked?.mySeat ?? null;
  const [myRequestId, setMyRequestId] = useState<string | null>(null);

  const liveRequest = mySeat != null ? (onlineRequests[mySeat] ?? null) : null;
  const rawPending =
    liveRequest && liveRequest.id === myRequestId && liveRequest.kind === 'hold'
      ? liveRequest
      : null;

  // Revert the moment the tracked hold stops being pending — covers both
  // this hook's own optimistic release (in `toggle` below) and a TTL expiry
  // frame arriving from the server with no local action at all. Deferred a
  // microtask: react-hooks/set-state-in-effect forbids setState directly in
  // an effect body, and this is an event reaction (a store push), not
  // derived state, so one tick later is semantically identical.
  useEffect(() => {
    if (rawPending && rawPending.status !== 'pending') {
      queueMicrotask(() => setMyRequestId(null));
    }
  }, [rawPending]);

  // Self-revert at the deadline (+ grace) even with no terminal frame ever
  // arriving — native long-poll can drop it outright (see
  // TAKEBACK_EXPIRY_GRACE_MS's doc comment).
  useEffect(() => {
    if (!rawPending || rawPending.status !== 'pending') return;
    const ms = rawPending.expiresAt + TAKEBACK_EXPIRY_GRACE_MS - Date.now();
    const t = setTimeout(() => setMyRequestId(null), Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [rawPending]);

  const pending = rawPending?.status === 'pending' ? rawPending : null;

  const toggle = useCallback(() => {
    if (pending) {
      void cancelGameRequest(pending.id).catch(() => {
        /* best effort — a race with expiry is already handled above */
      });
      setMyRequestId(null);
      return;
    }
    void raiseGameRequest('hold', { summary: '' })
      .then((req) => setMyRequestId(req.id))
      .catch((err: unknown) => {
        // The one outcome the store can't resolve into UI state on its own
        // (network, a race with the server's 409 — "a request is already
        // pending for this seat", which covers a pending takeback ask too).
        toast.show({
          message: err instanceof Error ? err.message : "Couldn't ask the table.",
          tone: 'warn',
        });
      });
  }, [pending, raiseGameRequest, cancelGameRequest]);

  if (!linked) return null;
  return { pending, toggle };
}
