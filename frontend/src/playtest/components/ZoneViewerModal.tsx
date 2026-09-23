import { useMemo, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useMediaQuery } from '@/lib/use-media-query';
import { normalizeForSearch } from '@/lib/normalize-search';
import { SearchPill } from '@/components/SearchPill';
import { CardPreview } from '@/components/CardPreview';
import { OverflowMenu } from '@/components/OverflowMenu';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS, ZONE_VIEWER_LABEL, commanderTaxAmount } from '../lib/zones';

interface Props {
  zone: Zone;
  cards: PlaytestCard[];
  /** Current commander tax by card id — only meaningful for the command
   *  zone. Optional so existing callers/tests that never open the command
   *  zone don't have to pass it. */
  commanderTax?: Record<string, number>;
  onClose(): void;
  onMove(cardId: string, to: Zone | 'battlefield', toIndex?: number): void;
  onShuffleAfter?(): void;
  /** Elixir of Immortality / Feldon's Cane: shuffle every card here into the
   *  library and close. Only offered for graveyard/exile. */
  onShuffleIntoLibrary?(): void;
  /** Ids in this zone the rest of the table cannot see — exile's face-down
   *  cards. Only ever populated for exile; see `PlaytestState.faceDownExile`. */
  hiddenIds?: Set<string>;
  /** Lookup for the full ScryfallCard behind each PlaytestCard — powers the
   *  tap-to-preview wiring (B6-07), same lookup `PlaytestBoard` already
   *  builds for `OpeningHandSheet`. */
  cardLookup?: Map<string, ScryfallCard>;
}

interface ViewerDestination {
  key: Zone | 'battlefield';
  label: string;
  toIndex?: number;
}

// ZoneViewerModal's destination list extends the shared MOVE_DESTINATIONS with
// 'battlefield' (between 'hand' and 'graveyard'), since cards in a zone can be
// played directly onto the battlefield.
const DESTINATIONS: ViewerDestination[] = [
  MOVE_DESTINATIONS[0], // hand
  { key: 'battlefield', label: 'Battlefield' },
  ...MOVE_DESTINATIONS.slice(1), // graveyard, exile, library (top/bottom), command
];

/** The one contextual "just do the obvious thing" action per source zone —
 *  everything else lives in the tile's overflow menu. */
function primaryDestination(zone: Zone): ViewerDestination {
  return zone === 'command'
    ? { key: 'battlefield', label: 'Cast' }
    : { key: 'hand', label: 'To hand' };
}

const EMPTY_TEXT: Record<Zone, string> = {
  library: 'Your library is empty.',
  hand: 'Your hand is empty.',
  graveyard: 'Your graveyard is empty.',
  exile: 'Nothing in exile.',
  command: 'Command zone is empty.',
  sideboard: 'Your sideboard is empty.',
};

/** Order-of-the-pile hint shown under the title — null zones render nothing
 *  (command has no meaningful "order"). */
const ORDER_HINT: Record<Zone, string | null> = {
  library: 'Top of your library first.',
  hand: null,
  graveyard: 'Most recent on top.',
  exile: 'Most recent on top.',
  command: null,
  sideboard: null,
};

/** Reducer APPENDS to graveyard/exile, so the last entry is the most
 *  recently-arrived (physically "on top" of the pile) — reverse those two so
 *  the grid reads top-first, same as the library array already does. */
function isReversedZone(zone: Zone): boolean {
  return zone === 'graveyard' || zone === 'exile';
}

