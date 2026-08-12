import { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayStore } from '@/store/play';
import type { GameRequest } from '@/lib/games-api';
import type { OnlineTable } from '../hooks/use-online-table';

interface Props {
  onlineTable: OnlineTable;
}

/**
 * The consent ask for OTHER seats: "so-and-so wants to take back N actions —
 * here's what". Deliberately not a dialog — no backdrop, no `aria-modal`, no
 * focus trap — the whole point (per the task this shipped for) is that the
 * person being asked may want to keep playing while they decide. Portaled to
 * <body> (see PlaytestBoard's note on floating pieces) and fixed-positioned
 * so it floats over the board without displacing anything.
 *
 * `onlineRequests` is keyed by requester seat and can hold this seat's own
 * outgoing request too (see store/play.ts) — filtered out here since that
 * one is TakebackPendingBanner's job. Only one incoming ask is shown at a
 * time (oldest first); a second raised while this is up simply waits its
 * turn once the first resolves and disappears from `onlineRequests`.
 */
export function TakebackConsentPrompt({ onlineTable }: Props) {
  const onlineRequests = usePlayStore((s) => s.onlineRequests);

  const incoming =
    Object.values(onlineRequests)
      .filter((r) => r.status === 'pending' && r.requesterSeat !== onlineTable.mySeat)
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;

  if (!incoming) return null;
  // Keyed by request id so a fresh ask (a new id, even from the same
  // requester) remounts the card instead of carrying over stale
  // responding/error state from whatever this prompt showed before —
  // the idiomatic way to reset state on a prop change, no effect needed.
  return <TakebackConsentCard key={incoming.id} request={incoming} />;
}

function TakebackConsentCard({ request: incoming }: { request: GameRequest }) {
  const online = usePlayStore((s) => s.online);
  const respondGameRequest = usePlayStore((s) => s.respondGameRequest);
  const [responding, setResponding] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requesterName =
    online?.players.find((p) => p.seat === incoming.requesterSeat)?.name ?? 'A player';
  const steps = incoming.payload.steps;

  async function respond(approve: boolean) {
    setResponding(approve ? 'approve' : 'decline');
    setError(null);
    try {
      await respondGameRequest(incoming.id, approve);
      // No need to clear `responding` on success — `incoming` disappears
      // once the store's onlineRequests update lands (status turns terminal),
      // unmounting this prompt entirely.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't respond — try again.");
      setResponding(null);
    }
  }

  return createPortal(
    <div className="playtest-takeback-consent" role="region" aria-label="Takeback request">
      <p className="playtest-takeback-consent__message" role="status">
        <strong>{requesterName}</strong> wants to take back {steps} action{steps === 1 ? '' : 's'}:{' '}
        {incoming.payload.summary}
      </p>
      {error && (
        <p className="playtest-takeback-consent__error" role="alert">
          {error}
        </p>
      )}
      <div className="playtest-takeback-consent__actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={responding !== null}
          onClick={() => void respond(true)}
        >
          {responding === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={responding !== null}
          onClick={() => void respond(false)}
        >
          {responding === 'decline' ? 'Declining…' : 'Decline'}
        </button>
      </div>
    </div>,
    document.body
  );
}
