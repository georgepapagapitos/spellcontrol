import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Footprints,
  Infinity as InfinityIcon,
  ListChecks,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../../lib/allocations';
import { useDeckCombos } from '../../lib/use-deck-combos';
import type { ComboMatch } from '../../types/combos';
import { MagicText } from './MagicText';

export interface DeckCombosPanelHandle {
  /** Expand the panel (if collapsed), scroll it into view, and focus the first tab. */
  reveal(): void;
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
}

type Tab = 'inDeck' | 'oneAway';

const COLLAPSED_STORAGE_KEY = 'spellcontrol-combos-panel-collapsed';

function readCollapsedPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
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
  { deckId: _deckId, deckOracleIds, format, onAdd },
  ref
) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);

  const ownedOracleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collection) if (c.oracleId) ids.add(c.oracleId);
    return Array.from(ids);
  }, [collection]);

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

  const [tab, setTab] = useState<Tab>('inDeck');
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPref());
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
    reveal: () => {
      setCollapsed(false);
      // Wait a frame so the panel has expanded before scrolling/focusing.
      window.requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        firstButtonRef.current?.focus();
      });
    },
  }));

  const inDeckCount = data?.inDeck.length ?? 0;
  const oneAwayCount = data?.oneAway.length ?? 0;
  const matches = (tab === 'inDeck' ? data?.inDeck : data?.oneAway) ?? [];

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
      className={`deck-combos-panel${collapsed ? ' is-collapsed' : ''}`}
      role="region"
      aria-label="Combos"
    >
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
          <span
            className={`deck-combos-spinner${loading ? '' : ' is-idle'}`}
            aria-hidden
          />
          <span className="deck-combos-header-chevron">
            {collapsed ? (
              <ChevronDown width={16} height={16} />
            ) : (
              <ChevronUp width={16} height={16} />
            )}
          </span>
        </span>
      </button>

      {collapsed && <div className="sr-only">Combos panel collapsed — click to expand.</div>}

      <div
        id="deck-combos-body"
        className="deck-combos-body"
        hidden={collapsed}
        aria-hidden={collapsed}
      >
        <div className="deck-combos-tabs" role="tablist" aria-label="Combo bucket">
          <button
            ref={firstButtonRef}
            type="button"
            role="tab"
            aria-selected={tab === 'inDeck'}
            className={`deck-combos-tab${tab === 'inDeck' ? ' active' : ''}`}
            onClick={() => setTab('inDeck')}
          >
            In deck
            <span className="deck-combos-tab-count" aria-label={`${inDeckCount} combos`}>
              {inDeckCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'oneAway'}
            className={`deck-combos-tab${tab === 'oneAway' ? ' active' : ''}`}
            onClick={() => setTab('oneAway')}
          >
            One card away
            <span className="deck-combos-tab-count" aria-label={`${oneAwayCount} combos`}>
              {oneAwayCount}
            </span>
          </button>
        </div>

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
                onAddMissing={() => void handleAddMissing(match)}
              />
            ))}
          </ul>
        )}

        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>
      </div>
    </div>
  );
});

interface CardImageIndex {
  byOracle: Map<string, string>;
  byName: Map<string, string>;
}

interface ComboRowProps {
  match: ComboMatch;
  tab: Tab;
  cardImageIndex: CardImageIndex;
  onAddMissing: () => void;
}

function ComboRow({ match, tab, cardImageIndex, onAddMissing }: ComboRowProps) {
  const { combo } = match;
  const missingOracleId = match.missingOracleIds[0] ?? null;
  const missingCardName = missingOracleId
    ? combo.cards.find((c) => c.oracleId === missingOracleId)?.cardName
    : null;

  const steps = useMemo(() => splitSteps(combo.description), [combo.description]);
  const hasDetails =
    !!combo.prerequisites?.easy ||
    !!combo.prerequisites?.notable ||
    !!combo.manaNeeded ||
    steps.length > 0;

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
        <span className="deck-combos-row-title" title={comboTitle}>
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
          const imageUrl =
            cardImageIndex.byOracle.get(c.oracleId) ??
            cardImageIndex.byName.get(c.cardName.toLowerCase());
          return (
            <li key={c.oracleId} className={`deck-combos-card-tile${isMissing ? ' missing' : ''}`}>
              {/* Plus separator between cards. Visual rather than semantic
                  (the list itself communicates the "and" to assistive tech). */}
              {i > 0 && (
                <span className="deck-combos-plus" aria-hidden>
                  +
                </span>
              )}
              <span className="deck-combos-card-art">
                {imageUrl ? (
                  <img src={imageUrl} alt={c.cardName} loading="lazy" decoding="async" />
                ) : (
                  <span className="deck-combos-card-art-fallback" aria-hidden />
                )}
                {isMissing && (
                  <span
                    className="deck-combos-card-overlay"
                    aria-label={`${c.cardName} is missing`}
                  >
                    Missing
                  </span>
                )}
                {c.quantity > 1 && (
                  <span className="deck-combos-card-qty-badge" aria-label={`${c.quantity} copies`}>
                    ×{c.quantity}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {(hasDetails || combo.produces.length > 0) && (
        <div className="deck-combos-detail">
          {(combo.prerequisites?.easy || combo.prerequisites?.notable || combo.manaNeeded) && (
            <DetailSection
              icon={<ListChecks width={13} height={13} aria-hidden />}
              title="Prerequisites"
              collapsible
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
            <DetailSection icon={<Footprints width={13} height={13} aria-hidden />} title="Steps">
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

      {tab === 'oneAway' && missingCardName && (
        <button
          type="button"
          className="deck-combos-add btn btn-sm btn-primary"
          onClick={onAddMissing}
          aria-label={`Add ${missingCardName} to complete this combo`}
        >
          <Plus width={14} height={14} aria-hidden /> Add {missingCardName}
        </button>
      )}
    </li>
  );
}

function DetailSection({
  icon,
  title,
  collapsible = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  /** When true, the section starts collapsed and the title becomes a toggle. */
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  // Prerequisites collapse by default — they're verbose and most users want to
  // skim Steps/Results first. Steps and Results are non-collapsible because
  // they're the primary value of opening a combo's detail view.
  const [open, setOpen] = useState(false);
  if (!collapsible) {
    return (
      <section className="deck-combos-detail-section">
        <h4 className="deck-combos-detail-title">
          {icon} {title}
        </h4>
        {children}
      </section>
    );
  }
  return (
    <section className="deck-combos-detail-section">
      <button
        type="button"
        className="deck-combos-detail-title is-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon} {title}
        <span className="deck-combos-detail-toggle-icon" aria-hidden>
          {open ? <ChevronDown width={12} height={12} /> : <ChevronRight width={12} height={12} />}
        </span>
      </button>
      {open && children}
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
    return <i className="ms ms-c ms-cost deck-combos-pip" aria-label="Colorless" />;
  }
  return (
    <span
      className="deck-combos-pips"
      aria-label={`Color identity: ${colors.join('').toUpperCase()}`}
    >
      {colors.map((c) => (
        <i key={c} className={`ms ms-${c} ms-cost deck-combos-pip`} aria-hidden />
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
