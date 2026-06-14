import {
  type JSX,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Footprints,
  Infinity as InfinityIcon,
  ListChecks,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { useCardThumb } from '../../lib/card-thumbs';
import { ColorPip } from '../shared/ManaSymbol';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../../lib/allocations';
import { useDeckCombos } from '../../lib/use-deck-combos';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import type { EnrichedCard } from '../../types';
import type { ComboMatch, ComboCardRef } from '../../types/combos';
import { CardPreview } from '../CardPreview';
import { Tabs } from '../Tabs';
import { MagicText } from './MagicText';

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
  onAdd: (card: ScryfallCard, allocatedCopyId: string | null) => void;
  /**
   * Render without the collapsible header chrome (always-open body), for use
   * inside the tabbed analysis surface.
   */
  embedded?: boolean;
}

type Tab = 'inDeck' | 'oneAway';
type OwnershipFilter = 'all' | 'owned' | 'notOwned';

const COLLAPSED_STORAGE_KEY = 'spellcontrol-combos-panel-collapsed';

function readCollapsedPref(): boolean {
  // Default to collapsed when no preference is stored. The panel is opt-in
  // discovery — most deck-page loads don't need to render the full combo
  // list, and the always-visible header summary already shows the at-a-
  // glance counts. Users who toggle it open will see their preference
  // persist via the writeCollapsedPref call.
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

function writeCollapsedPref(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

export const DeckCombosPanel = forwardRef<DeckCombosPanelHandle, Props>(function DeckCombosPanel(
  { deckId: _deckId, deckOracleIds, format, onAdd, embedded = false },
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

  // Cards rendered in the panel come from two sources whose images we can
  // pull for free: the user's collection (EnrichedCard.imageNormal) and the
  // deck's own ScryfallCard payload (image_uris.normal — populated even when
  // no collection copy is allocated to the slot). We index by both oracle id
  // AND lowercased name so cards imported before EnrichedCard.oracleId
  // existed (and therefore lack the oracle id) still resolve via name match.
  // We prefer the `normal` (488×680) variant because cards render at ~120px
  // wide which looks soft using the `small` (146×204) source on retina.
  const cardImageIndex = useMemo(() => {
    const byOracle = new Map<string, string>();
    const byName = new Map<string, string>();
    const remember = (
      oracleId: string | undefined,
      name: string | undefined,
      img: string | undefined
    ) => {
      if (!img) return;
      if (oracleId && !byOracle.has(oracleId)) byOracle.set(oracleId, img);
      if (name) {
        const key = name.toLowerCase();
        if (!byName.has(key)) byName.set(key, img);
      }
    };
    for (const c of collection) remember(c.oracleId, c.name, c.imageNormal ?? c.imageSmall);
    if (deck) {
      const fromScryfall = (
        card: {
          name?: string;
          oracle_id?: string;
          image_uris?: { small?: string; normal?: string };
          card_faces?: Array<{ image_uris?: { small?: string; normal?: string } }>;
        } | null
      ) => {
        if (!card) return;
        const face = card.image_uris ?? card.card_faces?.[0]?.image_uris;
        const url = face?.normal ?? face?.small;
        remember(card.oracle_id, card.name, url);
      };
      fromScryfall(deck.commander);
      fromScryfall(deck.partnerCommander);
      for (const c of deck.cards) fromScryfall(c.card);
      for (const c of deck.sideboard) fromScryfall(c.card);
    }
    return { byOracle, byName };
  }, [collection, deck]);

  // Index that resolves combo card refs to full EnrichedCard objects for the
  // carousel preview. Priority: collection copy (richest metadata — shows
  // ownership, price, foil status) → deck ScryfallCard → null (will fetch
  // on demand from Scryfall API when the thumbnail is tapped).
  const cardIndex = useMemo(() => {
    const byOracle = new Map<string, EnrichedCard>();
    const byName = new Map<string, EnrichedCard>();
    // Collection cards are already EnrichedCard — best source.
    for (const c of collection) {
      if (c.oracleId && !byOracle.has(c.oracleId)) byOracle.set(c.oracleId, c);
      if (c.name) {
        const key = c.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, c);
      }
    }
    // Deck's Scryfall payloads converted to EnrichedCard as fallback.
    if (deck) {
      const indexScryfall = (card: ScryfallCard | null) => {
        if (!card) return;
        const oid = card.oracle_id;
        const name = card.name;
        if (oid && byOracle.has(oid)) return;
        if (name && byName.has(name.toLowerCase())) return;
        const enriched = scryfallToEnrichedCard(card);
        if (oid) byOracle.set(oid, enriched);
        if (name) byName.set(name.toLowerCase(), enriched);
      };
      indexScryfall(deck.commander);
      indexScryfall(deck.partnerCommander);
      for (const c of deck.cards) indexScryfall(c.card);
      for (const c of deck.sideboard) indexScryfall(c.card);
    }
    return { byOracle, byName };
  }, [collection, deck]);

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
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPref());
  // Embedded in a tab: no header chrome, body always open.
  const isCollapsed = embedded ? false : collapsed;
  const [announce, setAnnounce] = useState('');
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, loading, error } = useDeckCombos({
    deckOracleIds,
    ownedOracleIds,
    format,
    // Fetch even when the panel is collapsed so the header summary
    // ("11 in deck · 2 one away") is accurate at a glance. The hook caches
    // results and debounces requests, so the cost on idle deck-views is
    // small and the at-a-glance value is high.
  });

  useEffect(() => {
    writeCollapsedPref(collapsed);
  }, [collapsed]);

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

  const filteredOneAway =
    ownershipFilter === 'owned'
      ? oneAwayOwned
      : ownershipFilter === 'notOwned'
        ? oneAwayNotOwned
        : (data?.oneAway ?? []);

  const matches = tab === 'inDeck' ? (data?.inDeck ?? []) : filteredOneAway;

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
      setAnnounce(`Could not find a printing for ${card.cardName}.`);
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
              Owned
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
              Not owned
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
                tab={tab}
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

interface CardImageIndex {
  byOracle: Map<string, string>;
  byName: Map<string, string>;
}

/** A locally-cached combo-card image (collection/deck), if we already have one.
 *  Anything not cached resolves its CDN art by name in {@link ComboCardArt} —
 *  never a bare img against the rate-limited API host. */
function resolveComboCardImage(
  oracleId: string,
  cardName: string,
  index: CardImageIndex
): string | undefined {
  return index.byOracle.get(oracleId) ?? index.byName.get(cardName.toLowerCase());
}

/** Combo-card art: a local cache hit, else the CDN image resolved by name
 *  (cached + batched), else a placeholder while it loads / on a miss. */
function ComboCardArt({
  localUrl,
  cardName,
}: {
  localUrl: string | undefined;
  cardName: string;
}): JSX.Element {
  const resolved = useCardThumb(localUrl ? undefined : cardName);
  const url = localUrl ?? resolved;
  return url ? (
    <img src={url} alt={cardName} loading="lazy" decoding="async" />
  ) : (
    <span className="deck-combos-card-art-fallback" aria-hidden />
  );
}

interface ComboRowProps {
  match: ComboMatch;
  tab: Tab;
  cardImageIndex: CardImageIndex;
  /** Oracle IDs of cards the user owns in their collection. */
  ownedOracleIds: Set<string>;
  onAddMissing: () => void;
  /** Called when a card thumbnail is tapped. Index is position within the combo's cards array. */
  onCardTap: (cardIndex: number) => void;
}

function ComboRow({
  match,
  tab,
  cardImageIndex,
  ownedOracleIds,
  onAddMissing,
  onCardTap,
}: ComboRowProps) {
  const { combo } = match;
  const missingOracleId = match.missingOracleIds[0] ?? null;
  const missingCardName = missingOracleId
    ? combo.cards.find((c) => c.oracleId === missingOracleId)?.cardName
    : null;

  const steps = useMemo(() => splitSteps(combo.description), [combo.description]);
  // One unified collapsible covering Prerequisites + Steps + Results so the
  // user toggles all three together. Closed by default — the always-visible
  // header (cards, popularity, produces summary) is enough at-a-glance.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails =
    !!combo.prerequisites?.easy ||
    !!combo.prerequisites?.notable ||
    !!combo.manaNeeded ||
    steps.length > 0 ||
    combo.produces.length > 0;

  // Combo title — full card names joined. Truncated via CSS so long combos
  // don't overflow the card; the full string is exposed via title for hover.
  const comboTitle = combo.cards.map((c) => c.cardName).join(' + ');

  return (
    <li className="deck-combos-row expanded">
      <header className="deck-combos-row-header">
        <span
          className={`deck-combos-row-status ${tab === 'oneAway' ? 'is-near-miss' : 'is-complete'}`}
          aria-hidden
        >
          {tab === 'oneAway' ? (
            <AlertTriangle width={14} height={14} />
          ) : (
            <CheckCircle2 width={14} height={14} />
          )}
        </span>
        <ColorIdentityPips identity={combo.identity} />
        <span className="deck-combos-row-title card-name-chip-text" title={comboTitle}>
          {comboTitle}
        </span>
      </header>
      <p className="deck-combos-row-meta">
        {formatDeckCount(combo.popularity)}
        {combo.bracket != null ? <> · Bracket {combo.bracket}</> : <> · Bracket unknown</>}
      </p>

      <ul className="deck-combos-card-grid" role="list">
        {combo.cards.map((c, i) => {
          const isMissing = c.oracleId === missingOracleId;
          const isOwned = isMissing && ownedOracleIds.has(c.oracleId);
          const tileClass = isMissing ? (isOwned ? ' missing owned' : ' missing') : '';
          const localUrl = resolveComboCardImage(c.oracleId, c.cardName, cardImageIndex);
          return (
            <li key={c.oracleId} className={`deck-combos-card-tile${tileClass}`}>
              {/* Plus separator between cards. Visual rather than semantic
                  (the list itself communicates the "and" to assistive tech). */}
              {i > 0 && (
                <span className="deck-combos-plus" aria-hidden>
                  +
                </span>
              )}
              <button
                type="button"
                className="deck-combos-card-art"
                onClick={() => onCardTap(i)}
                aria-label={`Preview ${c.cardName}`}
              >
                <ComboCardArt localUrl={localUrl} cardName={c.cardName} />
                {isMissing && (
                  <span
                    className={`deck-combos-card-status${isOwned ? ' is-owned' : ''}`}
                    role="img"
                    aria-label={
                      isOwned ? `${c.cardName} — owned in collection` : `${c.cardName} — not owned`
                    }
                  >
                    {isOwned ? (
                      <CheckCircle2 width={18} height={18} strokeWidth={2.5} aria-hidden />
                    ) : (
                      <Circle width={18} height={18} strokeWidth={2.5} aria-hidden />
                    )}
                  </span>
                )}
                {c.quantity > 1 && (
                  <span className="deck-combos-card-qty-badge" aria-label={`${c.quantity} copies`}>
                    ×{c.quantity}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {combo.produces.length > 0 && (
        <div className="deck-combos-produces" aria-label="Results">
          {combo.produces.slice(0, 3).map((p, i) => {
            const isInfinite = p.toLowerCase().startsWith('infinite ');
            const label = isInfinite ? p.slice(9) : p;
            return (
              <span key={i} className="deck-combos-produce-chip" title={p}>
                {isInfinite && <span aria-hidden>∞ </span>}
                {label}
              </span>
            );
          })}
          {combo.produces.length > 3 && (
            <span className="deck-combos-produce-chip deck-combos-produce-chip--more">
              +{combo.produces.length - 3}
            </span>
          )}
        </div>
      )}

      {hasDetails && (
        <>
          <button
            type="button"
            className="deck-combos-details-toggle"
            aria-expanded={detailsOpen}
            aria-controls={`combo-details-${combo.id}`}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            {detailsOpen ? (
              <ChevronDown width={13} height={13} aria-hidden />
            ) : (
              <ChevronRight width={13} height={13} aria-hidden />
            )}
            {detailsOpen ? 'Hide details' : 'Show details'}
          </button>
          {detailsOpen && (
            <div id={`combo-details-${combo.id}`} className="deck-combos-detail">
              {(combo.prerequisites?.easy || combo.prerequisites?.notable || combo.manaNeeded) && (
                <DetailSection
                  icon={<ListChecks width={13} height={13} aria-hidden />}
                  title="Prerequisites"
                >
                  {combo.manaNeeded && (
                    <p className="deck-combos-mana-needed">
                      <span className="deck-combos-detail-label">Mana needed</span>
                      <MagicText text={combo.manaNeeded} />
                    </p>
                  )}
                  {combo.prerequisites?.easy && <BulletList text={combo.prerequisites.easy} />}
                  {combo.prerequisites?.notable && (
                    <BulletList text={combo.prerequisites.notable} muted />
                  )}
                </DetailSection>
              )}

              {steps.length > 0 && (
                <DetailSection
                  icon={<Footprints width={13} height={13} aria-hidden />}
                  title="Steps"
                >
                  <ol className="deck-combos-steps">
                    {steps.map((step, i) => (
                      <li key={i}>
                        <MagicText text={step} />
                      </li>
                    ))}
                  </ol>
                </DetailSection>
              )}

              {combo.produces.length > 0 && (
                <DetailSection
                  icon={<InfinityIcon width={13} height={13} aria-hidden />}
                  title="Results"
                >
                  <ul className="deck-combos-results">
                    {combo.produces.map((p, i) => (
                      <li key={i}>
                        <span className="deck-combos-infinity" aria-hidden>
                          ∞
                        </span>
                        <MagicText text={p} />
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'oneAway' && missingCardName && (
        <button
          type="button"
          className="deck-combos-add"
          onClick={onAddMissing}
          aria-label={`Add ${missingCardName} to complete this combo`}
        >
          <Plus width={11} height={11} aria-hidden />
          <span className="card-name-chip-text" title={missingCardName}>
            Add {missingCardName}
          </span>
        </button>
      )}
    </li>
  );
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  // The collapse lives one level up — the whole detail panel (Prereqs +
  // Steps + Results) toggles together via a single "Show details" button.
  // Each individual section is just a heading + body.
  return (
    <section className="deck-combos-detail-section">
      <h4 className="deck-combos-detail-title">
        {icon} {title}
      </h4>
      {children}
    </section>
  );
}

function BulletList({ text, muted }: { text: string; muted?: boolean }) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  return (
    <ul className={`deck-combos-bullets${muted ? ' muted' : ''}`}>
      {lines.map((line, i) => (
        <li key={i}>
          <MagicText text={line} />
        </li>
      ))}
    </ul>
  );
}

const COLOR_ORDER = ['w', 'u', 'b', 'r', 'g'] as const;

function ColorIdentityPips({ identity }: { identity: string }) {
  const colors = identity ? COLOR_ORDER.filter((c) => identity.includes(c)) : [];
  if (colors.length === 0) {
    return <ColorPip color="C" pip={false} className="deck-combos-pip" label="Colorless" />;
  }
  return (
    <span
      className="deck-combos-pips"
      aria-label={`Color identity: ${colors.join('').toUpperCase()}`}
    >
      {colors.map((c) => (
        <ColorPip key={c} color={c} pip={false} className="deck-combos-pip" />
      ))}
    </span>
  );
}

function splitSteps(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function formatDeckCount(n: number): string {
  if (n <= 0) return 'Popularity unknown';
  return `${n.toLocaleString()} ${n === 1 ? 'deck' : 'decks'}`;
}
