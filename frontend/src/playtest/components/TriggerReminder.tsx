import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { GamePhase } from '@/lib/game-state';
import { useEscapeKey } from '@/lib/use-escape-key';
import { BEAT_LABEL, firesAt, type TriggerHit } from '../lib/triggers';
import './TriggerReminder.css';
import { IconButton } from '@/components/shared/Button';

/** The five beats in turn order, for the no-clock list. */
const TURN_ORDER: readonly GamePhase[] = ['beginning', 'main1', 'combat', 'main2', 'end'];

export interface TriggerCard {
  id: string;
  name: string;
  hits: readonly TriggerHit[];
}

interface Props {
  /** Permanents on your battlefield that carry a boundary trigger. */
  cards: readonly TriggerCard[];
  /**
   * The table's current phase, or null when no clock is running. Null is the
   * common case, not a fallback: solo goldfishing has no phase clock at all,
   * and an online table only gets one once somebody taps the phase chip.
   */
  beat: GamePhase | null;
  /** Rises by one each turn. The edge that opens the list when there is no clock. */
  turn: number;
  myTurn: boolean;
  onLocate(cardId: string): void;
}

/**
 * What wants you at this boundary: a short list of your own permanents whose
 * oracle text triggers here, shown when the turn or phase changes.
 *
 * Advisory and inert. It resolves nothing, blocks nothing, and is gone at the
 * next boundary whether or not it was read. There is no toggle and no timer:
 * it only appears when something is genuinely due, a dismiss is one key away,
 * and a trigger you would forget is not one a two-second overlay saves.
 *
 * Portals to `<body>` for the reason `TableMoments` documents — the board
 * renders inside a `container-type: inline-size` box, which would otherwise
 * clip a fixed overlay to the battlefield instead of the viewport.
 */
export function TriggerReminder({ cards, beat, turn, myTurn, onLocate }: Props) {
  // What is due right now, grouped by beat. With a clock that is one group;
  // without one it is the whole turn, in turn order, since goldfishing walks
  // the turn by hand and there is no phase edge to hang each group on.
  const groups = useMemo(() => {
    const beats = beat ? [beat] : TURN_ORDER;
    return beats
      .map((b) => ({
        beat: b,
        cards: cards.filter((c) => firesAt(c.hits, b, myTurn)),
      }))
      .filter((g) => g.cards.length > 0);
  }, [cards, beat, myTurn]);

  // One string per boundary. Composed rather than watched field by field
  // because online state arrives by polling: `beat` and `myTurn` are re-read
  // every tick, and only a change in the composed value is a real edge.
  const key = `${turn}:${myTurn}:${beat ?? 'no-clock'}`;
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Seeded from the current values so mount never fires — not the first
  // render, not a resumed snapshot sitting at turn 7, not a poll landing back
  // on the phase we were already in.
  const prevKey = useRef(key);
  const prevTurn = useRef(turn);

  useEffect(() => {
    const wasKey = prevKey.current;
    const wasTurn = prevTurn.current;
    prevKey.current = key;
    prevTurn.current = turn;
    if (key === wasKey) return;
    // A take-back walks the turn backwards. Re-announcing an upkeep the
    // player already resolved is worse than staying quiet.
    if (turn < wasTurn) return;
    setOpenKey(key);
  }, [key, turn]);

  useEscapeKey(() => setOpenKey(null), openKey !== null);

  if (openKey !== key || groups.length === 0) return null;

  return createPortal(
    <div className="trigger-reminder" role="status">
      <div className="trigger-reminder__head">
        <span className="trigger-reminder__title">Triggers</span>
        <IconButton
          className="trigger-reminder__close"
          onClick={() => setOpenKey(null)}
          label="Dismiss triggers"
          icon={<X size={14} />}
        />
      </div>
      {groups.map((g) => (
        <div key={g.beat} className="trigger-reminder__group">
          <span className="trigger-reminder__beat">{BEAT_LABEL[g.beat]}</span>
          <ul className="trigger-reminder__list">
            {g.cards.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="trigger-reminder__card"
                  onClick={() => onLocate(c.id)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>,
    document.body
  );
}
