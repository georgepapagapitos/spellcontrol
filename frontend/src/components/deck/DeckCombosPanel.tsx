import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Sparkles } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { useCollapsedPref } from '../../lib/use-collapsed-pref';
import { buildCardImageIndex, buildCardIndex } from '../../lib/deck-card-index';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../../lib/allocations';
import { useDeckCombos } from '../../lib/use-deck-combos';
import { comboPayoffScore } from '../../lib/combo-payoff';
import {
  comboNameKey,
  useEdhrecComboOverlay,
  type EdhrecComboStat,
} from '../../lib/edhrec-combo-overlay';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import type { EnrichedCard } from '../../types';
import type { ComboMatch, ComboCardRef } from '../../types/combos';
import { CardPreview } from '../CardPreview';
import { Tabs } from '../Tabs';
import { ComboRow } from './ComboRow';

export interface DeckCombosPanelHandle {
  /** Expand the panel (if collapsed), optionally switch to `tab`, scroll it into
   *  view, and focus the first tab. */
  reveal(tab?: Tab): void;
}

interface Props {
  deckId: string;
  /**
   * Oracle ids of every card in the deck (commander + main + side). Pre-computed
   * by the parent so the panel doesn't have to know about deck shape.
   */
  deckOracleIds: string[];
  /** Format used to filter combos by legality (e.g. "commander"). */
  format?: string;
  /** Deck color identity — hides one-away combos whose missing piece could
   *  never legally join the deck (see useDeckCombos). Omit = no restriction. */
  colorIdentity?: readonly string[];
  onAdd: (card: ScryfallCard, allocatedCopyId: string | null) => void;
  /**
   * Render without the collapsible header chrome (always-open body), for use
   * inside the tabbed analysis surface.
   */
  embedded?: boolean;
}

type Tab = 'inDeck' | 'oneAway';
type OwnershipFilter = 'all' | 'owned' | 'notOwned';

