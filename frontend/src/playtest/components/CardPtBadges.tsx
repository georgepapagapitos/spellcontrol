import { useEffect, useRef, useState } from 'react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { displayPT, printedBase } from '../lib/power-toughness';

interface Props {
  card: PlaytestCard;
  bf?: BattlefieldCard;
  /** Applies a step to the running modifier — the same reducer action the
   *  card menu's Power / toughness page uses. */
  onAdjustPT(power: number, toughness: number): void;
}

type Side = 'power' | 'toughness';

/**
 * The power and toughness of a battlefield permanent, written where a player
 * reads them — on the card — and changed there too: click a number, type the
 * one you want, Enter. What's stored is still a modifier over the printed
 * body (`ADJUST_PT`), so the edit is "this creature is a 5/5 right now", not
 * a rewrite of the card.
 *
 * Rendered as a SIBLING of the card widget, never inside it: the card is a
 * `role="button"` that taps the permanent, and a control nested in another
 * control is both invalid and unreachable (see STYLE_GUIDE, "The ✕ is a
 * SIBLING of the open-button"). `Battlefield` puts both in one card-sized
 * slot so the badges ride the card wherever it sits.
 *
 * A side whose printed value isn't a number (Tarmogoyf's `*`) stays
 * read-only here — there is no total to type — and is still stepped from the
 * card menu, which speaks in modifiers.
 */
export function CardPtBadges({ card, bf, onAdjustPT }: Props) {
  const [editing, setEditing] = useState<Side | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const faceDown = bf?.faceDown ?? false;
  const pt = faceDown ? null : displayPT(card, bf);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // A card turned face down mid-edit drops the edit rather than reopening it
  // when it comes back up. Adjusted during render (React's documented
  // derived-state reset), never in an effect — an effect here would be a
  // second render pass for something the first one already knows.
  const [wasFaceDown, setWasFaceDown] = useState(faceDown);
  if (wasFaceDown !== faceDown) {
    setWasFaceDown(faceDown);
    if (faceDown) setEditing(null);
  }

  if (!pt) return null;

  const base = { power: printedBase(card.power), toughness: printedBase(card.toughness) };

  function begin(side: Side) {
    // Seeded with the number the badge reads as a plain total, so typing over
    // it is the whole interaction — never "+3", which is how the box renders
    // a modifier on a card that prints no body.
    setDraft(String((base[side] ?? 0) + (bf?.pt?.[side] ?? 0)));
    setEditing(side);
  }

  function commit(side: Side) {
    const printed = base[side];
    const next = Number(draft.trim());
    setEditing(null);
    if (printed === null || !Number.isFinite(next) || !/^-?\d+$/.test(draft.trim())) return;
    const current = bf?.pt?.[side] ?? 0;
    const delta = next - printed - current;
    if (delta !== 0) onAdjustPT(side === 'power' ? delta : 0, side === 'power' ? 0 : delta);
  }

  function step(by: number) {
    setDraft((d) => {
      const n = Number(d.trim());
      return /^-?\d+$/.test(d.trim()) && Number.isFinite(n) ? String(n + by) : d;
    });
  }

  function badge(side: Side, shown: string) {
    if (editing === side) {
      return (
        <input
          ref={inputRef}
          className="playtest-card-pt__input"
          type="text"
          inputMode="numeric"
          value={draft}
          aria-label={side === 'power' ? 'Power' : 'Toughness'}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(side)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(side);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(null);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              step(e.key === 'ArrowUp' ? 1 : -1);
            }
          }}
        />
      );
    }
    const label = side === 'power' ? 'Power' : 'Toughness';
    if (base[side] === null) {
      return (
        <span className="playtest-card-pt__value" aria-label={`${label} ${shown}`}>
          {shown}
        </span>
      );
    }
    return (
      <button
        type="button"
        className="playtest-card-pt__value playtest-card-pt__value--editable"
        aria-label={`${label} ${shown}, set it`}
        onClick={() => begin(side)}
      >
        {shown}
      </button>
    );
  }

  return (
    <div className={`playtest-card-pt${pt.modified ? ' is-modified' : ''}`}>
      {badge('power', pt.power)}
      {badge('toughness', pt.toughness)}
    </div>
  );
}
