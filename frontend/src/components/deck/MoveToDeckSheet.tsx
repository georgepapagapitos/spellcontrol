import { createPortal } from 'react-dom';
import { type JSX, useId, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import './MoveToDeckSheet.css';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';
import { useStoredSort } from '@/lib/util/use-stored-sort';
import { ColorPip } from '../shared/ManaSymbol';
import { effectiveDeckColors } from '@/lib/deck/deck-validation';
import { deckCoverArt } from '@/lib/deck/deck-cover';
import {
  DECK_SORT_DEFAULT_DIR,
  DECK_SORT_OPTIONS,
  deckCardTotal,
  sortDecks,
  type DeckSortField,
} from '@/lib/deck/deck-sort';
import { useDecksStore, type Deck } from '@/store/decks';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckFormat, ScryfallCard } from '@/deck-builder/types';
import { DonorOutcomeInline } from './DonorOutcomeInline';
import type { DonorOutcome } from '@/lib/collection/allocations';
import type { ChangeOwnership } from '@/lib/coach/deck-change';
import type { EnrichedCard } from '@/types';
import { Button, IconButton } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { SearchPill } from '@/components/search/SearchPill';
import { SortMenu } from '@/components/search/SortMenu';

// Value needs every deck's prices resolved, which this sheet doesn't load.
const SORT_OPTIONS = DECK_SORT_OPTIONS.filter((o) => o.value !== 'value');

/** Copies of `name` a deck already holds, commanders included. */
function copiesIn(deck: Deck, name: string): number {
  let n = 0;
  if (deck.commander?.name === name) n++;
  if (deck.partnerCommander?.name === name) n++;
  for (const c of deck.cards) if (c.card.name === name) n++;
  return n;
}

export interface MoveToDeckSheetProps {
  /** The card being moved out of the current (donor) deck. */
  card: ScryfallCard;
  /** The deck the card is leaving — the donor for the outcome chooser. */
  currentDeck: Deck;
  collectionCards: EnrichedCard[];
  ownershipFor: (name: string) => ChangeOwnership;
  freeCountFor: (name: string) => number;
  onConfirm: (
    targetDeckId: string,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ) => void;
  onCancel: () => void;
}

/**
 * Surface 2 of the physical-copy reallocation feature: move an owned card from
 * the current deck into another deck. Two phases — pick the destination deck,
 * then choose what happens to THIS deck (the donor): leave a gap / replace /
 * remove. Nothing moves until the final confirm.
 *
 * Uses the shared `card-picker` sheet shell (bottom sheet on mobile, centered
 * modal ≥1024px) with its header / list / footer chrome, so the deck list is
 * the one scroll region. The list searches, sorts and filters by format the
 * way the decks index does (same sort fields and wording, `lib/deck/deck-sort`):
 * a long deck list was a wall of identical tiles you could only scroll.
 */
