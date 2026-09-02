import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlaytestStore } from '../store';
import { usePlayStore } from '@/store/play';
import { haptics } from '@/lib/haptics';
import {
  readTakeback,
  resolveTakebackPlan,
  takebackSummary,
  TAKEBACK_EXPIRY_GRACE_MS,
  type RewindTrailEntry,
  type TakebackMode,
  type TakebackPlan,
} from '../lib/takeback';
import type { RewindVerdict } from '@/lib/playtest/rewind';
import type { GameRequest } from '@/lib/games-api';
import type { OnlineTable } from './use-online-table';

import { userMessage } from '@/lib/user-error';
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
   *  just-resolved one still being shown before clearing). `status` may be
   *  displayed as `'expired'` locally even when the server never sent that
   *  frame — see `TAKEBACK_EXPIRY_GRACE_MS`. */
  pendingRequest: GameRequest | null;
  /** Overrides the per-status copy `TakebackPendingBanner` would otherwise
   *  show for `pendingRequest` — populated only for the one outcome its
   *  status can't express on its own: approved, but the board moved on
   *  before the approval landed, so nothing was actually taken back. */
  pendingOutcomeMessage: string | null;
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
  // True once this seat's own request has gone unanswered past its
  // `expiresAt` + grace with no terminal frame from the server (FIX 2 —
  // native long-poll can drop the frame outright). Reset whenever a new
  // request is raised.
  const [locallyExpired, setLocallyExpired] = useState(false);
  // True once an 'approved' frame arrived but the undo target it was raised
  // against is no longer the trail head (FIX 1). Reset whenever a new
  // request is raised.
  const [staleApproval, setStaleApproval] = useState(false);
  const appliedRef = useRef<string | null>(null);
  // The rewindTrail entry `attempt()` intended to undo, captured at the
  // moment the request was raised — keyed by request id so a late approval
  // can be checked against what was actually asked for, not whatever the
  // trail head happens to be by the time the approval lands.
  const undoTargetRef = useRef<{ id: string; target: RewindTrailEntry | null } | null>(null);

  const liveRequest = mySeat != null ? (onlineRequests[mySeat] ?? null) : null;
  const rawPending = liveRequest && liveRequest.id === myRequestId ? liveRequest : null;

  // Display 'expired' locally once the deadline (plus grace) has passed,
  // even if the server's own expiry frame never arrived. A genuine
  // late-but-real frame supersedes this the moment it lands, since `status`
  // then stops being 'pending' and this override no longer applies.
  const isLocallyExpired = rawPending?.status === 'pending' && locallyExpired;
  const pendingRequest = useMemo<GameRequest | null>(() => {
    if (!rawPending) return null;
    return isLocallyExpired ? { ...rawPending, status: 'expired' } : rawPending;
  }, [rawPending, isLocallyExpired]);

  const pendingOutcomeMessage =
    pendingRequest?.status === 'approved' && staleApproval
      ? 'Approved — but the board changed since you asked, so nothing was taken back.'
      : null;

  const { verdict, stepsAvailable, boundary, next } = readTakeback(rewindTrail);
  const plan = resolveTakebackPlan(verdict, mode, online);

  // Schedule this seat's own pending request to flip to a locally-displayed
  // 'expired' at its deadline (+ grace), independent of any server frame.
  useEffect(() => {
    if (!rawPending || rawPending.status !== 'pending') return;
    const ms = rawPending.expiresAt + TAKEBACK_EXPIRY_GRACE_MS - Date.now();
    const t = setTimeout(() => setLocallyExpired(true), Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [rawPending]);

  // Apply an approval exactly once — but only if the trail head is still the
  // exact entry the request was raised against; otherwise the requester
  // acted again while waiting, and undoing now would take back the wrong
  // (possibly locked) thing instead. Surface (without applying) a decline/
  // expiry/cancellation/stale-approval, then return to idle after a beat.
  useEffect(() => {
    if (!pendingRequest) return;
    if (pendingRequest.status === 'approved') {
      if (appliedRef.current === pendingRequest.id) return;
      appliedRef.current = pendingRequest.id;
      const captured =
        undoTargetRef.current?.id === pendingRequest.id ? undoTargetRef.current.target : null;
      if (captured === rewindTrail[0]) {
        dispatch({ type: 'UNDO' });
        setMyRequestId(null);
      } else {
        // Clearing is owned by the dedicated staleApproval effect below — a
        // timeout scheduled here would be cancelled by this effect's own
        // cleanup on the user's next action (rewindTrail is a dependency),
        // and the appliedRef guard above would then block rescheduling it,
        // sticking the banner forever.
        setStaleApproval(true);
      }
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
  }, [pendingRequest, dispatch, rewindTrail]);

  // Return the stale-approval display to idle after a beat, on a timer that
  // survives the user continuing to play (unlike the effect above, this one
  // has no rewindTrail dependency to re-fire it).
  useEffect(() => {
    if (!staleApproval) return;
    const t = setTimeout(() => {
      setMyRequestId(null);
      setStaleApproval(false);
    }, RESOLUTION_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [staleApproval]);

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
      .then((req) => {
        undoTargetRef.current = { id: req.id, target: next };
        setLocallyExpired(false);
        setStaleApproval(false);
        setMyRequestId(req.id);
      })
      .catch((err: unknown) => {
        setRaiseError(userMessage(err, "Couldn't ask the table."));
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
    pendingOutcomeMessage,
    raiseError,
    clearRaiseError,
    attempt,
    cancelPending,
  };
}
