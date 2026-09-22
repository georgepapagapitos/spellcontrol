import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import type { PlaytestCard } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import { isKeepableHand } from '@/lib/opening-hand-sim';
import { isLand, toSimCard } from '@/lib/hand-classify';
import { CardPreview } from '@/components/CardPreview';
import { useLongPress } from '@/lib/use-long-press';
import type { PlaytestPhase } from '../store';
import './OpeningHandSheet.css';

/** Online: who at the table still hasn't kept, and whether everyone has. */
export interface OpeningHandOnline {
  /** Display names of the seats still choosing (own seat excluded). */
  waitingOn: string[];
  allKept: boolean;
}

interface Props {
  /** `playing` only ever arrives online, and only after this device kept:
   *  the takeover stays up as a "waiting for the table" curtain until every
   *  seat has kept and the countdown runs out. Solo, the board unmounts this
   *  the moment the phase flips. */
  phase: PlaytestPhase;
  hand: PlaytestCard[];
  mulliganCount: number;
  /**
   * Lookup from each PlaytestCard's instance id to the underlying ScryfallCard,
   * so we can hand the full card data to `CardPreview` (manaCost, oracleText,
   * flip faces, etc.) without coupling the reducer types to ScryfallCard.
   */
  cardLookup?: Map<string, ScryfallCard>;
  deckName?: string;
  /** Free-mulligan variant (E226): every mulligan redraws a full seven and
   *  the bottom-N step never happens. Solo only — seated at a table, the
   *  pod's own mulligan rule decides and the toggle is not offered. */
  freeMulligan: boolean;
  onFreeMulliganChange(on: boolean): void;
  /** How many cards this hand owes the bottom, per the variant in force
   *  (`cardsToBottom`). Passed in rather than derived from `mulliganCount`
   *  here, because which variant governs depends on whether this board is
   *  seated at a table — a question the sheet has no business answering. */
  cardsOwedToBottom: number;
  /** Seated only: the table's mulligan rule in words, shown in place of the
   *  device's free-mulligan switch. Absent solo. */
  tableMulligan?: string;
  /** On-the-draw choice (Wave 3): draw one extra card the moment play
   *  actually begins. `createPlaytestState` already deals the on-the-play
   *  default (no draw before turn 1) — this is the opt-in for the other seat. */
  onDraw: boolean;
  onOnDrawChange(on: boolean): void;
  /** Present only when this playtest is seated at an online table. */
  online?: OpeningHandOnline;
  /** Leave playtest and return to the deck. The sheet is otherwise
   *  non-dismissable (Keep / Mulligan), so this is the only way out. */
  /** Where `onExit` goes (deck name, or the online table). */
  exitLabel?: string;
  onExit?(): void;
  onKeep(): void;
  onMulligan(): void;
  onConfirmBottom(cardIds: string[]): void;
}

const MAX_MULLIGANS = 6;

/* The hand is a fan over the felt at EVERY width (2026-09-22). A phone used
   to get a bottom sheet with a grid of seven card images and a scroll, which
   is a form to fill in rather than a hand to read; the fan is the same shape
   a real opening hand has, and it leaves the board visible behind it. */

/** Seconds the table counts down once every seat has kept, then a beat on
 *  "Game has started" before the curtain lifts. */
const COUNTDOWN_FROM = 3;
const STARTED_HOLD_MS = 800;

/** How far each card sits below the middle of the fan, in px — squared falloff
 *  so the arc reads as a curve, not a V. Computed here rather than in CSS
 *  because `abs()` isn't safe to rely on in stylesheets yet. */
