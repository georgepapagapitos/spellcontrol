import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useMediaQuery } from '@/lib/use-media-query';
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

/** Tablet and up gets the full-screen takeover; phones keep the sheet. */
export const TAKEOVER_QUERY = '(min-width: 1024px)';

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

/** In the fan, a card's axis-aligned box covers a third of its neighbour's, so
 *  box-vs-box collision is guesswork: `closestCenter` alone hands the drop to
 *  whichever centre happens to be nearest rather than the card under the
 *  pointer. `pointerWithin` answers with the card you are actually pointing at;
 *  `closestCenter` only covers the gap when the pointer is over no card at all
 *  (the arc leaves wedges between them, and the sheet tier has row gaps). */
const fanCollision: CollisionDetection = (args) => {
  const pointed = pointerWithin(args);
  return pointed.length > 0 ? pointed : closestCenter(args);
};

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
  const takeover = useMediaQuery(TAKEOVER_QUERY);
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

  // Local visual order for drag-to-reorder — independent of the prop's order.
  // PlaytestCard.id is the per-instance id from the reducer and stays stable
  // for the lifetime of the hand, so it doubles as the sortable slot id.
  // Reset whenever the prop's *set* of cards changes (mulligan → new deal): a
  // fresh hand starts in deal order; a re-render of the same hand preserves
  // whatever order the user dragged it into.
  //
  // Render-phase reset (vs. useEffect) sidesteps `react-hooks/set-state-in-effect`
  // and is the official React pattern for syncing derived state from props.
  // The signature (sorted ids joined) collapses identity comparison to a string
  // diff so a same-set-different-order re-render doesn't clobber local drags.
  const handSignature = hand
    .map((c) => c.id)
    .sort()
    .join('|');
  const [order, setOrder] = useState<string[]>(() => hand.map((c) => c.id));
  const [trackedSignature, setTrackedSignature] = useState<string>(handSignature);
  if (trackedSignature !== handSignature) {
    setTrackedSignature(handSignature);
    setOrder(hand.map((c) => c.id));
  }

  const orderedHand = useMemo(() => {
    const byId = new Map(hand.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)).filter((c): c is PlaytestCard => Boolean(c));
  }, [hand, order]);

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
  // phase state sync (not a useEffect) for the same reason `order` above
  // does it: each *distinct* opening hand seen gets counted exactly once,
  // never re-counted on an unrelated re-render of the same hand.
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

  // PointerSensor's `distance: 6` activation matches the long-press tolerance
  // (`useLongPress` also cancels on >6px movement) — gives the three gestures
  // non-overlapping thresholds: <6px + <500ms → tap, <6px + ≥500ms →
  // long-press, ≥6px → drag. KeyboardSensor adds Tab → Space → Arrows
  // reordering for keyboard / SR users.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // dnd-kit's `restrictToParentElement` clamps to the dragged node's PARENT.
  // Since each card gained a fan slot, that parent is a box exactly the card's
  // own size, which pinned every drag to zero movement (and in the sheet tier
  // the slot is `display: contents`, so it has no box at all). Clamp to the
  // hand container instead — same intent, the right box. An axis is left alone
  // when the container isn't bigger than the card on it, so a rotated card
  // whose bounding box overhangs the row can't invert the bounds.
  const cardsRef = useRef<HTMLDivElement>(null);
  const restrictToHand = useCallback<Modifier>(({ draggingNodeRect, transform }) => {
    const box = cardsRef.current?.getBoundingClientRect();
    if (!draggingNodeRect || !box) return transform;
    const clamp = (v: number, lo: number, hi: number) =>
      lo > hi ? v : Math.min(Math.max(v, lo), hi);
    return {
      ...transform,
      x: clamp(transform.x, box.left - draggingNodeRect.left, box.right - draggingNodeRect.right),
      y: clamp(transform.y, box.top - draggingNodeRect.top, box.bottom - draggingNodeRect.bottom),
    };
  }, []);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  // The curtain has lifted (or the phase moved on solo) — the board owns the
  // screen again. Rendered as nothing rather than unmounted by the board so
  // the countdown above can finish on its own schedule.
  if (hidden) return null;

  // The sheet's titles are unchanged; the takeover names the thing you're
  // looking at, since it has the room and nothing else on screen says it.
  const title = isMulliganBottom
    ? takeover
      ? `Put ${requiredBottom} on the bottom`
      : 'Bottom of library'
    : takeover
      ? online
        ? 'Your opening hand'
        : (deckName ?? 'Opening hand')
      : 'Opening hand';

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
    takeover && 'is-takeover',
    takeover && peeking && 'is-peeking',
    waiting && 'is-waiting',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="presentation">
      <div className="card-picker-backdrop" />
      {takeover && peeking && (
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
          {takeover && onExit && !waiting && (
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
              order. Long-press to preview, drag to reorder.{' '}
              <strong>
                {selected.length}/{requiredBottom} selected
              </strong>
            </p>
          ) : (
            previewable.length > 0 && (
              <p className="playtest-opening-hint">Tap a card to enlarge · drag to reorder.</p>
            )
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={fanCollision}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToHand]}
        >
          {/* `rectSortingStrategy` (not the horizontal one) and no horizontal-
              axis restriction: the hand wraps to two rows on phones, and a
              horizontal-only drag can't move a card between rows. */}
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <div
              ref={cardsRef}
              className="playtest-opening-cards"
              // Card width is a share of this container (see the sheet rules
              // above); the live count keeps that exact for a short hand too.
              style={{ '--hand-n': orderedHand.length } as CSSProperties}
              aria-label={
                isMulliganBottom
                  ? 'Hand: drag to reorder, tap to select, long-press to preview'
                  : 'Opening hand: drag to reorder, tap to preview'
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
                    <SortableHandCard
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
          </SortableContext>
        </DndContext>

        {!waiting && (
          <div className="card-picker-footer playtest-opening-footer">
            {!takeover && onExit && (
              <button type="button" className="playtest-opening-back" onClick={onExit}>
                ← {exitLabel ?? 'Back to deck'}
              </button>
            )}
            {takeover && (
              <button type="button" className="btn" onClick={() => setPeeking(true)}>
                View battlefield
              </button>
            )}
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
                  autoFocus={takeover}
                  onClick={onKeep}
                >
                  {takeover ? 'Keep hand' : 'Keep this hand'}
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

interface SortableHandCardProps {
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
 * `useLongPress` + `useSortable` hooks (both store per-instance ref state).
 *
 * Three gestures share this button surface:
 * - **Tap** (<6px, <500ms): preview in opening phase, select in mulligan-bottom.
 * - **Long-press** (<6px, ≥500ms): preview. The only way to preview during
 *   mulligan-bottom since tap is reserved for selection there.
 * - **Drag** (≥6px): reorder via `@dnd-kit`.
 *
 * The thresholds are deliberately non-overlapping: dnd-kit's PointerSensor
 * `distance: 6` activation matches the long-press 6px tolerance, and the
 * long-press timer cancels on movement so a started drag never also fires
 * a preview. `consumedClick()` swallows the synthetic click that follows a
 * fired long-press so the click handler doesn't also toggle selection.
 *
 * `touch-action: none` lets dnd-kit own the touch surface for drag; the
 * inline long-press handlers still receive React's synthetic touch events
 * because those fire before browser default actions are consulted.
 */
function SortableHandCard({
  card,
  visualIndex,
  isSelected,
  selectedOrdinal,
  tappable,
  isMulliganBottom,
  longPressEnabled,
  onTap,
  onLongPress,
}: SortableHandCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });
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
      ref={setNodeRef}
      type="button"
      className={`playtest-opening-card${isSelected ? ' is-selected' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      style={{
        zIndex: isDragging ? 50 : visualIndex,
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: 'none',
      }}
      onClick={handleClick}
      {...attributes}
      {...listeners}
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
