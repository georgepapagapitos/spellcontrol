import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaytestStore } from '../store';
import { usePlayStore } from '@/store/play';
import { haptics } from '@/lib/haptics';
import {
  readTakeback,
  resolveTakebackPlan,
  takebackSummary,
  type TakebackMode,
  type TakebackPlan,
} from '../lib/takeback';
import type { RewindVerdict } from '@/lib/playtest/rewind';
import type { GameRequest } from '@/lib/games-api';
import type { OnlineTable } from './use-online-table';

export interface TakebackStatus {
  mode: TakebackMode;
  setMode(mode: TakebackMode): void;
  verdict: RewindVerdict | 'none';
  stepsAvailable: number;
  /** Why the wall is where it is — populated only when `verdict === 'locked'`. */
  boundaryReason: string | null;
  /** What the very next takeback would undo, in plain language. */
  nextSummary: string | null;
  /** What `attempt()` would do right now. */
  plan: TakebackPlan;
  /** This seat's own outgoing request, only while it's live (pending, or a
   *  just-resolved one still being shown before clearing). */
  pendingRequest: GameRequest | null;
  /** Human error surfaced when raising a request fails (409 already-pending,
   *  network, etc.) — the caller decides how to show it (toast, inline). */
  raiseError: string | null;
  clearRaiseError(): void;
  /** Perform the next takeback: apply immediately, or raise a cross-seat
   *  request. Returns what it did (or would have done, if blocked). */
  attempt(): TakebackPlan;
  /** Withdraw this seat's own still-pending request. */
  cancelPending(): void;
}

/** How long a resolved (denied/expired/cancelled) request keeps showing its
 *  outcome before the control returns to idle. */
const RESOLUTION_DISPLAY_MS = 4000;

/**
 * The takeback control's whole state machine. `onlineTable` is the same
 * conditional seam `PlaytestBoard` already computes via `useOnlineTable` —
 * passed in rather than recomputed here so its board-publish side effect
 * only ever runs once per render tree.
 */
export function useTakeback(onlineTable: OnlineTable | null): TakebackStatus {
  const rewindTrail = usePlaytestStore((s) => s.rewindTrail);
  const dispatch = usePlaytestStore((s) => s.dispatch);
  const mode = usePlaytestStore((s) => s.takebackMode);
  const setMode = usePlaytestStore((s) => s.setTakebackMode);
  const onlineRequests = usePlayStore((s) => s.onlineRequests);
  const raiseGameRequest = usePlayStore((s) => s.raiseGameRequest);
  const cancelGameRequest = usePlayStore((s) => s.cancelGameRequest);

  const mySeat = onlineTable?.mySeat ?? null;
  const online = onlineTable !== null;

  // `onlineRequests` is keyed by requester seat, so `onlineRequests[mySeat]`
  // can only ever be a request THIS seat raised. `myRequestId` narrows it
  // further to the one THIS hook instance is currently tracking, so a stale
  // resolved request from earlier in the session (or a prior mount) never
  // gets treated as live.
  const [myRequestId, setMyRequestId] = useState<string | null>(null);
  const [raiseError, setRaiseError] = useState<string | null>(null);
  const appliedRef = useRef<string | null>(null);

  const liveRequest = mySeat != null ? (onlineRequests[mySeat] ?? null) : null;
  const pendingRequest = liveRequest && liveRequest.id === myRequestId ? liveRequest : null;

  const { verdict, stepsAvailable, boundary, next } = readTakeback(rewindTrail);
  const plan = resolveTakebackPlan(verdict, mode, online);

  // Apply an approval exactly once; surface (without applying) a decline/
  // expiry/cancellation, then return to idle after a beat.
  useEffect(() => {
    if (!pendingRequest) return;
    if (pendingRequest.status === 'approved') {
      if (appliedRef.current === pendingRequest.id) return;
      appliedRef.current = pendingRequest.id;
      dispatch({ type: 'UNDO' });
      setMyRequestId(null);
      return;
    }
    if (
      pendingRequest.status === 'denied' ||
      pendingRequest.status === 'expired' ||
      pendingRequest.status === 'cancelled'
    ) {
      const t = setTimeout(() => setMyRequestId(null), RESOLUTION_DISPLAY_MS);
      return () => clearTimeout(t);
    }
  }, [pendingRequest, dispatch]);

  const attempt = useCallback((): TakebackPlan => {
    if (pendingRequest?.status === 'pending') return 'request';
    if (plan === 'blocked') return plan;
    if (plan === 'apply') {
      haptics.tap();
      dispatch({ type: 'UNDO' });
      return plan;
    }
    // 'request'
    setRaiseError(null);
    void raiseGameRequest('rewind', { steps: 1, summary: takebackSummary(next) ?? 'a play' })
      .then((req) => setMyRequestId(req.id))
      .catch((err: unknown) => {
        setRaiseError(err instanceof Error ? err.message : "Couldn't ask the table.");
      });
    return plan;
  }, [pendingRequest, plan, next, dispatch, raiseGameRequest]);

  const cancelPending = useCallback(() => {
    if (!pendingRequest) return;
    void cancelGameRequest(pendingRequest.id).catch(() => {
      /* best effort — a race with expiry/response is already handled above */
    });
    setMyRequestId(null);
  }, [pendingRequest, cancelGameRequest]);

  const clearRaiseError = useCallback(() => setRaiseError(null), []);

  return {
    mode,
    setMode,
    verdict,
    stepsAvailable,
    boundaryReason: verdict === 'locked' ? (boundary?.reason ?? null) : null,
    nextSummary: takebackSummary(next),
    plan,
    pendingRequest,
    raiseError,
    clearRaiseError,
    attempt,
    cancelPending,
  };
}