export function MoveToDeckSheet({
  card,
  currentDeck,
  collectionCards,
  ownershipFor,
  freeCountFor,
  onConfirm,
  onCancel,
}: MoveToDeckSheetProps): JSX.Element {
  const titleId = useId();
  const decks = useDecksStore((s) => s.decks);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DonorOutcome>('leave-gap');
  const [replacement, setReplacement] = useState<{ name: string; card: ScryfallCard } | null>(null);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<DeckFormat | null>(null);
  const { sortField, sortDir, toggleSort } = useStoredSort<DeckSortField>(
    'move-to-deck-sort',
    DECK_SORT_DEFAULT_DIR,
    'edited'
  );

  useLockBodyScroll();

  // Below 1024px this is a bottom sheet with a slide-up entry, so the
  // dismiss paths (backdrop, Escape, ✕) play the symmetric
  // `binder-sheet-slide-out` before unmount. On desktop it's a centered
  // panel with `animation: none` — exits stay instant there. The confirm
  // action is a parent-owned callback (it acts, then the parent unmounts
  // the sheet), so it isn't routed through the hook.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    onCancel,
    'binder-sheet-slide-out',
    { instantAt: '(min-width: 1024px)' }
  );

  const others = useMemo(
    () => decks.filter((d) => d.id !== currentDeck.id),
    [decks, currentDeck.id]
  );
  const target = targetId ? (others.find((d) => d.id === targetId) ?? null) : null;

  // Format chips only appear when there's more than one format to tell apart,
  // most-used format first.
  const formats = useMemo(() => {
    const counts = new Map<DeckFormat, number>();
    for (const d of others) counts.set(d.format, (counts.get(d.format) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [others]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = others.filter((d) => {
      if (formatFilter && d.format !== formatFilter) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.commander?.name ?? '').toLowerCase().includes(q) ||
        (d.partnerCommander?.name ?? '').toLowerCase().includes(q)
      );
    });
    return sortDecks(filtered, sortField, sortDir);
  }, [others, query, formatFilter, sortField, sortDir]);

  const handleSelect = (next: DonorOutcome) => {
    setOutcome(next);
    if (next !== 'replace') setReplacement(null);
  };

  const confirmDisabled = outcome === 'replace' && !replacement;
  const filtering = query.trim() !== '' || formatFilter !== null;
  // A long list holds its height while you search it, so the sheet doesn't
  // collapse and jump with every keystroke that narrows it.
  const browsing = !target && others.length > 5;

  return createPortal(
    <div
      className="card-picker-root move-deck-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) beginClose();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet move-deck-sheet${browsing ? ' is-browsing' : ''}${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="card-picker-header move-deck-header">
          <div className="move-deck-head">
            {target && (
              <IconButton
                variant="quiet"
                onClick={() => {
                  setTargetId(null);
                  setReplacement(null);
                  setOutcome('leave-gap');
                }}
                label="Back to deck list"
                icon={<ChevronLeft width={18} height={18} strokeWidth={2} />}
              />
            )}
            <div className="text-stack">
              <h2 id={titleId} className="move-deck-title">
                {target ? `Move to ${target.name}?` : 'Move to another deck'}
              </h2>
              <p className="move-deck-sub">
                Moving <strong>{card.name}</strong>
                {target ? null : ' out of this deck'}
              </p>
            </div>
            <IconButton
              variant="quiet"
              className="move-deck-close"
              onClick={() => beginClose()}
              label="Cancel"
              icon={<X width={18} height={18} strokeWidth={2} />}
            />
          </div>

          {!target && others.length > 1 && (
            <>
              <div className="move-deck-toolbar">
                <SearchPill
                  value={query}
                  onChange={setQuery}
                  placeholder="Search decks"
                  ariaLabel="Search decks by name or commander"
                  className="move-deck-search"
                />
                <SortMenu<DeckSortField>
                  value={sortField}
                  dir={sortDir}
                  options={SORT_OPTIONS}
                  onChange={toggleSort}
                  ariaLabel="Sort decks"
                />
              </div>
              {formats.length > 1 && (
                <div className="move-deck-formats" role="group" aria-label="Filter by format">
                  <Chip
                    className="filter-chip"
                    pressed={formatFilter === null}
                    onClick={() => setFormatFilter(null)}
                  >
                    All
                  </Chip>
                  {formats.map((f) => (
                    <Chip
                      key={f}
                      className="filter-chip"
                      pressed={formatFilter === f}
                      onClick={() => setFormatFilter(formatFilter === f ? null : f)}
                    >
                      {DECK_FORMAT_CONFIGS[f]?.label ?? f}
                    </Chip>
                  ))}
                </div>
              )}
            </>
          )}
        </header>

        {!target ? (
          others.length === 0 ? (
            <div className="card-picker-empty">You have no other decks to move this into.</div>
          ) : shown.length === 0 ? (
            <div className="card-picker-empty move-deck-no-match">
              <p>No deck matches that.</p>
              {filtering && (
                <Button
                  variant="link"
                  onClick={() => {
                    setQuery('');
                    setFormatFilter(null);
                  }}
                >
                  Clear search and filters
                </Button>
              )}
            </div>
          ) : (
            <ul className="card-picker-list move-deck-list" role="list">
              {shown.map((d) => {
                const art = deckCoverArt(d);
                const colors = Array.from(effectiveDeckColors(d));
                const total = deckCardTotal(d);
                const held = copiesIn(d, card.name);
                const lead = d.commander?.name ?? DECK_FORMAT_CONFIGS[d.format]?.label ?? null;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="move-deck-row"
                      style={{ ['--deck-color' as string]: d.color }}
                      onClick={() => setTargetId(d.id)}
                      aria-label={`Move ${card.name} to ${d.name}`}
                    >
                      <span className="move-deck-row-thumb" aria-hidden>
                        {art ? <img src={art} alt="" loading="lazy" /> : null}
                      </span>
                      <span className="move-deck-row-text">
                        <span className="move-deck-row-title">
                          <span className="move-deck-row-name">{d.name}</span>
                          {colors.length > 0 && (
                            <span className="move-deck-row-pips" aria-hidden>
                              {colors.map((c) => (
                                <ColorPip key={c} color={c} />
                              ))}
                            </span>
                          )}
                        </span>
                        <span className="move-deck-row-meta">
                          {lead && <span className="move-deck-row-lead">{lead}</span>}
                          <span className="move-deck-row-count">
                            {total} {total === 1 ? 'card' : 'cards'}
                          </span>
                        </span>
                      </span>
                      {held > 0 && (
                        <Chip className="move-deck-row-held" tone="info">
                          {held === 1 ? 'Has 1' : `Has ${held}`}
                        </Chip>
                      )}
                      <ChevronRight
                        className="move-deck-row-chevron"
                        width={16}
                        height={16}
                        strokeWidth={2}
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <>
            <div className="move-deck-body">
              <DonorOutcomeInline
                donorDeck={currentDeck}
                donorCard={card}
                collectionCards={collectionCards}
                ownershipFor={ownershipFor}
                freeCountFor={freeCountFor}
                canReplaceOrRemove
                selected={outcome}
                onSelect={handleSelect}
                replacement={replacement}
                onSelectReplacement={(name, c) => setReplacement({ name, card: c })}
              />
            </div>
            <div className="card-picker-footer move-deck-actions">
              <Button
                variant="primary"
                onClick={() =>
                  onConfirm(target.id, outcome, outcome === 'replace' ? replacement : null)
                }
                disabled={confirmDisabled}
              >
                Move to {target.name}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
