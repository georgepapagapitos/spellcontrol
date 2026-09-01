import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayStore } from '@/store/play';
import { paletteForIndex } from '@/lib/seat-palette';
import { useOnlineSignals } from '../hooks/use-online-signals';
import {
  REACTION_LABEL,
  formatPointCopy,
  formatRollCopy,
  type ReactionEmote,
} from '../lib/table-signals';
import './TableSignals.css';

interface Moment {
  /** The signal's own `seq` — stable identity for this moment, and what a
   *  repeated identical signal (two of the same emote in a row) re-keys on. */
  id: number;
  kind: 'reaction' | 'roll' | 'point';
  emote?: string;
  name?: string;
  seat: number;
  text: string;
}

const REACTION_MS = 2500;
const ROLL_MS = 4000;
/** Matches `POINT_MS` in use-table-pointer so the sentence naming what was
 *  pointed at and the highlight on the card itself clear together — one
 *  outliving the other reads as a second, phantom event. */
const POINT_MS = 5000;
/** Beyond this many at once, the oldest is dropped rather than piling up
 *  into an unreadable stack — these are ambient moments, not a log. */
const MAX_CONCURRENT = 4;

/**
 * Online-only, portaled ambient layer: every `onlineSignal` bump renders as a
 * transient, non-interactive moment (a reaction that rises and fades, or a
 * roll result card) and then removes itself. Mounted from inside ActionBar
 * (see its own doc comment on the container-query/portal seam) so it works
 * without PlaytestBoard passing anything down — this component derives its
 * own online-linked state via `useOnlineSignals`, same as ReactionPicker.
 * Renders nothing in solo playtest.
 */
export function TableSignals() {
  const linked = useOnlineSignals();
  // Only read for naming the card a point landed on. A point carries an
  // opaque card id; the name lives on the target seat's published board, and
  // routinely isn't resolvable there — see `formatPointCopy`.
  const onlineBoards = usePlayStore((s) => s.onlineBoards);
  const [moments, setMoments] = useState<Moment[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    },
    []
  );

  useEffect(() => {
    if (!linked?.onlineSignal) return;
    const { seq, signal } = linked.onlineSignal;
    const players = linked.online.players;
    const name = players.find((p) => p.seat === signal.seat)?.name ?? 'A player';

    // A chat message is NOT a moment here: it lands in the ticker feed as a
    // readable line (store/play.ts `applyServerSignal`), and flashing it as
    // an ambient bubble too would show the same message twice.
    if (signal.kind === 'chat') return;

    let moment: Moment;
    if (signal.kind === 'reaction') {
      moment = {
        id: seq,
        kind: 'reaction',
        emote: signal.emote,
        name,
        seat: signal.seat,
        text: `${name} reacted: ${REACTION_LABEL[signal.emote as ReactionEmote] ?? signal.emote ?? ''}`,
      };
    } else if (signal.kind === 'point') {
      const target = signal.targetSeat != null ? onlineBoards[signal.targetSeat] : undefined;
      const cardName = signal.cardId
        ? target?.battlefield.find((bf) => bf.card.id === signal.cardId && !bf.faceDown)?.card.name
        : undefined;
      moment = {
        id: seq,
        kind: 'point',
        name,
        seat: signal.seat,
        text: formatPointCopy(signal, players, linked.mySeat, cardName),
      };
    } else {
      moment = {
        id: seq,
        kind: 'roll',
        name,
        seat: signal.seat,
        text: formatRollCopy(signal, players),
      };
    }

    // Deferred a microtask: react-hooks/set-state-in-effect forbids setState
    // directly in an effect body. This is an event reaction (a store push),
    // not derived state, so deferring one tick is semantically identical.
    queueMicrotask(() => {
      setMoments((prev) => [...prev, moment].slice(-MAX_CONCURRENT));
      const ms =
        moment.kind === 'reaction' ? REACTION_MS : moment.kind === 'point' ? POINT_MS : ROLL_MS;
      const timer = setTimeout(() => {
        setMoments((prev) => prev.filter((m) => m.id !== moment.id));
        timers.current.delete(moment.id);
      }, ms);
      timers.current.set(moment.id, timer);
    });
    // Keying on the signal identity alone — `linked.online`/`mySeat` and
    // `onlineBoards` only supply lookups for the moment already produced by
    // this specific bump. Re-running when a board republishes would re-fire
    // every moment on the table's most frequent event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked?.onlineSignal]);

  if (!linked) return null;

  return createPortal(
    <div className="playtest-table-signals" aria-hidden={moments.length === 0}>
      {moments.map((m) => (
        <div
          key={m.id}
          role="status"
          className={`playtest-table-signal playtest-table-signal--${m.kind}`}
        >
          {m.kind === 'reaction' ? (
            <>
              <span
                className="playtest-table-signal__dot"
                style={{ background: paletteForIndex(m.seat).base }}
                aria-hidden
              />
              <span className="playtest-table-signal__emote" aria-hidden>
                {m.emote}
              </span>
              <span className="playtest-table-signal__name" aria-hidden>
                {m.name}
              </span>
              <span className="sr-only">{m.text}</span>
            </>
          ) : (
            // Points and rolls are both a single sentence — same treatment.
            <span className="playtest-table-signal__roll-text">{m.text}</span>
          )}
        </div>
      ))}
    </div>,
    document.body
  );
}
