import { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useCardThumb } from '@/lib/card-thumbs';
import { paletteForIndex } from '@/lib/seat-palette';
import { Tabs, type TabItem } from '@/components/Tabs';
import { CardPreview } from '@/components/CardPreview';
import { useEnrichedListEntries } from '@/lib/use-enriched-list-entries';
import type { EnrichedCard, ListEntry } from '@/types';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import type { ProjectedCard, PublicBattlefieldCard } from '@/lib/playtest/projection';
import { commanderTaxAmount } from '../lib/zones';
import { DESIGNATIONS } from '../lib/designations';
import { type OpponentSeat } from './OpponentRail';
import { useNewCardIds } from '../hooks/use-new-card-ids';
import { PlaytestCardFace } from './PlaytestCardFace';
import './OpponentBoardModal.css';

type BoardZone = 'battlefield' | 'graveyard' | 'exile' | 'command';

interface Props {
  opp: OpponentSeat;
  /** Whose turn it currently is at the table — highlights the header. */
  active: boolean;
  onClose(): void;
}

/** A resolvable card projects into a `ListEntry` so it can ride the same
 *  batch-resolution + skeleton-fallback path every other printing-reference
 *  view uses (`useEnrichedListEntries`) — no bespoke Scryfall plumbing here. */
function toListEntry(pc: ProjectedCard): ListEntry {
  return {
    id: pc.id,
    name: pc.name ?? '',
    scryfallId: pc.scryfallId ?? '',
    setCode: '',
    collectorNumber: '',
    finish: 'nonfoil',
    oracleId: pc.oracleId,
    quantity: 1,
  };
}

/**
 * The opponent-rail's "promotion" interaction (STYLE_GUIDE § Opponent rail):
 * the glance rail deliberately caps at a dozen mini tiles and never shows the
 * non-battlefield zones — this is where a tapped opponent's *entire* public
 * board actually gets read. Portaled to `document.body`: `OpponentRail` is
 * mounted inside `.opponent-entry`, which is a `container-type: inline-size`
 * container and would otherwise trap this sheet's `position: fixed` to a
 * ~300px slot instead of the viewport (same reasoning as `CardPreview`).
 *
 * Card identity resolves through `useEnrichedListEntries` — the same batch
 * `getCardsByIds` + skeleton-fallback path the collection/list views use —
 * so inspecting an opponent's card reuses the app's one `CardPreview`
 * carousel instead of a bespoke card viewer. Face-down battlefield cards are
 * never included in the resolved entry set at all (their `ProjectedCard` is
 * redacted to `{ id }` upstream in `toPublicBoard` — see projection.ts), so
 * there is no lookup, no click handler, and no path to their identity here.
 */
