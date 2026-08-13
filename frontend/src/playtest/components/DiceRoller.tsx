import { useEffect, useRef, useState } from 'react';
import './DiceRoller.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useOnlineSignals } from '../hooks/use-online-signals';

interface Props {
  onClose(): void;
}

interface Roll {
  id: number;
  label: string;
  result: string;
}

/** Solo dice keep their full local set; only these four map onto the
 *  server-broadcast `GameSignal['die']` union (backend/lib/games-api), so
 *  only these route through the table when the online table is linked. */
const BROADCAST_DICE = new Set<'d6' | 'd20'>(['d6', 'd20']);
const DICE = [4, 6, 8, 10, 12, 20];
const MAX_HISTORY = 5;
/** Safety net: clears a stuck "Rolling…" state if the echo never lands
 *  (dropped connection) — sendSignal itself is best-effort/fire-and-forget. */
const PENDING_TIMEOUT_MS = 6000;

export function DiceRoller({ onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const [history, setHistory] = useState<Roll[]>([]);
  const nextId = useRef(0);
  const linked = useOnlineSignals();
  const [pending, setPending] = useState(false);
  const lastSeenSeq = useRef<number | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function roll(label: string, result: string) {
    const entry: Roll = { id: nextId.current++, label, result };
    setHistory((h) => [entry, ...h].slice(0, MAX_HISTORY));
  }

  // Table-linked rolls: send to the server, then wait for this seat's own
  // echoed result (server-rolled, so every seat sees the same value) —
  // never fabricate a local result while linked. Other seats' rolls are the
  // ambient TableSignals layer's job, not this sheet's.
  useEffect(() => {
    if (!linked?.onlineSignal) return;
    const { seq, signal } = linked.onlineSignal;
    if (seq === lastSeenSeq.current) return;
    lastSeenSeq.current = seq;
    if (signal.kind !== 'roll' || signal.seat !== linked.mySeat) return;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    const players = linked.online.players;
    // Deferred a microtask: react-hooks/set-state-in-effect forbids setState
    // directly in an effect body. This is an event reaction (a store push),
    // not derived state, so deferring one tick is semantically identical.
    queueMicrotask(() => {
      setPending(false);
      if (signal.die === 'first') {
        const winner = players.find((p) => p.seat === signal.value)?.name ?? 'A player';
        roll('Who goes first?', winner);
      } else if (signal.die === 'coin') {
        roll('Coin', signal.value === 0 ? 'Heads' : 'Tails');
      } else if (signal.die) {
        roll(signal.die, String(signal.value));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked?.onlineSignal]);

  useEffect(
    () => () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    []
  );

  function sendRoll(die: 'd6' | 'd20' | 'coin' | 'first') {
    if (!linked) return;
    setPending(true);
    void linked.sendSignal({ kind: 'roll', die });
    pendingTimer.current = setTimeout(() => setPending(false), PENDING_TIMEOUT_MS);
  }

  const latest = history[0];

  return (
    <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
      <div className="card-picker-backdrop" />
      <div
        className={`card-picker-sheet playtest-dice-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Roll dice"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Roll</h2>
        </div>
        <div className="playtest-dice-grid">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              linked ? sendRoll('coin') : roll('Coin', Math.random() < 0.5 ? 'Heads' : 'Tails')
            }
          >
            Coin flip
          </button>
          {DICE.map((sides) => {
            const die = `d${sides}`;
            const broadcasts = Boolean(linked) && BROADCAST_DICE.has(die as 'd6' | 'd20');
            return (
              <button
                key={sides}
                type="button"
                disabled={broadcasts ? pending : false}
                onClick={() =>
                  broadcasts
                    ? sendRoll(die as 'd6' | 'd20')
                    : roll(die, String(Math.floor(Math.random() * sides) + 1))
                }
              >
                {die}
              </button>
            );
          })}
          {linked && (
            <button
              type="button"
              className="playtest-dice-first"
              disabled={pending}
              onClick={() => sendRoll('first')}
            >
              Who goes first?
            </button>
          )}
        </div>
        <div className="playtest-dice-result" role="status">
          {pending
            ? 'Rolling…'
            : latest
              ? `${latest.label}: ${latest.result}`
              : 'Tap a die or the coin to roll.'}
        </div>
        {history.length > 1 && (
          <ul className="playtest-dice-history">
            {history.slice(1).map((h) => (
              <li key={h.id}>
                {h.label}: {h.result}
              </li>
            ))}
          </ul>
        )}
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
