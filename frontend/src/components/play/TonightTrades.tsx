import { useEffect, useId, useState } from 'react';
import {
  fetchTonightTrades,
  rsvpGameNight,
  TonightTradesNotFoundError,
  type GameNight,
} from '../../lib/game-nights-api';
import { buildTonightTrades } from '../../lib/tonight-trades';
import type { TradeRadarMatch } from '../../lib/trade-radar';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';
import { Modal } from '../Modal';
import { RadarCardTile } from '../../pages/FriendHubPage';
import './TonightTrades.css';

interface TonightTradesData {
  incoming: (TradeRadarMatch & { supplierUsername: string })[];
  outgoing: (TradeRadarMatch & { wanterUsername: string })[];
}

/**
 * "Tonight's trades" sheet (w5-tonight-trades): opt into a specific night's
 * trade board, then see what you can get from — and bring to — everyone
 * else who's opted in. Mirrors AttendeeSheet's Modal wiring exactly.
 */
export function TonightTrades({
  night,
  refresh,
  onClose,
}: {
  night: GameNight;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const myUserId = useAuth((s) => s.user?.id ?? null);
  // Only ever flips true once the server confirms the write — never
  // optimistic — since the data fetch below depends on the server's own
  // reciprocity check already seeing this exact opt-in persisted.
  const [optedIn, setOptedIn] = useState(night.myTradeOptIn);
  const [toggling, setToggling] = useState(false);
  // Keyed result (mirrors FriendHubPage's own radarResult/radarKey pattern):
  // `data: null` means the fetch errored; the whole slot is `null` until the
  // first result lands. Keying by opt-in state means a stale result from
  // before an opt-out never renders once the key no longer matches — no
  // effect ever needs to synchronously reset it (which is what tripped
  // react-hooks/set-state-in-effect on the natural "set loading, then fetch"
  // shape: this codebase's rule wants that skipped, not just the reset).
  const [result, setResult] = useState<{ key: string; data: TonightTradesData | null } | null>(
    null
  );

  async function toggleOptIn(next: boolean) {
    if (toggling) return;
    setToggling(true);
    try {
      const rsvp = await rsvpGameNight(night.token, {
        status: night.myStatus ?? 'going',
        tradeOptIn: next,
      });
      setOptedIn(rsvp.tradeOptIn ?? next);
      void refresh();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't update tonight's trades.",
        tone: 'error',
      });
    } finally {
      setToggling(false);
    }
  }

  const dataKey = `${night.id}:${optedIn}`;

  useEffect(() => {
    if (!optedIn) return;
    let cancelled = false;
    fetchTonightTrades(night.id)
      .then((attendees) => {
        if (cancelled) return;
        setResult({ key: dataKey, data: buildTonightTrades(myUserId ?? '', attendees) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof TonightTradesNotFoundError) {
          // Should be unreachable — the client already knows its own opt-in
          // state — but fall back to the not-opted-in state rather than a
          // dead sheet if it somehow happens.
          setOptedIn(false);
          toast.show({ message: "Couldn't load tonight's trades.", tone: 'error' });
        } else {
          setResult({ key: dataKey, data: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [optedIn, night.id, myUserId, dataKey]);

  // Stale (pre-toggle) results read as "not current" via the key mismatch —
  // undefined = still loading (or not opted in), null = the fetch errored.
  const current = result && result.key === dataKey ? result.data : undefined;

  const titleId = `tonight-trades-title-${night.id}`;

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="game-night-dialog tonight-trades-dialog">
        <h2 id={titleId} className="game-night-dialog-title">
          Tonight's trades — {night.title}
        </h2>

        <label className="field-checkbox tonight-trades-optin">
          <input
            type="checkbox"
            checked={optedIn}
            disabled={toggling}
            onChange={(e) => void toggleOptIn(e.target.checked)}
          />
          Join tonight's trades
        </label>

        {!optedIn && (
          <p className="game-night-dialog-hint">
            Cross-references your want lists and tradeable binders against everyone else who's opted
            in tonight.
          </p>
        )}

        {optedIn && current === undefined && (
          <div className="tonight-trades-loading" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            Loading tonight's trades…
          </div>
        )}

        {optedIn && current === null && (
          <p className="game-night-dialog-hint" role="alert">
            Couldn't load tonight's trades.
          </p>
        )}

        {optedIn && current && (
          <>
            <TonightTradesSection
              title="You can get tonight"
              matches={current.incoming}
              personKey="supplierUsername"
              emptyTagline="Nothing to get tonight."
              emptyHint="Nobody who's opted in has anything on your want lists — add cards to a list to show up here."
            />
            <TonightTradesSection
              title="Bring tonight"
              matches={current.outgoing}
              personKey="wanterUsername"
              emptyTagline="Nothing to bring tonight."
              emptyHint="Nobody who's opted in wants anything from your tradeable binders — mark a binder as tradeable in Collection to show up here."
            />
          </>
        )}

        <div className="game-night-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One section ("You can get tonight" / "Bring tonight"), grouped by the
 * attendee on the other side of the trade — a card two different attendees
 * can each supply/want legitimately appears once per person, since that's
 * two independent trade opportunities.
 */
function TonightTradesSection<K extends 'supplierUsername' | 'wanterUsername'>({
  title,
  matches,
  personKey,
  emptyTagline,
  emptyHint,
}: {
  title: string;
  matches: Array<TradeRadarMatch & Record<K, string>>;
  personKey: K;
  emptyTagline: string;
  emptyHint: string;
}) {
  const headingId = useId();
  const byPerson = new Map<string, Array<TradeRadarMatch & Record<K, string>>>();
  for (const m of matches) {
    const arr = byPerson.get(m[personKey]) ?? [];
    arr.push(m);
    byPerson.set(m[personKey], arr);
  }

  return (
    <section
      className="game-night-attendee-group tonight-trades-section"
      aria-labelledby={headingId}
    >
      <h3 className="game-night-attendee-group-title" id={headingId}>
        {title} {matches.length > 0 && <span className="game-night-count">{matches.length}</span>}
      </h3>
      {byPerson.size === 0 ? (
        <div className="empty-state tonight-trades-section-empty">
          <p className="empty-state-tagline">{emptyTagline}</p>
          <p className="empty-state-hint">{emptyHint}</p>
        </div>
      ) : (
        [...byPerson.entries()].map(([person, personMatches]) => (
          <div key={person} className="tonight-trades-person-group">
            <h4 className="tonight-trades-person-title">{person}</h4>
            <ul className="friend-hub-radar-strip" aria-label={`${title} from ${person}`}>
              {personMatches.map((m) => (
                <RadarCardTile key={m.name} match={m} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