export function OpponentBoardModal({ opp, active, onClose }: Props) {
  const { name, board, pending } = opp;
  const labelId = useId();
  const palette = paletteForIndex(board.seat);
  const held = DESIGNATIONS.filter((d) => board[d.key]);

  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd, exitStyle } = useSheetExit(onClose, 'sheet-fall');
  useEscapeKey(beginClose);

  const [activeZone, setActiveZone] = useState<BoardZone>('battlefield');
  // Tracked by (zone, card id) rather than a snapshot index — the board can
  // keep changing live while inspected (that's the whole point of reading it
  // mid-turn), so a card that leaves its zone while previewed should drop the
  // preview rather than silently reveal whatever card slid into its old
  // index.
  const [preview, setPreview] = useState<{ zone: BoardZone; cardId: string } | null>(null);

  const visibleBattlefield = useMemo(
    () => board.battlefield.filter((bf) => !bf.faceDown),
    [board.battlefield]
  );

  // Card-enter moment: same per-seat "seen ids" baseline as the glance
  // rail's mini tiles (`useNewCardIds`, OpponentRail.tsx) — this modal
  // mounts fresh each time it's opened, so its own baseline starts empty and
  // the whole battlefield here never floods-animates on open.
  const newBattlefieldIds = useNewCardIds(board.battlefield.map((bf) => bf.card.id));

  // Every resolvable card across the whole board, batch-resolved once. Face-
  // down permanents never enter this list (see doc comment above).
  const entries = useMemo(
    () => [
      ...visibleBattlefield.map((bf) => toListEntry(bf.card)),
      ...board.graveyard.map(toListEntry),
      ...board.exile.map(toListEntry),
      ...board.command.map(toListEntry),
    ],
    [visibleBattlefield, board.graveyard, board.exile, board.command]
  );
  const { rows } = useEnrichedListEntries(entries);
  const byId = useMemo(() => new Map(rows.map((r) => [r.entry.id, r.card])), [rows]);

  const zoneEnriched = useMemo(
    (): Record<BoardZone, EnrichedCard[]> => ({
      battlefield: visibleBattlefield
        .map((bf) => byId.get(bf.card.id))
        .filter((c): c is EnrichedCard => Boolean(c)),
      graveyard: board.graveyard
        .map((c) => byId.get(c.id))
        .filter((c): c is EnrichedCard => Boolean(c)),
      exile: board.exile.map((c) => byId.get(c.id)).filter((c): c is EnrichedCard => Boolean(c)),
      command: board.command
        .map((c) => byId.get(c.id))
        .filter((c): c is EnrichedCard => Boolean(c)),
    }),
    [visibleBattlefield, board.graveyard, board.exile, board.command, byId]
  );

  function inspect(zone: BoardZone, cardId: string) {
    if (zoneEnriched[zone].some((c) => c.copyId === cardId)) setPreview({ zone, cardId });
  }

  // Resolve the tracked (zone, cardId) to a live index every render, so a
  // card that leaves its zone mid-inspection (see the state doc comment)
  // closes the preview instead of showing whatever now sits at a stale index.
  const previewCards = preview ? zoneEnriched[preview.zone] : null;
  const previewIndex = preview
    ? (previewCards?.findIndex((c) => c.copyId === preview.cardId) ?? -1)
    : -1;

  const tabs: TabItem<BoardZone>[] = [
    {
      id: 'battlefield',
      label: 'Battlefield',
      count: board.battlefield.length,
      controls: 'opp-board-panel',
    },
    {
      id: 'graveyard',
      label: 'Graveyard',
      count: board.graveyard.length,
      controls: 'opp-board-panel',
    },
    { id: 'exile', label: 'Exile', count: board.exile.length, controls: 'opp-board-panel' },
    { id: 'command', label: 'Command', count: board.command.length, controls: 'opp-board-panel' },
  ];

  const zoneLabel: Record<BoardZone, string> = {
    battlefield: 'Battlefield',
    graveyard: 'Graveyard',
    exile: 'Exile',
    command: 'Command zone',
  };

  return createPortal(
    <div
      className={`opponent-board-backdrop${isClosing ? ' is-closing' : ''}`}
      onClick={() => beginClose()}
    >
      <section
        className={`opponent-board-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        style={exitStyle}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <header className="opponent-board-head">
          <span className="opponent-board-handle" aria-hidden="true" />
          <div className="opponent-board-head-row">
            <span
              className="opponent-board-dot"
              aria-hidden="true"
              style={{
                ['--opp-base' as never]: palette.base,
                ['--opp-edge' as never]: palette.edge,
              }}
            />
            <div className="opponent-board-head-text">
              <h2 id={labelId} className="opponent-board-title">
                {name}
              </h2>
              <span className="opponent-board-sub">
                {board.life} life
                {!pending && ` · Hand ${board.handCount} · Library ${board.libraryCount}`}
                {active && ' · Their turn'}
              </span>
            </div>
            {held.length > 0 && (
              <span className="opponent-board-designations" aria-hidden="true">
                {held.map((d) => (
                  <span key={d.key} className="opponent-board-designation" title={d.label}>
                    {d.icon}
                  </span>
                ))}
              </span>
            )}
          </div>
          <button
            type="button"
            className="opponent-board-close"
            onClick={() => beginClose()}
            aria-label="Close board view"
          >
            ✕
          </button>
        </header>

        {pending ? (
          <p className="opponent-board-empty">No board shared yet.</p>
        ) : (
          <>
            <Tabs
              tabs={tabs}
              value={activeZone}
              onChange={setActiveZone}
              ariaLabel={`${name}'s zones`}
              className="opponent-board-tabs"
            />
            <div
              id="opp-board-panel"
              role="tabpanel"
              aria-labelledby={`sc-tab-${activeZone}`}
              className="opponent-board-panel"
            >
              {activeZone === 'battlefield' ? (
                board.battlefield.length === 0 ? (
                  <p className="playtest-zone-empty">No permanents.</p>
                ) : (
                  <div className="opponent-board-battlefield">
                    {board.battlefield.map((bf) => (
                      <BattlefieldTile
                        key={bf.card.id}
                        bf={bf}
                        isNew={newBattlefieldIds.has(bf.card.id)}
                        onInspect={(id) => inspect('battlefield', id)}
                      />
                    ))}
                  </div>
                )
              ) : (
                <ZoneGrid
                  zone={activeZone}
                  cards={board[activeZone]}
                  commanderTax={activeZone === 'command' ? board.commanderTax : undefined}
                  onInspect={(id) => inspect(activeZone, id)}
                />
              )}
            </div>
          </>
        )}
      </section>

      {preview && previewCards && previewIndex >= 0 && (
        <CardPreview
          source="playtest"
          cards={previewCards}
          index={previewIndex}
          binderName={`${name}'s board`}
          sectionLabels={previewCards.map(() => zoneLabel[preview.zone])}
          pageNumbers={previewCards.map(() => 1)}
          totalPages={1}
          onIndexChange={(i) => {
            const next = previewCards[i];
            if (next) setPreview({ zone: preview.zone, cardId: next.copyId });
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>,
    document.body
  );
}

/** One battlefield permanent, reusing the same `PlaytestCardFace` the real
 *  board renders with — tapped rotation, counters, stickers, attachments,
 *  phased, and the face-down back all come for free. Art resolves through
 *  the shared CDN cache (`useCardThumb`), same as the rail's mini tiles,
 *  since `PublicBoard` never carries `imageUrl` (see projection.ts). */
function BattlefieldTile({
  bf,
  isNew,
  onInspect,
}: {
  bf: PublicBattlefieldCard;
  isNew: boolean;
  onInspect: (cardId: string) => void;
}) {
  const art = useCardThumb(bf.faceDown ? undefined : bf.card.name, 'normal');
  const card: PlaytestCard = {
    id: bf.card.id,
    name: bf.card.name ?? '',
    imageUrl: art,
    manaValue: bf.card.manaValue,
    typeLine: bf.card.typeLine,
    isToken: bf.card.isToken,
    oracleId: bf.card.oracleId,
    scryfallId: bf.card.scryfallId,
  };
  const adaptedBf: BattlefieldCard = {
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
  const interactive = !bf.faceDown;
  return (
    <PlaytestCardFace
      card={card}
      bf={adaptedBf}
      size="lg"
      className={`opponent-board-card${isNew ? ' is-entering' : ''}`}
      // Rotate-AND-scale, not a bare rotate: the tile sits in a wrapping flex
      // grid, so a 90° rotation alone swings the card's long edge outside its
      // own box — an edge-column tapped card then clips off the modal's
      // scroll container (~30% of the leftmost card gone at 390px). Scaling
      // by the card aspect (488/680 ≈ 0.71) keeps the rotated bounding box
      // inside the cell: still unmistakably sideways, never cropped.
      style={{ transform: bf.tapped ? 'rotate(90deg) scale(0.71)' : undefined }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? card.name : 'Face-down card'}
      onClick={interactive ? () => onInspect(bf.card.id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onInspect(bf.card.id);
            }
          : undefined
      }
    />
  );
}

/** Graveyard / exile / command — always fully public (no redaction), so
 *  every card here is browsable and inspectable. Reuses the same
 *  `.playtest-zone-*` grid ZoneViewerModal already established for exactly
 *  this "browse a pile of face-up cards" shape. */
function ZoneGrid({
  zone,
  cards,
  commanderTax,
  onInspect,
}: {
  zone: BoardZone;
  cards: ProjectedCard[];
  commanderTax?: Record<string, number>;
  onInspect: (cardId: string) => void;
}) {
  if (cards.length === 0) {
    return <p className="playtest-zone-empty">No cards in {zoneNoun(zone)}.</p>;
  }
  return (
    <ul className="playtest-zone-grid" aria-label={zoneNoun(zone)}>
      {cards.map((c) => (
        <ZoneTile
          key={c.id}
          card={c}
          tax={commanderTax ? commanderTaxAmount(commanderTax, c.id) : 0}
          onInspect={onInspect}
        />
      ))}
    </ul>
  );
}

function zoneNoun(zone: BoardZone): string {
  return zone === 'command' ? 'the command zone' : zone;
}

function ZoneTile({
  card,
  tax,
  onInspect,
}: {
  card: ProjectedCard;
  tax: number;
  onInspect: (cardId: string) => void;
}) {
  const art = useCardThumb(card.name, 'normal');
  return (
    <li className="playtest-zone-card">
      <button
        type="button"
        className="opponent-board-zone-trigger"
        onClick={() => onInspect(card.id)}
        aria-label={`Inspect ${card.name ?? 'card'}`}
      >
        {art ? (
          <img src={art} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="playtest-zone-card__placeholder">{card.name}</div>
        )}
        {tax > 0 && (
          <span className="opponent-board-zone-tax" aria-hidden>
            Tax +{tax}
          </span>
        )}
      </button>
      <div className="playtest-zone-card__name">{card.name}</div>
    </li>
  );
}
