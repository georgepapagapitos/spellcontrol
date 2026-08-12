import { useEffect, useState } from 'react';
import { joinClasses } from '@/lib/join-classes';
import { useCardThumb } from '@/lib/card-thumbs';
import { paletteForIndex } from '@/lib/seat-palette';
import type { PublicBattlefieldCard, PublicBoard } from '@/lib/playtest/projection';
import { DESIGNATIONS } from '../lib/designations';
import { OpponentBoardModal } from './OpponentBoardModal';
import './OpponentRail.css';

export interface OpponentSeat {
  /** Display name for this seat — `PublicBoard` carries no identity beyond a
   *  numeric seat, so the caller (which owns the roster) supplies it. */
  name: string;
  /** This seat's board, already projected for opponents — see `toPublicBoard`. */
  board: PublicBoard;
  /** True when this seat is at the table but hasn't published a board yet
   *  (just joined, or hasn't touched their battlefield this session). The
   *  seat is never omitted for this — see STYLE_GUIDE "no opponent may ever
   *  be hidden" — but its board-shaped fields (`battlefield`/`handCount`/
   *  `libraryCount`) are meaningless placeholders, not a real empty board,
   *  so this flag swaps them for a "no board shared yet" line instead of
   *  rendering fabricated zeros. `board.life` is still shown — it's real. */
  pending?: boolean;
}

interface OpponentRailProps {
  opponents: OpponentSeat[];
  /** Seat currently holding the turn at the table, if known. */
  activeSeat?: number;
}

// A glance-density mini battlefield beyond this many permanents rolls the
// rest into a "+N" chip — mirrors PlaytestCardFace's sticker-overflow cap.
const MAX_MINI_TILES = 12;

/**
 * Opponent presence rail — the compact "who else is at the table" strip for
 * an online multiplayer Commander table. Presentational only: takes
 * already-projected `PublicBoard`s as props and renders them; no networking,
 * no store wiring, no data fetching of session state — `playtest/hooks/
 * use-online-table.ts` is what derives `opponents` from the live session and
 * mounts this in `PlaytestBoard`. Card art for the glance mini-battlefield
 * still resolves through the shared `useCardThumb` CDN cache, the same
 * primitive every other card-rendering surface in the app uses.
 *
 * Follows the long axis (STYLE_GUIDE "Opponent rail"): a top strip in
 * portrait renders dense **presence** badges (color, name, life, permanent
 * count); a side rail in landscape renders roomier **glance** cards (life,
 * name, a real miniature battlefield). No opponent is ever hidden, scrolled
 * out, or folded into an overflow menu — see the STYLE_GUIDE ruling for why.
 */
/*
 * Glance density needs landscape AND enough width to actually spend on a side
 * rail. Orientation alone is not the signal: a phone held sideways (844x390)
 * is "landscape" but has no slack — a side rail there would eat width the
 * board can't spare, and would mount miniature battlefields (firing
 * `useCardThumb` per opponent card) at a size nothing is legible in. The whole
 * long-axis rule is premised on the long axis having slack.
 *
 * 900px separates the two cleanly: tablet-landscape (iPad ~1024-1180) gets
 * glance, every phone landscape (568 / 736 / 844) stays on presence.
 */
const GLANCE_QUERY = '(orientation: landscape) and (min-width: 900px)';

