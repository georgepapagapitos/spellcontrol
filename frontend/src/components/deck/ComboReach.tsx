import './ComboReach.css';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import {
  REACH_GAMES,
  REACH_HORIZON,
  REACH_TURNS,
  reachTurns,
  type ReachPlan,
} from '@/lib/mana-sim/combo-reach';
import type { ClockCard } from '@/lib/mana-sim/opening-hand-sim';
import { useAssemblyClock } from '@/lib/mana-sim/use-assembly-clock';

const pct = (x: number): number => Math.round(x * 100);

/** True once the element has been on screen. Without IntersectionObserver it is true at once. */
function useSeen(ref: React.RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

const REASONS: Record<'templates' | 'sideboard', string> = {
  templates: 'Not timed: it needs a card the combo only describes.',
  sideboard: 'Not timed: one piece is in the sideboard.',
};

/**
 * How often a combo in the deck is assembled by turns 6, 8 and 10, with the
 * games behind it. Runs only once the row has been on screen, after paint, and
 * shares its result with every other ask for the same deck (the clock's cache).
 * The placeholder and the result are one structure, so the row does not move.
 */
export function ComboReach({
  plan,
  library,
  tutors,
  onSeen,
}: {
  plan: ReachPlan;
  /** The deck's library for the clock; null until some row has been seen. */
  library: readonly ClockCard[] | null;
  /** Non-land tutors in the deck: extra outs. */
  tutors: readonly string[];
  /** Called when this row first scrolls into view, so the panel can build `library`. */
  onSeen: () => void;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  useEffect(() => {
    if (seen) onSeen();
  }, [seen, onSeen]);

  const path = useMemo(() => (plan.kind === 'timed' && seen ? [plan.option] : null), [plan, seen]);
  const opts = useMemo(
    () => ({ iterations: REACH_GAMES, horizon: REACH_HORIZON, wildcards: [...tutors] }),
    [tutors]
  );
  const { clock, pending } = useAssemblyClock(library, path, opts);

  if (plan.kind === 'none') return null;
  if (plan.kind === 'untimed') return <p className="combo-reach-note">{REASONS[plan.reason]}</p>;

  const turns = clock ? reachTurns(clock) : null;
  const waiting = !clock && (pending || !library || !seen);
  if (!clock && !waiting)
    return <p className="combo-reach-note">Not timed: a piece is not in the deck.</p>;

  return (
    <div
      ref={ref}
      className={`combo-reach${turns ? '' : ' is-pending'}`}
      aria-busy={!turns}
      role="group"
      aria-label="Chance this combo is assembled and castable"
    >
      <p className="combo-reach-title">Assembled and castable by turn</p>
      <ul className="combo-reach-bars">
        {REACH_TURNS.map((turn, i) => {
          const t = turns?.[i];
          return (
            <li
              key={turn}
              className="combo-reach-bar"
              aria-label={
                t
                  ? `Turn ${turn}: ${pct(t.p)}%, 95% range ${pct(t.lo)} to ${pct(t.hi)}`
                  : `Turn ${turn}: working it out`
              }
            >
              <span className="combo-reach-label" aria-hidden="true">
                <span>T{turn}</span>
                <span className="combo-reach-pct">{t ? `${pct(t.p)}%` : '…'}</span>
              </span>
              <span className="combo-reach-track" aria-hidden="true">
                <span className="combo-reach-fill" style={{ width: `${t ? pct(t.p) : 0}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="combo-reach-scope">
        {clock
          ? `${clock.runs.toLocaleString('en-US')} games${
              tutors.length > 0
                ? `, ${tutors.length} ${tutors.length === 1 ? 'tutor' : 'tutors'} counted as extra outs`
                : ', no tutors in the deck'
            }.`
          : ' '}
      </p>
    </div>
  );
}

/**
 * Redundancy: how often at least one of the deck's timed combos is assembled
 * by each turn, from one run with every combo as an option. Only shown with two
 * or more combos to choose between.
 */
export function ComboReachAny({
  options,
  library,
  tutors,
  onSeen,
}: {
  options: ReadonlyArray<{ names: string[]; need: number }>;
  library: readonly ClockCard[] | null;
  tutors: readonly string[];
  onSeen: () => void;
}): JSX.Element | null {
  const ref = useRef<HTMLParagraphElement>(null);
  const seen = useSeen(ref);
  useEffect(() => {
    if (seen) onSeen();
  }, [seen, onSeen]);
  const path = useMemo(() => (seen && options.length > 1 ? options : null), [seen, options]);
  const opts = useMemo(
    () => ({ iterations: REACH_GAMES, horizon: REACH_HORIZON, wildcards: [...tutors] }),
    [tutors]
  );
  const { clock } = useAssemblyClock(library, path, opts);
  if (options.length < 2) return null;
  const turns = clock ? reachTurns(clock) : null;
  return (
    <p ref={ref} className="combo-reach-any" aria-busy={!turns}>
      {turns
        ? `Any of the ${options.length} combos, by turn ${turns.map((t) => `${t.turn} ${pct(t.p)}%`).join(', ')}.`
        : `Any of the ${options.length} combos, by turn …`}
    </p>
  );
}
