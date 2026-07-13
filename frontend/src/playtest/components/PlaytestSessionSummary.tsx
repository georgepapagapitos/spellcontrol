import {
  formatSessionSummaryLine,
  formatVsAverageLine,
  sessionHeadline,
  type PlaytestSessionRecord,
  type SessionAggregates,
} from '@/lib/playtest/session-record';

interface Props {
  record: PlaytestSessionRecord;
  aggregates: SessionAggregates | null;
  onDismiss(): void;
}

/**
 * End-of-session recap (E141) — "Turn 8 kill · 1 mulligan · survived 2
 * removals + 1 wipe · 0 missed land drops", shown on RESET or a table defeat
 * for a meaningfully-played game. Complements (doesn't replace) the
 * celebratory seal moment on table defeat — this is the informational recap.
 *
 * Not auto-dismissed like `ResistanceBanner`: unlike a transient opponent
 * announcement, this is a small achievement/recap the player should get to
 * actually read, so it stays until manually dismissed.
 */
export function PlaytestSessionSummary({ record, aggregates, onDismiss }: Props) {
  const vsAverage = aggregates ? formatVsAverageLine(aggregates) : null;

  return (
    <div className="playtest-session-summary" role="status">
      <div className="playtest-session-summary__header">
        <span className="playtest-session-summary__title">{sessionHeadline(record)}</span>
        <button
          type="button"
          className="playtest-session-summary__dismiss"
          aria-label="Dismiss session summary"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      <p className="playtest-session-summary__line">{formatSessionSummaryLine(record)}</p>
      {vsAverage && <p className="playtest-session-summary__avg">{vsAverage}</p>}
    </div>
  );
}