export function OpponentRail({ opponents, activeSeat }: OpponentRailProps) {
  const [isGlance, setIsGlance] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(GLANCE_QUERY).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(GLANCE_QUERY);
    const update = () => setIsGlance(mql.matches);
    // Sync once on mount: the media state can change between the initial
    // render and the listener attaching (rotation during hydration).
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // Which seat's full board is open in the inspector, if any — the rail's
  // "promotion" interaction (STYLE_GUIDE § Opponent rail). Kept by seat
  // number, not a frozen board snapshot, so the modal re-renders with the
  // opponent's live board as it changes (an opponent's board is exactly the
  // thing you're inspecting *during* their turn).
  const [inspecting, setInspecting] = useState<number | null>(null);
  const inspectingOpp = opponents.find((o) => o.board.seat === inspecting) ?? null;

  if (opponents.length === 0) return null;

  return (
    <div
      className={joinClasses(
        'opponent-rail',
        isGlance ? 'opponent-rail--glance' : 'opponent-rail--presence'
      )}
    >
      <ul className="opponent-rail__list" role="list" aria-label="Opponents">
        {opponents.map((opp) => (
          <OpponentEntry
            key={opp.board.seat}
            opp={opp}
            glance={isGlance}
            active={opp.board.seat === activeSeat}
            onOpen={() => setInspecting(opp.board.seat)}
          />
        ))}
      </ul>
      {inspectingOpp && (
        <OpponentBoardModal
          opp={inspectingOpp}
          active={inspectingOpp.board.seat === activeSeat}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}

function OpponentEntry({
  opp,
  glance,
  active,
  onOpen,
}: {
  opp: OpponentSeat;
  glance: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const { name, board, pending } = opp;
  const palette = paletteForIndex(board.seat);
  const held = DESIGNATIONS.filter((d) => board[d.key]);
  const permanentCount = board.battlefield.length;

  // Screen readers get the full picture regardless of density — the visual
  // trim in presence mode is a space constraint, not an information one.
  const ariaLabel = [
    name,
    `${board.life} life`,
    active && "this player's turn",
    pending
      ? 'no board shared yet'
      : `${permanentCount} permanent${permanentCount === 1 ? '' : 's'}`,
    !pending && `${board.handCount} card${board.handCount === 1 ? '' : 's'} in hand`,
    !pending && `${board.libraryCount} in library`,
    held.length > 0 && `holds ${held.map((d) => d.label).join(', ')}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li
      className={joinClasses('opponent-entry', active && 'is-active-turn')}
      style={{
        ['--opp-base' as never]: palette.base,
        ['--opp-edge' as never]: palette.edge,
      }}
    >
      {/* The whole entry is the tap target for the full-board inspector
          (STYLE_GUIDE § Opponent rail's "promotion" interaction) — a real
          button, not a div faking one, so it's keyboard-reachable and
          announces as a dialog trigger. `aria-current` moves here too:
          it's the interactive element that represents this list item. */}
      <button
        type="button"
        className="opponent-entry__trigger"
        aria-current={active ? 'true' : undefined}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <div className="opponent-entry__head">
          <span className="opponent-entry__dot" aria-hidden="true" />
          <span className="opponent-entry__name" aria-hidden="true">
            {name}
          </span>
          {active && (
            <span className="opponent-entry__turn-chip" aria-hidden="true">
              Turn
            </span>
          )}
          <span className="opponent-entry__life" aria-hidden="true">
            {board.life}
          </span>
        </div>
        {held.length > 0 && (
          <span className="opponent-entry__designations" aria-hidden="true">
            {held.map((d) => (
              <span key={d.key} className="opponent-entry__designation" title={d.label}>
                {d.icon}
              </span>
            ))}
          </span>
        )}
        {pending ? (
          <span className="opponent-entry__permanents" aria-hidden="true">
            No board shared yet
          </span>
        ) : glance ? (
          <>
            <span className="opponent-entry__counts" aria-hidden="true">
              Hand {board.handCount} · Library {board.libraryCount}
            </span>
            <MiniBattlefield cards={board.battlefield} />
          </>
        ) : (
          <span className="opponent-entry__permanents" aria-hidden="true">
            {permanentCount} permanent{permanentCount === 1 ? '' : 's'}
          </span>
        )}
      </button>
    </li>
  );
}

function MiniBattlefield({ cards }: { cards: PublicBattlefieldCard[] }) {
  const visible = cards.slice(0, MAX_MINI_TILES);
  const overflow = cards.length - visible.length;
  return (
    <div className="opponent-entry__battlefield" aria-hidden="true">
      {cards.length === 0 ? (
        <span className="opponent-entry__battlefield-empty">No permanents</span>
      ) : (
        <>
          {visible.map((bf) => (
            <MiniCard key={bf.card.id} bf={bf} />
          ))}
          {overflow > 0 && <span className="opponent-mini-card__more">+{overflow}</span>}
        </>
      )}
    </div>
  );
}

function MiniCard({ bf }: { bf: PublicBattlefieldCard }) {
  // A redacted face-down card carries no name — useCardThumb no-ops on
  // undefined, so this never risks resolving (or leaking) its identity.
  const art = useCardThumb(bf.faceDown ? undefined : bf.card.name, 'art_crop');
  return (
    <span
      className={joinClasses('opponent-mini-card', bf.tapped && 'is-tapped')}
      title={bf.faceDown ? 'Face-down card' : bf.card.name}
    >
      {bf.faceDown ? (
        <span className="opponent-mini-card__back" />
      ) : art ? (
        <img src={art} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="opponent-mini-card__placeholder" />
      )}
    </span>
  );
}
