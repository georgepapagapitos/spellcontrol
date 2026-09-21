import { joinClasses } from '@/lib/join-classes';
import { useCardThumb } from '@/lib/card-thumbs';
import { paletteForIndex } from '@/lib/seat-palette';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import type { PublicBattlefieldCard } from '@/lib/playtest/projection';
import { commanderTaxAmount } from '../lib/zones';
import { DESIGNATIONS } from '../lib/designations';
import { useNewCardIds } from '../hooks/use-new-card-ids';
import { useUnseenChanges } from '../hooks/use-unseen-changes';
import { PlaytestCardFace } from './PlaytestCardFace';
import type { OpponentSeat } from './OpponentRail';
import './OpponentQuadrant.css';

/** How many face-down backs the opponent's hand fan draws before it rolls the
 *  rest into a "+N" chip. A 20-card hand at quadrant density is a smear; the
 *  exact count is in the aria-label and the inspector either way. */
const MAX_HAND_BACKS = 10;

/** The seat grid's gate. Shares the same 1024px floor as every other "table
 *  chrome" tier in this file's CSS (`useNarrowViewport`'s `isNarrow`,
 *  playtest.css's corner-chrome rules) rather than a breakpoint of its own —
 *  below it the whole layout switches to the mobile shell (row hand, sheet
 *  drawers), which a seat grid can't coexist with regardless of width.
 *  Card size inside a quadrant is container-driven, not viewport-driven (see
 *  OpponentQuadrant.css), and floors at 36px — a floor the CSS already hits
 *  at the old 1440px gate on a typical laptop height, so pushing the gate
 *  down to 1024 asks nothing of the quadrant it wasn't already doing
 *  (STYLE_GUIDE "Desktop table with opponents: 2x2, not a rail"). */
export const TABLE_GRID_QUERY = '(min-width: 1024px)';

/** A 2x2 grid seats four. A fifth player would have to be hidden, and no
 *  opponent is ever hidden — that table keeps the rail. */
export const MAX_GRID_OPPONENTS = 3;

/**
 * The `data-preview-id` an opponent's permanent carries, and the only place
 * that prefix is spelled. Seat-scoped so it can never collide with one of the
 * viewer's own instance ids (`PlaytestCardFace` writes `card.id` straight
 * through), which is what lets PlaytestBoard's single `resolvePreview` serve
 * every quadrant in the grid from one map.
 */
export function opponentPreviewId(seat: number, cardId: string): string {
  return `opp${seat}:${cardId}`;
}

interface Props {
  opp: OpponentSeat;
  /** While the viewer is drawing an arrow, every permanent here is a target:
   *  tap one to finish the arrow on it. Absent otherwise. */
  onPickCard?: (cardId: string) => void;
  /** This seat holds the turn — the quadrant wears the gold ring. */
  active: boolean;
  /** This seat's turn just began — the one-shot sweep (`useTurnSweep`). */
  sweeping: boolean;
  /** Somebody at the table is pointing at this seat's board. */
  pointed: boolean;
  /** This seat's full-board inspector is open — every arrival is being seen. */
  watching: boolean;
  /** This quadrant holds the grid's top-right cell, which is where the
   *  viewport-fixed turn/menu stack floats. Insets the battlefield so the
   *  stack can never cover one of their permanents. */
  underTurnStack?: boolean;
  /** Open the inspector (`OpponentBoardModal`) for this seat. */
  onOpen(): void;
}

/**
 * One opponent's whole board, live, as a quadrant of the desktop seat grid
 * (STYLE_GUIDE § "Desktop table with opponents: 2x2, not a rail"). Read-mostly:
 * it renders a `PublicBoard` at a quadrant-local density and every control on
 * it opens the same `OpponentBoardModal` inspector the rail's entry opens.
 *
 * Density is container-driven, never viewport-driven: the section is a
 * `container-type: inline-size` container and the inner surface sizes
 * `--pt-card-w` off `cqi`, so a quadrant narrowed by a third seat shrinks its
 * cards without a media query knowing anything about the grid's shape.
 * Battlefield permanents use the same `left: calc(x * (100% - cardW))` math
 * the local board uses, off the same custom properties, so an opponent's
 * layout arrives exactly as they arranged it.
 */