export function ZoneViewerModal({
  zone,
  cards,
  commanderTax = {},
  onClose,
  onMove,
  onShuffleAfter,
  onShuffleIntoLibrary,
  hiddenIds,
  cardLookup,
}: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const [filter, setFilter] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // A phone's soft keyboard pops over the grid before the sheet finishes
  // opening — only steal focus on a pointer fine/hover-capable device.
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

  const label = ZONE_VIEWER_LABEL[zone];
  const hint = ORDER_HINT[zone];
  const primary = primaryDestination(zone);
  const overflow = DESTINATIONS.filter(
    (d) => d.key !== zone && !(d.key === primary.key && d.toIndex === primary.toIndex)
  );

  const filtered = useMemo(() => {
    const nq = normalizeForSearch(filter);
    if (!nq) return cards;
    return cards.filter((c) => normalizeForSearch(c.name).includes(nq));
  }, [cards, filter]);

  // Display order: top-of-pile first. This is also the order CardPreview's
  // carousel steps through, so "next" in the preview matches "next" in the
  // grid for graveyard/exile too.
  const ordered = useMemo(
    () => (isReversedZone(zone) ? [...filtered].reverse() : filtered),
    [filtered, zone]
  );
  const isFiltering = filter.trim() !== '';

  // B6-07: same projection OpeningHandSheet builds for CardPreview — only
  // cards with a resolvable ScryfallCard can be previewed, so `previewIndex`
  // indexes into this filtered/ordered array, not `cards` directly.
  const previewable = useMemo(() => {
    if (!cardLookup) return [];
    const out: { cardId: string; enriched: ReturnType<typeof scryfallToEnrichedCard> }[] = [];
    for (const c of ordered) {
      const scry = cardLookup.get(c.id);
      if (scry) out.push({ cardId: c.id, enriched: scryfallToEnrichedCard(scry) });
    }
    return out;
  }, [ordered, cardLookup]);
  const previewCards = useMemo(() => previewable.map((p) => p.enriched), [previewable]);
  const previewLabels = useMemo(() => previewable.map(() => zone), [previewable, zone]);
  const previewPages = useMemo(() => previewable.map(() => 1), [previewable]);

  function openPreview(cardId: string) {
    const idx = previewable.findIndex((p) => p.cardId === cardId);
    if (idx >= 0) setPreviewIndex(idx);
  }

  return (
    <div className="card-picker-root">
      {/* The backdrop fully covers the root (both `inset: 0`), so it — not
          root — is what a "click outside the sheet" actually lands on. */}
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet playtest-zone-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} viewer`}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title playtest-zone-title-row">
            {label}
            <span className="playtest-zone-count">· {cards.length}</span>
          </h2>
          {hint && <p className="playtest-zone-hint">{hint}</p>}
          <SearchPill
            value={filter}
            onChange={setFilter}
            placeholder={`Search ${label.toLowerCase()}…`}
            ariaLabel={`Search ${label}`}
            autoFocus={finePointer}
          />
          {isFiltering && (
            <p className="playtest-zone-match-count" aria-live="polite">
              {ordered.length} of {cards.length} match
            </p>
          )}
        </div>
        {cards.length === 0 ? (
          <p className="playtest-zone-empty">{EMPTY_TEXT[zone]}</p>
        ) : ordered.length === 0 ? (
          <div className="playtest-zone-empty playtest-zone-no-match">
            <p>No cards match “{filter}”.</p>
            {/* Distinct aria-label from the SearchPill's own inline × (also
                "Clear search"), which sits right above this and does the same
                thing — two same-named controls in one view would be
                indistinguishable to a screen reader. */}
            <button
              type="button"
              className="btn"
              aria-label="Clear search filter"
              onClick={() => setFilter('')}
            >
              Clear search
            </button>
          </div>
        ) : (
          <ul className="playtest-zone-grid">
            {ordered.map((c, i) => (
              <ZoneCard
                key={c.id}
                card={c}
                zone={zone}
                isTop={!isFiltering && i === 0 && Boolean(hint)}
                isHidden={hiddenIds?.has(c.id) ?? false}
                tax={zone === 'command' ? commanderTaxAmount(commanderTax, c.id) : 0}
                primary={primary}
                overflow={overflow}
                onMove={onMove}
                onPreview={cardLookup?.has(c.id) ? openPreview : undefined}
              />
            ))}
          </ul>
        )}
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Done
          </button>
          {zone === 'library' && onShuffleAfter && (
            <button type="button" className="btn btn-primary" onClick={onShuffleAfter}>
              Shuffle and close
            </button>
          )}
          {(zone === 'graveyard' || zone === 'exile') && onShuffleIntoLibrary && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={cards.length === 0}
              onClick={onShuffleIntoLibrary}
            >
              Shuffle into library
            </button>
          )}
        </div>
      </div>

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="playtest"
          cards={previewCards}
          index={previewIndex}
          binderName={label}
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

interface ZoneCardProps {
  card: PlaytestCard;
  zone: Zone;
  /** Renders the "Top" badge over the card face. */
  isTop: boolean;
  /** This card is in exile face down — you can read it, the table cannot. */
  isHidden: boolean;
  /** Commander tax (already ×2) — 0 outside the command zone. */
  tax: number;
  primary: ViewerDestination;
  overflow: ViewerDestination[];
  onMove(cardId: string, to: Zone | 'battlefield', toIndex?: number): void;
  /** B6-07: tap the card face to open `CardPreview`. Omitted (no button,
   *  plain image) when this card has no resolvable ScryfallCard. */
  onPreview?(cardId: string): void;
}

/**
 * One grid tile. Split out (rather than inlined in the `.map`) so each
 * card's broken-image fallback is local state on its own instance — and so
 * `content-visibility: auto` (set in CSS on `.playtest-zone-card`) can skip
 * layout/paint for the ~90-card case entirely off-screen without a
 * virtualization library.
 */
function ZoneCard({
  card: c,
  zone,
  isTop,
  isHidden,
  tax,
  primary,
  overflow,
  onMove,
  onPreview,
}: ZoneCardProps) {
  const [imgError, setImgError] = useState(false);
  const face =
    c.imageUrl && !imgError ? (
      <img
        src={c.imageUrl}
        alt={c.name}
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={() => setImgError(true)}
      />
    ) : (
      <div className="playtest-zone-card__placeholder">{c.name}</div>
    );
  const primaryLabel = zone === 'command' && tax > 0 ? `${primary.label} (+${tax})` : primary.label;
  return (
    <li className="playtest-zone-card">
      {isTop && (
        <span className="playtest-zone-card__badge" aria-hidden>
          Top
        </span>
      )}
      {/* Your own face-down exile: shown to you (you know what you put
          there) with a badge saying the table does not see it. */}
      {isHidden && <span className="playtest-zone-card__badge">Face down</span>}
      {onPreview ? (
        <button
          type="button"
          className="playtest-zone-card__preview"
          onClick={() => onPreview(c.id)}
          aria-label={`${c.name}: preview`}
        >
          {face}
        </button>
      ) : (
        face
      )}
      <div className="playtest-zone-card__name">{c.name}</div>
      {zone === 'command' && tax > 0 && <div className="playtest-zone-card__tax">Tax +{tax}</div>}
      <div className="playtest-zone-card__actions">
        <button
          type="button"
          className="playtest-zone-card__primary"
          onClick={() => onMove(c.id, primary.key, primary.toIndex)}
        >
          {primaryLabel}
        </button>
        <OverflowMenu
          items={overflow.map((d) => ({
            label: d.label,
            onClick: () => onMove(c.id, d.key, d.toIndex),
          }))}
          ariaLabel={`Move ${c.name}`}
          triggerClassName="playtest-zone-card__overflow"
          panelClassName="playtest-zone-menu-popover"
        />
      </div>
    </li>
  );
}