export const DeckCombosPanel = forwardRef<DeckCombosPanelHandle, Props>(function DeckCombosPanel(
  { deckId: _deckId, deckOracleIds, format, colorIdentity, onAdd, embedded = false },
  ref
) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);

  const ownedOracleIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collection) if (c.oracleId) ids.add(c.oracleId);
    return ids;
  }, [collection]);

  const ownedOracleIds = useMemo(() => Array.from(ownedOracleIdSet), [ownedOracleIdSet]);

  const deck = useDecksStore((s) => s.decks.find((d) => d.id === _deckId) ?? null);

  const cardImageIndex = useMemo(() => buildCardImageIndex(collection, deck), [collection, deck]);

  const cardIndex = useMemo(() => buildCardIndex(collection, deck), [collection, deck]);

  // ── Combo card preview state ────────────────────────────────────────────
  const [previewCards, setPreviewCards] = useState<EnrichedCard[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewComboTitle, setPreviewComboTitle] = useState('');

  const resolveComboCard = useCallback(
    (ref: ComboCardRef): EnrichedCard | null =>
      cardIndex.byOracle.get(ref.oracleId) ??
      cardIndex.byName.get(ref.cardName.toLowerCase()) ??
      null,
    [cardIndex]
  );

  const openComboPreview = useCallback(
    async (combo: ComboCardRef[], tappedIndex: number) => {
      // Try local resolution first; fall back to Scryfall fetch for any gaps.
      const resolved: EnrichedCard[] = [];
      for (const ref of combo) {
        let card = resolveComboCard(ref);
        if (!card) {
          try {
            const scryfall = await getCardByName(ref.cardName);
            if (scryfall) card = scryfallToEnrichedCard(scryfall);
          } catch {
            /* leave null — skip this card in the carousel */
          }
        }
        if (card) resolved.push(card);
      }
      if (resolved.length === 0) return;
      // Clamp the tapped index in case a card couldn't be resolved.
      setPreviewCards(resolved);
      setPreviewIndex(Math.min(tappedIndex, resolved.length - 1));
      setPreviewComboTitle(combo.map((c) => c.cardName).join(' + '));
    },
    [resolveComboCard]
  );

  const [tab, setTab] = useState<Tab>('inDeck');
  // Default to collapsed: the panel is opt-in discovery — most deck-page loads
  // don't need the full combo list, and the always-visible header summary
  // already shows the at-a-glance counts.
  const [collapsed, setCollapsed] = useCollapsedPref('spellcontrol-combos-panel-collapsed');
  // Embedded in a tab: no header chrome, body always open.
  const isCollapsed = embedded ? false : collapsed;
  const [announce, setAnnounce] = useState('');
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, loading, error } = useDeckCombos({
    deckOracleIds,
    ownedOracleIds,
    format,
    colorIdentity,
    // Fetch even when the panel is collapsed so the header summary
    // ("11 in deck · 2 one away") is accurate at a glance. The hook caches
    // results and debounces requests, so the cost on idle deck-views is
    // small and the at-a-glance value is high.
  });

  useImperativeHandle(ref, () => ({
    reveal: (revealTab) => {
      setCollapsed(false);
      if (revealTab) setTab(revealTab);
      // Wait a frame so the panel has expanded before scrolling/focusing.
      window.requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        firstButtonRef.current?.focus();
      });
    },
  }));

  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all');

  const inDeckCount = data?.inDeck.length ?? 0;
  const oneAwayCount = data?.oneAway.length ?? 0;

  // Split one-away combos by ownership for filter counts + filtering.
  const oneAwayOwned = useMemo(
    () =>
      (data?.oneAway ?? []).filter((m) => {
        const missingId = m.missingOracleIds[0];
        return missingId && ownedOracleIdSet.has(missingId);
      }),
    [data?.oneAway, ownedOracleIdSet]
  );
  const oneAwayNotOwned = useMemo(
    () =>
      (data?.oneAway ?? []).filter((m) => {
        const missingId = m.missingOracleIds[0];
        return missingId && !ownedOracleIdSet.has(missingId);
      }),
    [data?.oneAway, ownedOracleIdSet]
  );

  const filteredOneAway = useMemo(
    () =>
      ownershipFilter === 'owned'
        ? oneAwayOwned
        : ownershipFilter === 'notOwned'
          ? oneAwayNotOwned
          : (data?.oneAway ?? []),
    [ownershipFilter, oneAwayOwned, oneAwayNotOwned, data?.oneAway]
  );

  // EDHREC per-commander combo stats, overlaid by card-name-set onto the
  // Spellbook matches (E63). Empty for non-commander decks / offline, so the
  // panel falls back to the backend's global popularity ordering untouched.
  const edhrecOverlay = useEdhrecComboOverlay(deck?.commander?.name ?? null);
  const statFor = useCallback(
    (m: ComboMatch): EdhrecComboStat | null =>
      edhrecOverlay.get(comboNameKey(m.combo.cards.map((c) => c.cardName))) ?? null,
    [edhrecOverlay]
  );

  const unsortedMatches = useMemo(
    () => (tab === 'inDeck' ? (data?.inDeck ?? []) : filteredOneAway),
    [tab, data?.inDeck, filteredOneAway]
  );
  // Float combos EDHREC lists for this commander to the top (by EDHREC rank),
  // keeping the rest in their existing order below. For the one-away tab,
  // "existing order" is payoff quality (E83 — a wincon beats a value combo
  // regardless of raw play-count) with popularity as the final tie-break;
  // the in-deck tab keeps plain popularity since every row there already
  // fires, so ranking by payoff wouldn't change what's actionable.
  const matches = useMemo(() => {
    return [...unsortedMatches].sort((a, b) => {
      const as = statFor(a);
      const bs = statFor(b);
      if (as && bs) return as.rank - bs.rank;
      if (as) return -1;
      if (bs) return 1;
      if (tab === 'oneAway') {
        const payoffDiff = comboPayoffScore(b.combo.produces) - comboPayoffScore(a.combo.produces);
        if (payoffDiff !== 0) return payoffDiff;
      }
      return b.combo.popularity - a.combo.popularity;
    });
  }, [unsortedMatches, statFor, tab]);

  // Did this deck contribute *any* oracle ids at all? If a deck was imported
  // before EnrichedCard.oracleId existed and the backfill hasn't reached it
  // yet, the buckets will be misleadingly empty. Distinct from "deck has zero
  // combos" — handled by a different empty-state message below.
  const deckHasOracleIds = deckOracleIds.length > 0;
  const deckEntered = (data?.inDeck.length ?? 0) + (data?.oneAway.length ?? 0) === 0 && !loading;

  const handleAddMissing = async (match: ComboMatch) => {
    const oracleId = match.missingOracleIds[0];
    if (!oracleId) return;
    const card = match.combo.cards.find((c) => c.oracleId === oracleId);
    if (!card) return;
    let resolved: ScryfallCard | null = null;
    try {
      resolved = await getCardByName(card.cardName);
    } catch {
      resolved = null;
    }
    if (!resolved) {
      setAnnounce(`Couldn't find a printing for ${card.cardName}.`);
      return;
    }
    const claim = pickCollectionCopy(card.cardName, collection, allocations, resolved.id);
    onAdd(resolved, claim?.copyId ?? null);
    setAnnounce(`Added ${card.cardName} to complete combo.`);
  };

  return (
    <div
      ref={containerRef}
      className={`deck-combos-panel${isCollapsed ? ' is-collapsed' : ''}${embedded ? ' is-embedded' : ''}`}
      role="region"
      aria-label="Combos"
    >
      {!embedded && (
        <button
          type="button"
          className="deck-combos-header"
          aria-expanded={!collapsed}
          aria-controls="deck-combos-body"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand combos panel' : 'Collapse combos panel'}
        >
          <Sparkles width={16} height={16} aria-hidden />
          <span className="deck-combos-title">Combos</span>
          {/* Compact summary always visible so the collapsed strip is informative. */}
          <span className="deck-combos-header-summary" aria-hidden>
            {inDeckCount > 0 && <span>{inDeckCount} in deck</span>}
            {oneAwayCount > 0 && <span>{oneAwayCount} one away</span>}
            {inDeckCount === 0 && oneAwayCount === 0 && !loading && (
              <span className="deck-combos-header-empty">No matches</span>
            )}
          </span>
          {/* Spinner slot is ALWAYS rendered (just visibility-hidden when
              idle) so the trailing wrapper's width never changes between
              loading + idle states. Without this the summary column would
              shrink by the spinner's width every time a request fired,
              shifting the layout. */}
          <span className="deck-combos-header-trailing" aria-hidden>
            <span className={`deck-combos-spinner${loading ? '' : ' is-idle'}`} aria-hidden />
            <span className="deck-combos-header-chevron">
              {collapsed ? (
                <ChevronDown width={16} height={16} />
              ) : (
                <ChevronUp width={16} height={16} />
              )}
            </span>
          </span>
        </button>
      )}

      {!embedded && isCollapsed && (
        <div className="sr-only">Combos panel collapsed — click to expand.</div>
      )}

      <div
        id="deck-combos-body"
        className="deck-combos-body"
        hidden={isCollapsed}
        aria-hidden={isCollapsed}
      >
        <Tabs
          ariaLabel="Combo bucket"
          variant="scrollable"
          value={tab}
          onChange={setTab}
          firstTabRef={firstButtonRef}
          tabs={[
            {
              id: 'inDeck',
              label: 'In deck',
              count: inDeckCount,
              ariaLabel: `In deck, ${inDeckCount} combos`,
            },
            {
              id: 'oneAway',
              label: 'One card away',
              count: oneAwayCount,
              ariaLabel: `One card away, ${oneAwayCount} combos`,
            },
          ]}
        />

        {tab === 'oneAway' && oneAwayCount > 0 && (
          <div
            className="deck-combos-ownership-filter"
            role="group"
            aria-label="Filter by ownership"
          >
            <button
              type="button"
              className={`deck-combos-filter-pill${ownershipFilter === 'all' ? ' active' : ''}`}
              onClick={() => setOwnershipFilter('all')}
            >
              All
              <span className="deck-combos-filter-count">{oneAwayCount}</span>
            </button>
            <button
              type="button"
              className={`deck-combos-filter-pill${ownershipFilter === 'owned' ? ' active' : ''}`}
              onClick={() => setOwnershipFilter('owned')}
            >
              <CheckCircle2
                className="deck-combos-filter-icon deck-combos-filter-icon--owned"
                width={13}
                height={13}
                strokeWidth={2.5}
                aria-hidden
              />
              In my collection
              <span className="deck-combos-filter-count">{oneAwayOwned.length}</span>
            </button>
            <button
              type="button"
              className={`deck-combos-filter-pill${ownershipFilter === 'notOwned' ? ' active' : ''}`}
              onClick={() => setOwnershipFilter('notOwned')}
            >
              <Circle
                className="deck-combos-filter-icon deck-combos-filter-icon--not-owned"
                width={13}
                height={13}
                strokeWidth={2.5}
                aria-hidden
              />
              Need to buy
              <span className="deck-combos-filter-count">{oneAwayNotOwned.length}</span>
            </button>
          </div>
        )}

        {error && <p className="deck-combos-empty deck-combos-error">{error}</p>}

        {!error && matches.length === 0 && !loading && (
          <div className="deck-combos-empty">
            {tab === 'inDeck' ? (
              !deckHasOracleIds ? (
                <p>
                  This deck&rsquo;s cards don&rsquo;t have combo data yet. If you imported it before
                  the combo update, re-import or wait for background sync.
                </p>
              ) : (
                <>
                  <p>No complete combos in this deck.</p>
                  {deckEntered && oneAwayCount > 0 && (
                    <p className="deck-combos-empty-secondary">
                      {oneAwayCount === 1
                        ? '1 combo is one card away — check the next tab.'
                        : `${oneAwayCount} combos are one card away — check the next tab.`}
                    </p>
                  )}
                  {deckEntered && oneAwayCount === 0 && (
                    <p className="deck-combos-empty-secondary">
                      Spellbook curates a few thousand documented combos — many casual decks
                      (precons especially) genuinely have none.
                    </p>
                  )}
                </>
              )
            ) : ownedOracleIds.length === 0 ? (
              <p>Import cards to your collection to surface near-miss combos.</p>
            ) : (
              <p>No combos one card away — try expanding your collection.</p>
            )}
          </div>
        )}

        {!error && matches.length > 0 && (
          <ul className="deck-combos-list" role="list">
            {matches.map((match) => (
              <ComboRow
                key={match.combo.id}
                match={match}
                isOneAway={tab === 'oneAway'}
                edhrec={statFor(match)}
                cardImageIndex={cardImageIndex}
                ownedOracleIds={ownedOracleIdSet}
                onAddMissing={() => void handleAddMissing(match)}
                onCardTap={(cardIndex) => void openComboPreview(match.combo.cards, cardIndex)}
              />
            ))}
          </ul>
        )}

        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>
      </div>

      {previewCards && previewCards.length > 0 && (
        <CardPreview
          source="suggestion"
          showRole
          cards={previewCards}
          index={previewIndex}
          binderName={previewComboTitle}
          sectionLabels={previewCards.map(() => 'Combo')}
          pageNumbers={previewCards.map(() => 0)}
          totalPages={1}
          currentDeckId={_deckId}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewCards(null)}
        />
      )}
    </div>
  );
});