export function OpponentQuadrant({
  opp,
  active,
  sweeping,
  pointed,
  watching,
  underTurnStack = false,
  onOpen,
  onPickCard,
}: Props) {
  const { name, board, pending } = opp;
  const palette = paletteForIndex(board.seat);
  const held = DESIGNATIONS.filter((d) => board[d.key]);
  const permanentCount = board.battlefield.length;
  const newIds = useNewCardIds(board.battlefield.map((bf) => bf.card.id));
  const unseen = useUnseenChanges(
    [board.battlefield, board.graveyard, board.exile, board.command].flatMap((zone) =>
      zone.map((c) => ('card' in c ? c.card.id : c.id))
    ),
    watching || Boolean(pending)
  );

  // The rail's entry label, verbatim: a quadrant carries more picture than a
  // rail entry but exactly the same facts, and a screen-reader user must not
  // lose any of them by gaining a bigger screen.
  const ariaLabel = [
    name,
    `${board.life} life`,
    active && "this player's turn",
    pending
      ? 'no board shared yet'
      : `${permanentCount} permanent${permanentCount === 1 ? '' : 's'}`,
    !pending && `${board.handCount} card${board.handCount === 1 ? '' : 's'} in hand`,
    !pending && `${board.libraryCount} in library`,
    // Both are things the table is being told on purpose, so they belong in
    // the label a screen-reader user hears rather than only in the picture.
    !pending &&
      (board.revealed?.length ?? 0) > 0 &&
      `showing ${board.revealed!.map((c) => c.name ?? 'a card').join(', ')}`,
    !pending && (board.stack?.length ?? 0) > 0 && `${board.stack!.length} on the stack`,
    held.length > 0 && `holds ${held.map((d) => d.label).join(', ')}`,
    pointed && 'being pointed at',
    unseen > 0 && `${unseen} change${unseen === 1 ? '' : 's'} since you last looked`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <section
      className={joinClasses(
        'opponent-quadrant',
        active && 'is-active-turn',
        sweeping && 'opponent-quadrant--turn-sweep',
        pointed && 'is-pointed',
        underTurnStack && 'opponent-quadrant--under-stack'
      )}
      aria-label={ariaLabel}
      data-seat-anchor={board.seat}
      style={{
        ['--opp-base' as never]: palette.base,
        ['--opp-edge' as never]: palette.edge,
      }}
    >
      {/* Everything lives one level in: `cqi` resolves against the nearest
          ANCESTOR container, so the element declaring `container-type` can't
          size itself off its own width. */}
      <div className="opponent-quadrant__inner">
        {!pending && (
          <div className="opponent-quadrant__felt">
            {board.battlefield.map((bf) => (
              <QuadrantCard
                key={bf.card.id}
                seat={board.seat}
                bf={bf}
                isNew={newIds.has(bf.card.id)}
                onPick={onPickCard ? () => onPickCard(bf.card.id) : undefined}
              />
            ))}
          </div>
        )}

        <div className="opponent-quadrant__life" aria-hidden="true">
          <span className="opponent-quadrant__life-value">{board.life}</span>
          {held.length > 0 && (
            <span className="opponent-quadrant__designations">
              {held.map((d) => (
                <span key={d.key} className="opponent-quadrant__designation" title={d.label}>
                  {d.icon}
                </span>
              ))}
            </span>
          )}
          {unseen > 0 && <span className="opponent-quadrant__new">{unseen} new</span>}
        </div>

        <button
          type="button"
          className="opponent-quadrant__name"
          aria-haspopup="dialog"
          aria-label={`Open ${name}'s board`}
          onClick={onOpen}
        >
          <span className="opponent-quadrant__dot" aria-hidden="true" />
          <span className="opponent-quadrant__name-text">{name}</span>
          {active && (
            <span className="opponent-quadrant__turn-chip" aria-hidden="true">
              Turn
            </span>
          )}
        </button>

        {pending ? (
          <p className="opponent-quadrant__pending">No board shared yet.</p>
        ) : (
          <>
            <div className="opponent-quadrant__hand" aria-hidden="true">
              {Array.from({ length: Math.min(board.handCount, MAX_HAND_BACKS) }, (_, i) => (
                <span
                  key={i}
                  className="opponent-quadrant__hand-back"
                  style={{
                    ['--oq-i' as never]: i - (Math.min(board.handCount, MAX_HAND_BACKS) - 1) / 2,
                  }}
                />
              ))}
              {board.handCount > MAX_HAND_BACKS && (
                <span className="opponent-quadrant__hand-more">
                  +{board.handCount - MAX_HAND_BACKS}
                </span>
              )}
            </div>

            {(board.revealed?.length ?? 0) > 0 && (
              <div className="opponent-quadrant__revealed">
                <span className="opponent-quadrant__revealed-label">Showing</span>
                {board.revealed!.map((c) => (
                  <span key={c.id} className="opponent-quadrant__revealed-card">
                    {c.name ?? 'A card'}
                  </span>
                ))}
              </div>
            )}

            <div className="opponent-quadrant__piles">
              <QuadrantPile label="Library" count={board.libraryCount} name={name} onOpen={onOpen}>
                <span className="opponent-quadrant__pile-back" aria-hidden="true" />
              </QuadrantPile>
              <QuadrantPile
                label="Graveyard"
                count={board.graveyard.length}
                name={name}
                onOpen={onOpen}
              >
                <PileArt card={board.graveyard[board.graveyard.length - 1]} />
              </QuadrantPile>
              <QuadrantPile label="Exile" count={board.exile.length} name={name} onOpen={onOpen}>
                <PileArt card={board.exile[board.exile.length - 1]} />
              </QuadrantPile>
              <QuadrantPile
                label="Command"
                count={board.command.length}
                name={name}
                onOpen={onOpen}
                tax={commanderTaxAmount(board.commanderTax, board.command[0]?.id)}
              >
                <PileArt card={board.command[0]} />
              </QuadrantPile>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** The seat nobody is sitting in yet — a three-player table is a 2x2 grid with
 *  one quiet hole, never a lopsided row (STYLE_GUIDE). Not a `section`: there
 *  is no seat here to label. */
export function OpenSeatQuadrant() {
  return (
    <div className="opponent-quadrant opponent-quadrant--open" aria-hidden="true">
      <span className="opponent-quadrant__open-label">Open seat</span>
    </div>
  );
}

/** One permanent, rendered through the same `PlaytestCardFace` the local board
 *  uses — tapped rotation, counters, stickers, attachments, phased and the
 *  face-down back all come for free, at whatever `--pt-card-w` the quadrant
 *  resolved. Art comes off the shared CDN cache (`PublicBoard` never carries
 *  image URLs; see projection.ts). */
function QuadrantCard({
  seat,
  bf,
  isNew,
  onPick,
}: {
  seat: number;
  bf: PublicBattlefieldCard;
  isNew: boolean;
  /** Arrow-drawing mode: this card is a target. */
  onPick?: () => void;
}) {
  const art = useCardThumb(bf.faceDown ? undefined : bf.card.name, 'normal');
  // `PlaytestCardFace` publishes `card.id` as `data-preview-id`, so the
  // seat-scoped id goes in here rather than being layered on afterwards. A
  // face-down card gets no preview id from the face at all, which is the
  // whole reason its identity can't leak through the hover slot.
  const card: PlaytestCard = {
    id: opponentPreviewId(seat, bf.card.id),
    name: bf.card.name ?? '',
    imageUrl: art,
    manaValue: bf.card.manaValue,
    typeLine: bf.card.typeLine,
    isToken: bf.card.isToken,
    oracleId: bf.card.oracleId,
    scryfallId: bf.card.scryfallId,
  };
  const adapted: BattlefieldCard = {
    card,
    tapped: bf.tapped,
    counters: bf.counters,
    stickers: bf.stickers,
    x: bf.x,
    y: bf.y,
    faceDown: bf.faceDown,
    showBackFace: bf.showBackFace,
    attachedTo: bf.attachedTo,
    phased: bf.phased,
  };
  const face = (
    <PlaytestCardFace
      card={card}
      bf={adapted}
      className={joinClasses('opponent-quadrant__card', isNew && 'is-entering')}
      title={bf.faceDown ? 'Face-down card' : bf.card.name}
      style={{
        ['--pt-x' as never]: bf.x,
        ['--pt-y' as never]: bf.y,
        position: 'absolute',
        left: 'calc(var(--pt-x) * (100% - var(--pt-card-w)))',
        top: 'calc(var(--pt-y) * (100% - var(--pt-card-h)))',
        transform: bf.tapped ? 'rotate(90deg)' : undefined,
        transformOrigin: 'center center',
      }}
    />
  );
  if (!onPick) return face;
  // A real button over the card while an arrow is being drawn: keyboard-
  // reachable, announced as the target it is, gone the moment the mode ends.
  const what = bf.faceDown ? 'a face-down card' : (bf.card.name ?? 'this card');
  return (
    <button
      type="button"
      className="opponent-quadrant__pick"
      aria-label={`Point the arrow at ${what}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      {face}
    </button>
  );
}

function PileArt({ card }: { card?: { name?: string } }) {
  const art = useCardThumb(card?.name, 'art_crop');
  if (!art) return <span className="opponent-quadrant__pile-empty" aria-hidden="true" />;
  return <img className="opponent-quadrant__pile-art" src={art} alt="" loading="lazy" />;
}

function QuadrantPile({
  label,
  count,
  name,
  tax,
  onOpen,
  children,
}: {
  label: string;
  count: number;
  name: string;
  tax?: number;
  onOpen(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="opponent-quadrant__pile"
      aria-haspopup="dialog"
      aria-label={`${label}, ${count}. Open ${name}'s board`}
      onClick={onOpen}
    >
      <span className="opponent-quadrant__pile-face">{children}</span>
      <span className="opponent-quadrant__pile-label" aria-hidden="true">
        {label} <span className="opponent-quadrant__pile-count">({count})</span>
        {tax ? <span className="opponent-quadrant__pile-tax"> +{tax}</span> : null}
      </span>
    </button>
  );
}
