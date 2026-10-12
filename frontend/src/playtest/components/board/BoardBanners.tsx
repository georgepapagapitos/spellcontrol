import { useState } from 'react';
import { usePlaytestStore } from '../../store';
import type { ResistanceLevel } from '../../lib/resistance';
import { RESISTANCE_LEVEL_ANNOUNCE } from '../../lib/resistance';
import { PlaytestSessionSummary } from '../PlaytestSessionSummary';
import { ResistanceBanner } from '../ResistanceBanner';

/**
 * The one banner slot above the felt: a Reset's session recap, an opponent's
 * resistance announcement, or the one-time explanation of the level just
 * picked — in that order of precedence.
 */
export function BoardBanners({ resistanceLevel }: { resistanceLevel: ResistanceLevel }) {
  const lastResistanceEvent = usePlaytestStore((s) => s.lastResistanceEvent);
  const lastSessionRecord = usePlaytestStore((s) => s.lastSessionRecord);
  // Banner dismissal is tracked by event id so a new opponent response (even
  // with an identical message) re-shows and re-announces the banner.
  const [dismissedResistanceId, setDismissedResistanceId] = useState<number | null>(null);
  // Session-summary dismissal (E141) tracked by record id, same pattern as
  // the resistance banner above — a new record (even an identical-looking
  // one from a later game) re-shows.
  const [dismissedSessionRecordId, setDismissedSessionRecordId] = useState<string | null>(null);

  // Resistance's only explanation used to be a hover `title` on the toggle —
  // invisible on touch. Reuse the existing opponent-announcement banner to
  // show a one-time explanation naming the picked level; a real opponent
  // event (which shares the same single-slot banner below) takes over from
  // it. Derived during render (not an effect) per React's "adjusting state
  // when a prop changes" pattern.
  const [resistanceIntro, setResistanceIntro] = useState(false);
  const [prevResistanceLevel, setPrevResistanceLevel] = useState(resistanceLevel);
  if (resistanceLevel !== prevResistanceLevel) {
    setPrevResistanceLevel(resistanceLevel);
    setResistanceIntro(resistanceLevel !== 'off');
  }
  const lastEventId = lastResistanceEvent?.id;
  const [prevEventId, setPrevEventId] = useState(lastEventId);
  if (lastEventId !== prevEventId) {
    setPrevEventId(lastEventId);
    if (lastEventId !== undefined) setResistanceIntro(false);
  }

  return (
    <>
      {lastSessionRecord && lastSessionRecord.id !== dismissedSessionRecordId ? (
        // A Reset-triggered session end gets the E141 recap.
        <PlaytestSessionSummary
          key={lastSessionRecord.id}
          record={lastSessionRecord}
          onDismiss={() => setDismissedSessionRecordId(lastSessionRecord.id)}
        />
      ) : lastResistanceEvent && lastResistanceEvent.id !== dismissedResistanceId ? (
        <ResistanceBanner
          key={lastResistanceEvent.id}
          message={lastResistanceEvent.message}
          onDismiss={() => setDismissedResistanceId(lastResistanceEvent.id)}
        />
      ) : (
        resistanceIntro &&
        resistanceLevel !== 'off' && (
          <ResistanceBanner
            key="resistance-intro"
            message={RESISTANCE_LEVEL_ANNOUNCE[resistanceLevel]}
            onDismiss={() => setResistanceIntro(false)}
          />
        )
      )}
    </>
  );
}