function arcLift(index: number, count: number): number {
  return Math.round(Math.abs(index - (count - 1) / 2) ** 2 * 4);
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy" — a list a person reads, not a join. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function OpeningHandSheet({
  phase,
  hand,
  mulliganCount,
  cardsOwedToBottom,
  tableMulligan,
  cardLookup,
  deckName,
  freeMulligan,
  onFreeMulliganChange,
  onDraw,
  onOnDrawChange,
  online,
  exitLabel,
  onExit,
  onKeep,
  onMulligan,
  onConfirmBottom,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [peeking, setPeeking] = useState(false);

  const isMulliganBottom = phase === 'mulligan-bottom';
  const requiredBottom = isMulliganBottom ? cardsOwedToBottom : 0;
  const canConfirm = isMulliganBottom && selected.length === requiredBottom;

  // Online only (see the `phase` prop doc): this device has kept and the
  // curtain is waiting on the rest of the table.
  const onlineWaiting = phase === 'playing' ? online : undefined;
  const waiting = onlineWaiting != null;
  const [countdown, setCountdown] = useState<number | null>(null);
  const [curtainDone, setCurtainDone] = useState(false);
  // Render-phase reset (same pattern as `order` below) so a fresh game — the
  // phase leaving `playing` — puts the curtain back to its start.
  const [trackedWaiting, setTrackedWaiting] = useState(waiting);
  if (trackedWaiting !== waiting) {
    setTrackedWaiting(waiting);
    if (!waiting) {
      setCountdown(null);
      setCurtainDone(false);
    }
  }

  // The countdown seeds in the render the table goes all-kept, not from an
  // effect (`react-hooks/set-state-in-effect`) — same render-phase sync the
  // rest of this file uses. Only the tick itself is a timer.
  const allKept = onlineWaiting?.allKept === true;
  const [trackedAllKept, setTrackedAllKept] = useState(allKept);
  if (trackedAllKept !== allKept) {
    setTrackedAllKept(allKept);
    setCountdown(allKept ? COUNTDOWN_FROM : null);
  }

  useEffect(() => {
    if (countdown == null || countdown <= 0) return;
    const tick = setTimeout(() => setCountdown((c) => (c != null && c > 0 ? c - 1 : c)), 1000);
    return () => clearTimeout(tick);
  }, [countdown]);

  useEffect(() => {
    if (countdown !== 0) return;
    const lift = setTimeout(() => setCurtainDone(true), STARTED_HOLD_MS);
    return () => clearTimeout(lift);
  }, [countdown]);

  // Esc ends a peek. It does nothing else on purpose: the opening hand is
  // non-dismissable, you leave it by keeping, mulliganing or exiting.
  useEffect(() => {
    if (!peeking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPeeking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peeking]);

  const hidden = curtainDone || (phase === 'playing' && !waiting);
  useLockBodyScroll(!hidden);

  // The fan shows the hand as the reducer dealt it. Arranging belongs to
  // the hand you play with, not to the one moment you are deciding
  // keep-or-mulligan — and in the bottom-N step these same cards are
  // tap-to-select, so a drag on that target only competed with the tap (E348,
  // user 2026-09-20). Reorder lives in `Hand` / `HandDrawer` now.
  const orderedHand = hand;

  // EnrichedCard projection for CardPreview, parallel to the *displayed*
  // order so prev/next swipes through the carousel match what the user sees.
  // Missing lookups (defensive — shouldn't happen for hand cards from the
  // user's own deck) are filtered out so we never feed CardPreview an
  // undefined.
  const previewable = useMemo(() => {
    const out: { cardId: string; enriched: ReturnType<typeof scryfallToEnrichedCard> }[] = [];
    orderedHand.forEach((c) => {
      const scry = cardLookup?.get(c.id);
      if (!scry) return;
      out.push({ cardId: c.id, enriched: scryfallToEnrichedCard(scry) });
    });
    return out;
  }, [orderedHand, cardLookup]);

  const previewCards = useMemo(() => previewable.map((p) => p.enriched), [previewable]);
  const previewLabels = useMemo(
    () => previewable.map(() => (isMulliganBottom ? 'Bottom of library' : 'Opening hand')),
    [previewable, isMulliganBottom]
  );
  const previewPages = useMemo(() => previewable.map(() => 1), [previewable]);

  // Single-hand readout for the opening (pre-mulligan) seven: land count + a
  // keep verdict via the same `isKeepableHand` heuristic the deck-view test
  // hand uses, so the two never disagree. Skipped in mulligan-bottom (you're
  // choosing cards to bottom, not judging a fresh seven) and when any card is
  // missing its ScryfallCard lookup (can't classify it reliably).
  const handStats = useMemo(() => {
    if (isMulliganBottom || !cardLookup || hand.length < 7) return null;
    const scry = hand.map((c) => cardLookup.get(c.id)).filter((c): c is ScryfallCard => Boolean(c));
    if (scry.length < hand.length) return null;
    return { lands: scry.filter(isLand).length, keepable: isKeepableHand(scry.map(toSimCard)) };
  }, [hand, cardLookup, isMulliganBottom]);

  // Running "avg lands/hand" across this sheet's redeals (Wave 3) — a real
  // denominator for the mulligan decision instead of judging each seven in
  // isolation. This component stays mounted across Keep→mulligan-bottom→
  // (mulligan again) cycles for one game — only the card set changes — so a
  // plain ref/state list here naturally resets per fresh game (the sheet
  // unmounts once play starts, and remounts on the next RESET/init). Render-
  // phase state sync, not a useEffect: each *distinct* opening hand seen gets
  // counted exactly once, never re-counted on an unrelated re-render of the
  // same hand. The signature (sorted ids joined) collapses identity
  // comparison to a string diff.
  const handSignature = hand
    .map((c) => c.id)
    .sort()
    .join('|');
  const [landHistory, setLandHistory] = useState<number[]>([]);
  const [trackedLandSignature, setTrackedLandSignature] = useState<string | null>(null);
  if (handStats && trackedLandSignature !== handSignature) {
    setTrackedLandSignature(handSignature);
    setLandHistory((prev) => [...prev, handStats.lands]);
  }
  const avgLands =
    landHistory.length > 1 ? landHistory.reduce((sum, n) => sum + n, 0) / landHistory.length : null;

  function toggleSelect(cardId: string) {
    if (!isMulliganBottom) return;
    setSelected((cur) => {
      if (cur.includes(cardId)) return cur.filter((id) => id !== cardId);
      if (cur.length >= requiredBottom) return cur;
      return [...cur, cardId];
    });
  }

  function bottomIndex(cardId: string): number | null {
    if (!isMulliganBottom) return null;
    const i = selected.indexOf(cardId);
    return i === -1 ? null : i + 1;
  }

  const openPreview = useCallback(
    (cardId: string) => {
      const previewIdx = previewable.findIndex((p) => p.cardId === cardId);
      if (previewIdx >= 0) setPreviewIndex(previewIdx);
    },
    [previewable]
  );

  function handleCardTap(cardId: string) {
    if (isMulliganBottom) {
      toggleSelect(cardId);
      return;
    }
    openPreview(cardId);
  }

  // The curtain has lifted (or the phase moved on solo) — the board owns the
  // screen again. Rendered as nothing rather than unmounted by the board so
  // the countdown above can finish on its own schedule.
  if (hidden) return null;

  // The title names the thing you are looking at: nothing else on screen
  // says which deck this is.
  const title = isMulliganBottom
    ? `Put ${requiredBottom} on the bottom`
    : online
      ? 'Your opening hand'
      : (deckName ?? 'Opening hand');

  const status = !onlineWaiting
    ? null
    : countdown == null
      ? onlineWaiting.waitingOn.length > 0
        ? `Waiting for ${nameList(onlineWaiting.waitingOn)}`
        : // Nobody left to name and nobody has kept: this is the only seat at
          // the table, so the game is waiting on arrivals, not a decision.
          'Waiting for players to join'
      : countdown > 0
        ? `Game starts in ${countdown}s`
        : 'Game has started';

  const rootClass = [
    'card-picker-root',
    'playtest-opening-root',
    'is-takeover',
    peeking && 'is-peeking',
    waiting && 'is-waiting',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="presentation">
      <div className="card-picker-backdrop" />
      {peeking && (
        <button type="button" className="playtest-opening-peek" onClick={() => setPeeking(false)}>
          Back to hand
        </button>
      )}
      <div
        className="card-picker-sheet playtest-opening-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-opening-title"
      >
        {/* No drag-handle: this sheet is non-dismissable — the user must
            choose Keep or Mulligan (or select N cards for the bottom in
            the mulligan-bottom phase). Showing the swipe-affordance handle
            here was misleading users into trying to drag-down to dismiss. */}
        <div className="card-picker-header">
          {onExit && !waiting && (
            <button type="button" className="playtest-opening-back" onClick={onExit}>
              ← {exitLabel ?? 'Back to deck'}
            </button>
          )}
          <div className="playtest-opening-titleRow">
            <h2 id="playtest-opening-title" className="card-picker-title">
              {waiting ? 'Hand kept' : title}
            </h2>
            {mulliganCount > 0 && !waiting && (
              <span className="playtest-opening-badge">Mulligan {mulliganCount}</span>
            )}
          </div>
          {waiting ? null : isMulliganBottom ? (
            <p className="playtest-opening-hint">
              Tap {requiredBottom} card{requiredBottom === 1 ? '' : 's'} to send to the bottom, in
              order. Long-press to preview.{' '}
              <strong>
                {selected.length}/{requiredBottom} selected
              </strong>
            </p>
          ) : (
            previewable.length > 0 && (
              <p className="playtest-opening-hint">Tap a card to enlarge.</p>
            )
          )}
        </div>

        <div
          className="playtest-opening-cards"
          // Card width is a share of this container (see the sheet rules
          // above); the live count keeps that exact for a short hand too.
          style={{ '--hand-n': orderedHand.length } as CSSProperties}
          aria-label={
            isMulliganBottom
              ? 'Hand: tap to select, long-press to preview'
              : 'Opening hand: tap to preview'
          }
        >
          {orderedHand.map((c, i) => {
            const idx = bottomIndex(c.id);
            const isSel = idx !== null;
            const hasPreview = previewable.some((p) => p.cardId === c.id);
            const tappable = isMulliganBottom || hasPreview;
            return (
              // The slot carries the fan geometry, the card inside carries
              // dnd-kit's drag transform — see OpeningHandSheet.css. It is
              // `display: contents` in the sheet, so the phone layout is
              // exactly what it was before the slot existed.
              <div
                key={c.id}
                className="playtest-opening-slot"
                style={
                  {
                    '--oh-i': i,
                    '--oh-n': orderedHand.length,
                    '--oh-lift': `${arcLift(i, orderedHand.length)}px`,
                  } as CSSProperties
                }
              >
                <OpeningHandCard
                  card={c}
                  visualIndex={i}
                  isSelected={isSel}
                  selectedOrdinal={idx}
                  tappable={tappable}
                  isMulliganBottom={isMulliganBottom}
                  longPressEnabled={hasPreview}
                  onTap={handleCardTap}
                  onLongPress={openPreview}
                />
              </div>
            );
          })}
        </div>

        {!waiting && (
          <div className="card-picker-footer playtest-opening-footer">
            <button type="button" className="btn" onClick={() => setPeeking(true)}>
              View battlefield
            </button>
            {isMulliganBottom ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canConfirm}
                onClick={() => onConfirmBottom(selected)}
              >
                Send {selected.length}/{requiredBottom} to bottom
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn playtest-opening-mulligan"
                  onClick={onMulligan}
                  disabled={mulliganCount >= MAX_MULLIGANS}
                >
                  Mulligan
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  // Focus starts on the action the hand is usually answered
                  // with; jsx-a11y's no-autofocus is off for exactly this
                  // (a modal that owns the screen).
                  autoFocus
                  onClick={onKeep}
                >
                  Keep hand
                </button>
              </>
            )}
          </div>
        )}

        {handStats && !waiting && (
          <p className="playtest-opening-stats">
            <strong>{handStats.lands}</strong> {handStats.lands === 1 ? 'land' : 'lands'} ·{' '}
            <span
              className={`playtest-opening-verdict ${
                handStats.keepable ? 'is-keepable' : 'is-mulligan'
              }`}
            >
              {handStats.keepable ? 'Keepable' : 'Mulligan'}
            </span>
            {avgLands !== null && (
              <span className="playtest-opening-avg">
                {' '}
                · avg {avgLands.toFixed(1)} lands/hand over {landHistory.length} hands
              </span>
            )}
          </p>
        )}

        {status && (
          <p className="playtest-opening-status" aria-live="polite">
            {status}
          </p>
        )}

        {/* Both variants are only meaningful while play hasn't started, so
            they live on the opening step and disappear once you're
            bottoming (mulligan-bottom) or the choice is already locked in. */}
        {!isMulliganBottom && !waiting && (
          <div className="playtest-opening-variants">
            {tableMulligan ? (
              // Seated: the pod set the rule in the lobby, so this states it
              // rather than offering a second, contradictory switch.
              <p className="playtest-opening-variant__table">{tableMulligan}</p>
            ) : (
              <label className="playtest-opening-variant">
                <input
                  type="checkbox"
                  aria-label="Free mulligans"
                  checked={freeMulligan}
                  onChange={(e) => onFreeMulliganChange(e.target.checked)}
                />
                <span className="playtest-opening-variant__text">
                  <span className="playtest-opening-variant__label">Free mulligans</span>
                  <span className="playtest-opening-variant__desc">
                    Redraw a full seven. Nothing goes to the bottom.
                  </span>
                </span>
              </label>
            )}
            <label className="playtest-opening-variant">
              <input
                type="checkbox"
                aria-label="On the draw"
                checked={onDraw}
                onChange={(e) => onOnDrawChange(e.target.checked)}
              />
              <span className="playtest-opening-variant__text">
                <span className="playtest-opening-variant__label">On the draw</span>
                <span className="playtest-opening-variant__desc">
                  Draw an extra card the moment play starts.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="playtest"
          cards={previewCards}
          index={previewIndex}
          binderName={deckName ?? 'Opening hand'}
          sectionLabels={previewLabels}
          pageNumbers={previewPages}
          totalPages={1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}

interface OpeningHandCardProps {
  card: PlaytestCard;
  /** Position in the displayed order, used only for stacking z-index. */
  visualIndex: number;
  isSelected: boolean;
  /** 1-based position in the bottom-of-library selection, or null when not selected. */
  selectedOrdinal: number | null;
  /** False disables the button entirely (no preview, no select). */
  tappable: boolean;
  isMulliganBottom: boolean;
  /** True when a preview is available for this card; gates the long-press handler. */
  longPressEnabled: boolean;
  onTap(cardId: string): void;
  onLongPress(cardId: string): void;
}

/**
 * Lifted out of the parent's `hand.map(...)` so each card can call its own
 * `useLongPress` hook (it stores per-instance ref state).
 *
 * Two gestures share this button surface:
 * - **Tap** (<6px, <500ms): preview in opening phase, select in mulligan-bottom.
 * - **Long-press** (<6px, ≥500ms): preview. The only way to preview during
 *   mulligan-bottom, since tap is reserved for selection there.
 *
 * `consumedClick()` swallows the synthetic click that follows a fired
 * long-press so the click handler doesn't also toggle selection.
 */
function OpeningHandCard({
  card,
  visualIndex,
  isSelected,
  selectedOrdinal,
  tappable,
  isMulliganBottom,
  longPressEnabled,
  onTap,
  onLongPress,
}: OpeningHandCardProps) {
  const longPress = useLongPress({ onLongPress: () => onLongPress(card.id) });
  const handleClick = () => {
    if (longPress.consumedClick()) return;
    onTap(card.id);
  };
  // One instance per card.id (keyed in the parent .map), so this resets
  // naturally whenever a different card occupies this slot.
  const [imgError, setImgError] = useState(false);
  const touchHandlers = longPressEnabled
    ? {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onTouchCancel: longPress.onTouchCancel,
      }
    : undefined;
  return (
    <button
      type="button"
      className={`playtest-opening-card${isSelected ? ' is-selected' : ''}`}
      style={{ zIndex: visualIndex }}
      onClick={handleClick}
      {...touchHandlers}
      aria-pressed={isMulliganBottom ? isSelected : undefined}
      aria-label={`${card.name}${isSelected ? `: selected, position ${selectedOrdinal}` : ''}`}
      disabled={!tappable}
    >
      {card.imageUrl && !imgError ? (
        <img
          src={card.imageUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="playtest-opening-cardName">{card.name}</span>
      )}
      {selectedOrdinal != null && (
        <span className="playtest-opening-cardBadge" aria-hidden>
          {selectedOrdinal}
        </span>
      )}
    </button>
  );
}
