import {
  formatSessionSummaryLine,
  sessionHeadline,
  type PlaytestSessionRecord,
} from '@/lib/playtest/session-record';
import { hordeLevelLabel } from '@/playtest/lib/horde-view';

/** "Beat the Zombies horde (Standard)" / "Overrun by the Zombies horde
 *  (Standard)" / "Fought the Zombies horde (Standard)" — the one line a
 *  session tagged with a horde (E387 PR 5) adds under the usual recap. */
function hordeSummaryLine(record: PlaytestSessionRecord): string | null {
  const horde = record.horde;
  if (!horde) return null;
  const verb =
    horde.outcome === 'won' ? 'Beat' : horde.outcome === 'lost' ? 'Overrun by' : 'Fought';
  return `${verb} the ${horde.hordeName} horde (${hordeLevelLabel(horde.level)})`;
}

interface Props {
  record: PlaytestSessionRecord;
  onDismiss(): void;
}

/**
 * End-of-session recap (E141) — "Turn 9: game ended · 1 mulligan · survived 2
 * removals + 1 wipe · 0 missed land drops", shown on RESET for a
 * meaningfully-played game.
 *
 * Not auto-dismissed like `ResistanceBanner`: unlike a transient announcement,
 * this is a small recap the player should get to actually read, so it stays
 * until manually dismissed.
 */
export function PlaytestSessionSummary({ record, onDismiss }: Props) {
  const hordeLine = hordeSummaryLine(record);
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
      {hordeLine && <p className="playtest-session-summary__line">{hordeLine}</p>}
    </div>
  );
}
