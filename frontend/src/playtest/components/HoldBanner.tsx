import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { paletteForIndex } from '@/lib/seat-palette';
import { haptics } from '@/lib/haptics';
import { TAKEBACK_EXPIRY_GRACE_MS } from '../lib/takeback';
import type { GameRequest } from '@/lib/games-api';
import './HoldBanner.css';

/** Every seat's currently-live hold, oldest first — the table-wide sibling
 *  of TakebackConsentPrompt's `pickIncomingRequest`: same grace-window
 *  treatment of a dropped terminal (TTL expiry) frame, but multi-seat
 *  rather than "the one other seat asking me". `now` defaults at the call
 *  site (never inside a render body) for the same purity reason. */
function pickActiveHolds(
  onlineRequests: Record<number, GameRequest>,
  now = Date.now()
): GameRequest[] {
  return Object.values(onlineRequests)
    .filter(
      (r) =>
        r.kind === 'hold' && r.status === 'pending' && now - r.expiresAt < TAKEBACK_EXPIRY_GRACE_MS
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Table-wide "someone's holding" display — the ambient half of T101's Hold
 * feature (the requester's own raise/release control is `<HoldButton>`).
 * Advisory only: `role="status"`, no backdrop, no focus trap, portaled to
 * <body> like every other floating playtest piece (see TableSignals' doc
 * comment) — a hold pauses the table SOCIALLY, never functionally, so it
 * must never block a single tap elsewhere on the board. Every seat's active
 * hold gets its own line in that seat's palette color; simultaneous holds
 * from different seats stack rather than collapsing into one message, since
 * who's asking is exactly the information this exists to carry. Mounted
 * from inside ActionBar, same as `<TableSignals>` — self-contained, no
 * plumbing from PlaytestBoard needed.
 */
export function HoldBanner() {
  const online = usePlayStore((s) => s.online);
  const onlineRequests = usePlayStore((s) => s.onlineRequests);
  const cancelGameRequest = usePlayStore((s) => s.cancelGameRequest);
  const userId = useAuth((s) => s.user?.id ?? null);

  const mySeat = useMemo(
    () =>
      online && userId != null
        ? (online.players.find((p) => p.userId === userId)?.seat ?? null)
        : null,
    [online, userId]
  );

  const holds = pickActiveHolds(onlineRequests);
  const deadlineKey = holds.map((h) => `${h.id}:${h.expiresAt}`).join(',');

  // Self-dismiss each hold at its own deadline (+ grace), even with no
  // terminal frame ever arriving — one timeout for the soonest deadline,
  // re-armed whenever the live set changes (see TakebackConsentPrompt's
  // identical reasoning for a single request).
  const [, forceExpiryCheck] = useState(0);
  useEffect(() => {
    if (holds.length === 0) return;
    const nextDeadline = Math.min(...holds.map((h) => h.expiresAt + TAKEBACK_EXPIRY_GRACE_MS));
    const t = setTimeout(
      () => forceExpiryCheck((n) => n + 1),
      Math.max(nextDeadline - Date.now(), 0)
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineKey]);

  // Haptic the moment a genuinely new hold appears — "someone said WAIT" is
  // exactly a haptic moment, for everyone at the table including whoever
  // just raised it. Never fires for holds already live when this component
  // first mounts (a page reload mid-hold shouldn't buzz on arrival).
  const seenRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(holds.map((h) => h.id));
    if (seenRef.current && [...ids].some((id) => !seenRef.current!.has(id))) {
      haptics.warning();
    }
    seenRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineKey]);

  if (holds.length === 0) return null;

  return createPortal(
    <div className="playtest-hold-banner" role="status">
      {holds.map((hold) => {
        const isMine = hold.requesterSeat === mySeat;
        const name = online?.players.find((p) => p.seat === hold.requesterSeat)?.name ?? 'A player';
        const palette = paletteForIndex(hold.requesterSeat);
        return (
          <div key={hold.id} className="playtest-hold-banner__row" style={{ color: palette.base }}>
            <span aria-hidden className="playtest-hold-banner__icon">
              ⏸
            </span>
            <span className="playtest-hold-banner__message">
              {isMine ? (
                <>
                  <strong>You&rsquo;re</strong> holding — the table&rsquo;s waiting
                </>
              ) : (
                <>
                  <strong>{name}</strong> holds — {hold.payload.summary}
                </>
              )}
            </span>
            {isMine && (
              <button
                type="button"
                className="playtest-hold-banner__release"
                onClick={() => void cancelGameRequest(hold.id).catch(() => {})}
              >
                Release
              </button>
            )}
          </div>
        );
      })}
    </div>,
    document.body
  );
}
