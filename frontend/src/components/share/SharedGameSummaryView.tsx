import { useState } from 'react';
import { Trophy } from 'lucide-react';
import type { PublicGameResultShare } from '../../lib/shared-types';
import { describeGameEvent, formatGameEventSentence } from '../../lib/game-event-text';
import { formatRelativeTime } from '../../lib/format-time';
import { ReportDialog } from './ReportDialog';
import './SharedGameSummaryView.css';

interface Props {
  data: PublicGameResultShare;
  token: string;
}

/**
 * Public read-only recap for a finished online game (/s/:token, kind =
 * 'game-result'). Participants render by their in-game `name` only — this
 * payload never carries userId/username (see backend's projectGameResult,
 * which deliberately omits both, mirroring the game-night RSVP precedent).
 * Notable moments reuse the same describeGameEvent vocabulary the live
 * in-game History timeline renders, so the two surfaces never drift apart.
 *
 * Report placement mirrors the real precedent set by SharedDeckView.tsx /
 * PublicProfilePage.tsx (both already shipped): a `.shared-view-meta-row`
 * `.btn-link` "Report" under the header, not a bespoke bottom-of-page button.
 */
export function SharedGameSummaryView({ data, token }: Props) {
  const [reportOpen, setReportOpen] = useState(false);

  const winner =
    data.winnerSeat != null ? data.participants.find((p) => p.seat === data.winnerSeat) : undefined;

  const seatName = (seat: number | null | undefined): string | undefined => {
    if (seat == null) return undefined;
    return data.participants.find((p) => p.seat === seat)?.name ?? `seat ${seat}`;
  };

  // Seat order is the turn order — defensive sort since the stored
  // participants array isn't contractually guaranteed to already be ordered.
  const participants = [...data.participants].sort((a, b) => a.seat - b.seat);

  return (
    <main className="shared-view game-summary-view">
      <header className="shared-view-header">
        {winner ? (
          <div className="game-summary-winner">
            <Trophy
              className="game-summary-winner-icon"
              width={18}
              height={18}
              strokeWidth={2}
              aria-hidden="true"
            />
            <span className="game-summary-winner-label">Winner</span>
            <h1 className="shared-view-title game-summary-winner-name">{winner.name}</h1>
          </div>
        ) : (
          <h1 className="shared-view-title">{data.format} game — no declared winner</h1>
        )}
        <p className="shared-view-subtitle">
          {data.format} · {formatRelativeTime(data.endedAt, { verbose: true })}
        </p>
        <p className="shared-view-meta-row">
          <button
            type="button"
            className="btn-link game-summary-report-btn"
            aria-label="Report this game"
            onClick={() => setReportOpen(true)}
          >
            Report
          </button>
        </p>
      </header>

      <ol className="game-summary-participants">
        {participants.map((p) => (
          <li key={p.seat} className="game-summary-participant">
            <span className="game-summary-participant-name">{p.name}</span>
            {p.deckName && <span className="game-summary-participant-deck">{p.deckName}</span>}
            {p.commander && (
              <span className="game-summary-participant-commander">{p.commander}</span>
            )}
            <span className="game-summary-participant-life">{p.finalLife} life</span>
            {p.eliminated && <span className="game-summary-participant-badge">Eliminated</span>}
          </li>
        ))}
      </ol>

      {data.notableEvents && data.notableEvents.length > 0 && (
        <section className="game-summary-moments" aria-labelledby="game-summary-moments-heading">
          <h2 id="game-summary-moments-heading" className="shared-deck-section-heading">
            Notable moments
          </h2>
          <ul className="game-summary-moments-list">
            {data.notableEvents.map((ev) => (
              <li key={ev.id}>{formatGameEventSentence(describeGameEvent(ev, seatName))}</li>
            ))}
          </ul>
        </section>
      )}

      {reportOpen && (
        <ReportDialog kind="game-result" targetId={token} onClose={() => setReportOpen(false)} />
      )}
    </main>
  );
}
