import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Gauge, Plus } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import {
  fetchCommanderData,
  fetchCommanderThemeData,
  fetchPartnerCommanderData,
  fetchPartnerThemeData,
} from '@/deck-builder/services/edhrec/client';
import type { EDHRECCard, EDHRECTheme } from '@/deck-builder/types';
import { loadTaggerData, hasTaggerData } from '@/deck-builder/services/tagger/client';
import {
  analyzeDeck,
  classifyCandidate,
  type DeckAnalysisResult,
  type RoleHealth,
} from '../../lib/deck-analysis';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../../lib/allocations';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import type { EnrichedCard } from '../../types';
import { CardPreview } from '../CardPreview';
import { SelectMenu, type SelectOption } from '../SelectMenu';

export interface DeckAnalysisPanelHandle {
  /** Expand the panel, scroll it into view, and focus the diagnosis header. */
  reveal(): void;
}

interface Props {
  deckId: string;
  format: DeckFormat;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  mainboard: { slotId: string; card: ScryfallCard }[];
  onAdd: (card: ScryfallCard, allocatedCopyId: string | null) => void;
}

const COLLAPSED_STORAGE_KEY = 'spellcontrol-analysis-panel-collapsed';

function readCollapsedPref(): boolean {
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
    /* ignore */
  }
}

export const DeckAnalysisPanel = forwardRef<DeckAnalysisPanelHandle, Props>(
  function DeckAnalysisPanel(
    { deckId, format, commander, partnerCommander, mainboard, onAdd },
    ref
  ) {
    const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPref());
    const [tab, setTab] = useState<'diagnosis' | 'suggestions'>('diagnosis');
    const [taggerVersion, setTaggerVersion] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const focusTargetRef = useRef<HTMLButtonElement>(null);

    // Trigger tagger load on mount so role data is available the first time
    // the user opens the panel. Safe to call repeatedly — the client dedupes.
    useEffect(() => {
      if (hasTaggerData()) return;
      let cancelled = false;
      void loadTaggerData().then(() => {
        if (!cancelled && hasTaggerData()) setTaggerVersion((v) => v + 1);
      });
      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      writeCollapsedPref(collapsed);
    }, [collapsed]);

    useImperativeHandle(ref, () => ({
      reveal: () => {
        setCollapsed(false);
        window.requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          focusTargetRef.current?.focus();
        });
      },
    }));

    const taggerReady = hasTaggerData();
    void taggerVersion;

    const analysis: DeckAnalysisResult = useMemo(
      () => analyzeDeck({ format, commander, partnerCommander, mainboard }, taggerReady),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [format, commander, partnerCommander, mainboard, taggerReady, taggerVersion]
    );

    const summary = useMemo(() => {
      const lowCount = analysis.roles.filter((r) => r.status === 'low').length;
      const highCount = analysis.roles.filter((r) => r.status === 'high').length;
      const offColor = analysis.colorIdentity.offColorCards.length;
      return { lowCount, highCount, offColor };
    }, [analysis]);

    return (
      <div
        ref={containerRef}
        className={`deck-analysis-panel deck-combos-panel${collapsed ? ' is-collapsed' : ''}`}
        role="region"
        aria-label="Analysis"
      >
        <button
          type="button"
          className="deck-combos-header"
          aria-expanded={!collapsed}
          aria-controls="deck-analysis-body"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand analysis panel' : 'Collapse analysis panel'}
        >
          <Gauge width={16} height={16} aria-hidden />
          <span className="deck-combos-title">Analysis</span>
          <span className="deck-combos-header-summary" aria-hidden>
            {summary.lowCount > 0 && (
              <span>
                {summary.lowCount} {summary.lowCount === 1 ? 'gap' : 'gaps'}
              </span>
            )}
            {summary.highCount > 0 && <span>{summary.highCount} over</span>}
            {summary.offColor > 0 && <span>{summary.offColor} off-color</span>}
            {summary.lowCount === 0 &&
              summary.highCount === 0 &&
              summary.offColor === 0 &&
              taggerReady && <span className="deck-combos-header-empty">Looks healthy</span>}
            {!taggerReady && <span className="deck-combos-header-empty">Loading…</span>}
          </span>
          <span className="deck-combos-header-trailing" aria-hidden>
            <span className="deck-combos-header-chevron">
              {collapsed ? (
                <ChevronDown width={16} height={16} />
              ) : (
                <ChevronUp width={16} height={16} />
              )}
            </span>
          </span>
        </button>

        <div
          id="deck-analysis-body"
          className="deck-combos-body"
          hidden={collapsed}
          aria-hidden={collapsed}
        >
          {/* Diagnosis and Suggestions are peer views, not stacked sections —
              tabs keep only one tall column on screen at a time (matching the
              Combos panel) instead of nesting a collapse inside a collapse. */}
          <div className="deck-combos-tabs" role="tablist" aria-label="Analysis view">
            <button
              ref={focusTargetRef}
              type="button"
              role="tab"
              aria-selected={tab === 'diagnosis'}
              className={`deck-combos-tab${tab === 'diagnosis' ? ' active' : ''}`}
              onClick={() => setTab('diagnosis')}
            >
              Diagnosis
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'suggestions'}
              className={`deck-combos-tab${tab === 'suggestions' ? ' active' : ''}`}
              onClick={() => setTab('suggestions')}
            >
              Suggestions
            </button>
          </div>

          {/* Diagnosis — role health vs. format targets. This is the value
              add over the Stats panel: stats shows counts; this shows status
              + an actionable verdict per role. */}
          {tab === 'diagnosis' ? (
            <DiagnosisSection analysis={analysis} />
          ) : (
            /* Suggestions — popular cards for this commander, filtered to
               the deck's diagnosed gaps by default. */
            <SuggestionsSection
              analysis={analysis}
              commander={commander}
              partnerCommander={partnerCommander}
              mainboard={mainboard}
              deckId={deckId}
              onAdd={onAdd}
            />
          )}
        </div>
      </div>
    );
  }
);

// ─── Diagnosis ─────────────────────────────────────────────────────────────

function DiagnosisSection({ analysis }: { analysis: DeckAnalysisResult }) {
  if (!analysis.taggerReady) {
    return (
      <p className="deck-combos-empty">Loading role data — verdicts will appear in a moment.</p>
    );
  }
  return (
    <section className="deck-analysis-diagnosis">
      <ul className="deck-analysis-role-list">
        {analysis.roles.map((role) => (
          <RoleRow key={role.key} role={role} />
        ))}
      </ul>
      <CurveVerdict analysis={analysis} />
      {analysis.colorIdentity.commanderColors.length > 0 &&
        analysis.colorIdentity.offColorCards.length > 0 && (
          <div className="deck-analysis-warning">
            <AlertTriangle width={14} height={14} aria-hidden />
            <div>
              <strong>
                {analysis.colorIdentity.offColorCards.length} card
                {analysis.colorIdentity.offColorCards.length === 1 ? '' : 's'} outside color
                identity
              </strong>
              <p>
                {analysis.colorIdentity.offColorCards
                  .slice(0, 4)
                  .map((c) => c.cardName)
                  .join(', ')}
                {analysis.colorIdentity.offColorCards.length > 4 &&
                  ` +${analysis.colorIdentity.offColorCards.length - 4} more`}
              </p>
            </div>
          </div>
        )}
    </section>
  );
}

function RoleRow({ role }: { role: RoleHealth }) {
  const Icon = role.status === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <li className={`deck-analysis-role-row is-${role.status}`}>
      <header className="deck-analysis-role-header">
        <Icon width={14} height={14} aria-hidden />
        <span className="deck-analysis-role-label">{role.label}</span>
        <span className="deck-analysis-role-count" aria-label={`${role.count} cards`}>
          {role.count}
          <span className="deck-analysis-role-target">
            {' / '}
            {role.range[0]}–{role.range[1]}
          </span>
        </span>
      </header>
      <p className="deck-analysis-role-message">{role.message}</p>
    </li>
  );
}

function CurveVerdict({ analysis }: { analysis: DeckAnalysisResult }) {
  const { curve } = analysis;
  // Stats already renders the curve. We only surface a VERDICT line so the
  // user sees "is my curve too top-heavy?" without re-reading the chart.
  if (curve.verdict === 'curve-ok') return null;
  return (
    <p className={`deck-analysis-verdict deck-analysis-verdict--${curve.verdict}`}>
      <AlertTriangle width={13} height={13} aria-hidden /> {curve.message}
    </p>
  );
}

// ─── Suggestions ───────────────────────────────────────────────────────────

interface SuggestionsSectionProps {
  analysis: DeckAnalysisResult;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  mainboard: { slotId: string; card: ScryfallCard }[];
  deckId: string;
  onAdd: (card: ScryfallCard, allocatedCopyId: string | null) => void;
}

type SuggestionFilter = 'gaps' | 'all' | 'ramp' | 'cardDraw' | 'removal' | 'boardwipe';

type Ownership =
  | { state: 'unowned' }
  | { state: 'available'; freeCopies: number; otherDecks: string[] }
  | { state: 'in-other-deck'; otherDecks: string[] };

interface SuggestionEntry {
  card: EDHRECCard;
  role: ReturnType<typeof classifyCandidate>;
  ownership: Ownership;
}

function SuggestionsSection({
  analysis,
  commander,
  partnerCommander,
  mainboard,
  deckId,
  onAdd,
}: SuggestionsSectionProps) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === deckId) ?? null);
  const [filter, setFilter] = useState<SuggestionFilter>('gaps');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<EDHRECCard[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  // Available themes for this commander, populated from the initial generic
  // fetch. `themeSlug = null` means "Any" — commander-wide picks.
  const [themes, setThemes] = useState<EDHRECTheme[]>([]);
  const [themeSlug, setThemeSlug] = useState<string | null>(null);

  // Card preview carousel state — mirrors the pattern from DeckCombosPanel.
  const [previewCards, setPreviewCards] = useState<EnrichedCard[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewSectionLabels, setPreviewSectionLabels] = useState<string[]>([]);

  const hasCommander = !!commander;

  // Local image index — same priority as DeckCombosPanel:
  //   1. Collection EnrichedCard.imageNormal (already-cached, full quality)
  //   2. Deck ScryfallCard.image_uris.normal
  // Indexed by both oracle id AND lowercased name so cards imported before
  // EnrichedCard.oracleId existed still resolve via name match.
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
      const fromScryfall = (card: ScryfallCard | null) => {
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

  // Card-data index for the carousel — same priority, but returning full
  // EnrichedCard objects so the preview can show name, mana cost, oracle
  // text, price, etc. Collection copies are richest (ownership, foil).
  const cardIndex = useMemo(() => {
    const byName = new Map<string, EnrichedCard>();
    for (const c of collection) {
      if (c.name) {
        const key = c.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, c);
      }
    }
    if (deck) {
      const indexScryfall = (card: ScryfallCard | null) => {
        if (!card?.name) return;
        const key = card.name.toLowerCase();
        if (byName.has(key)) return;
        byName.set(key, scryfallToEnrichedCard(card));
      };
      indexScryfall(deck.commander);
      indexScryfall(deck.partnerCommander);
      for (const c of deck.cards) indexScryfall(c.card);
      for (const c of deck.sideboard) indexScryfall(c.card);
    }
    return { byName };
  }, [collection, deck]);

  useEffect(() => {
    if (!hasCommander || !commander) return;
    let cancelled = false;
    // Legitimate "kick off a fetch" effect — the setState calls precede an
    // async network request, not cascading renders. Codebase precedent in
    // BinderCardEditor.tsx and CardScanner.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    // Theme-specific pages don't include the taglinks/themes list, so we
    // only update `themes` when fetching the generic page (themeSlug=null).
    // That keeps the picker populated even after switching to a theme.
    const isThemeFetch = themeSlug !== null;
    const fetcher = partnerCommander
      ? isThemeFetch
        ? fetchPartnerThemeData(commander.name, partnerCommander.name, themeSlug)
        : fetchPartnerCommanderData(commander.name, partnerCommander.name)
      : isThemeFetch
        ? fetchCommanderThemeData(commander.name, themeSlug)
        : fetchCommanderData(commander.name);
    fetcher
      .then((data) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const unique: EDHRECCard[] = [];
        for (const c of data.cardlists.allNonLand) {
          if (seen.has(c.name)) continue;
          seen.add(c.name);
          unique.push(c);
        }
        setCandidates(unique);
        if (!isThemeFetch && data.themes.length > 0) {
          setThemes(data.themes);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load suggestions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasCommander, commander, partnerCommander, themeSlug]);

  // Reset the chosen theme when the commander itself changes, otherwise a
  // stale slug would 404 against the new commander's page. Uses React's
  // "adjust state during render when a prop changes" pattern instead of a
  // useEffect — see https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const commanderKey = `${commander?.name ?? ''}|${partnerCommander?.name ?? ''}`;
  const [prevCommanderKey, setPrevCommanderKey] = useState(commanderKey);
  if (prevCommanderKey !== commanderKey) {
    setPrevCommanderKey(commanderKey);
    setThemeSlug(null);
    setThemes([]);
  }

  const inDeckNames = useMemo(() => {
    const set = new Set<string>();
    if (commander) set.add(commander.name.toLowerCase());
    if (partnerCommander) set.add(partnerCommander.name.toLowerCase());
    for (const { card } of mainboard) set.add(card.name.toLowerCase());
    return set;
  }, [commander, partnerCommander, mainboard]);

  /** Per-name ownership state, considering allocations to OTHER decks.
   *  - `available`: at least one copy in collection that isn't already
   *    checked out to a different deck (it may still be in this deck, but
   *    those cards are filtered upstream so the case rarely matters).
   *  - `in-other-deck`: all copies are allocated to other decks.
   *  - `unowned`: not in collection at all. */
  const ownershipByName = useMemo(() => {
    const allocations = buildAllocationMap(decks);
    const byName = new Map<string, { free: number; otherDeckNames: Set<string> }>();
    for (const copy of collection) {
      if (!copy.name) continue;
      const key = copy.name.toLowerCase();
      const entry = byName.get(key) ?? { free: 0, otherDeckNames: new Set<string>() };
      const claim = allocations.get(copy.copyId);
      if (!claim) {
        entry.free += 1;
      } else if (claim.deckId !== deckId) {
        entry.otherDeckNames.add(claim.deckName);
      } else {
        // Allocated to the current deck — treat as free for badge purposes
        // since the user isn't competing with a different deck for it.
        entry.free += 1;
      }
      byName.set(key, entry);
    }
    return byName;
  }, [collection, decks, deckId]);

  const ownershipFor = useCallback(
    (name: string): Ownership => {
      const entry = ownershipByName.get(name.toLowerCase());
      if (!entry) return { state: 'unowned' };
      const otherDecks = [...entry.otherDeckNames];
      if (entry.free > 0) return { state: 'available', freeCopies: entry.free, otherDecks };
      if (otherDecks.length > 0) return { state: 'in-other-deck', otherDecks };
      return { state: 'unowned' };
    },
    [ownershipByName]
  );

  const deficitRoles = useMemo(
    () => analysis.roles.filter((r) => r.status === 'low' && r.key !== 'lands').map((r) => r.key),
    [analysis.roles]
  );

  const classified: SuggestionEntry[] = useMemo(() => {
    const out: SuggestionEntry[] = [];
    for (const card of candidates) {
      if (inDeckNames.has(card.name.toLowerCase())) continue;
      const role = analysis.taggerReady ? classifyCandidate(card.name) : null;
      out.push({ card, role, ownership: ownershipFor(card.name) });
    }
    return out;
  }, [candidates, inDeckNames, ownershipFor, analysis.taggerReady]);

  const filtered = useMemo(() => {
    let list = classified;
    if (filter === 'gaps') {
      if (deficitRoles.length === 0) return classified.slice(0, 24);
      const roleSet = new Set(deficitRoles);
      list = classified.filter((c) => c.role && roleSet.has(c.role));
    } else if (filter !== 'all') {
      list = classified.filter((c) => c.role === filter);
    }
    return list.slice(0, 30);
  }, [classified, filter, deficitRoles]);

  /** Resolve a thumbnail URL for an EDHREC card. Mirrors the priority used
   *  by DeckCombosPanel — local indexes first (free, no network), then
   *  EDHREC's own image_uris, then a Scryfall named-card image endpoint
   *  which returns a CDN-cached redirect with no JS API call. */
  const resolveThumb = useCallback(
    (card: EDHRECCard): string => {
      const nameKey = card.name.toLowerCase();
      const local = cardImageIndex.byName.get(nameKey);
      if (local) return local;
      const edhrec = card.image_uris?.[0]?.normal;
      if (edhrec) return edhrec;
      return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
        card.name
      )}&format=image&version=normal`;
    },
    [cardImageIndex]
  );

  /** Open the carousel starting at `tappedIndex`. Cards are resolved from
   *  local indexes first; anything missing is fetched from Scryfall on
   *  demand and converted to EnrichedCard. Failed lookups are skipped so
   *  the carousel never shows a broken slot. */
  const openCarousel = useCallback(
    async (entries: SuggestionEntry[], tappedIndex: number) => {
      const tappedName = entries[tappedIndex]?.card.name;
      const resolved: EnrichedCard[] = [];
      const labels: string[] = [];
      for (const entry of entries) {
        let card = cardIndex.byName.get(entry.card.name.toLowerCase()) ?? null;
        if (!card) {
          try {
            const scry = await getCardByName(entry.card.name);
            if (scry) card = scryfallToEnrichedCard(scry);
          } catch {
            /* skip — leaves the slot out of the carousel */
          }
        }
        if (!card) continue;
        resolved.push(card);
        const inclusion =
          entry.card.inclusion > 0 ? `${entry.card.inclusion.toFixed(0)}% of decks` : 'Suggestion';
        labels.push(inclusion);
      }
      if (resolved.length === 0) return;
      const idx = Math.max(
        0,
        resolved.findIndex((c) => c.name.toLowerCase() === tappedName?.toLowerCase())
      );
      setPreviewCards(resolved);
      setPreviewSectionLabels(labels);
      setPreviewIndex(idx >= 0 ? idx : 0);
    },
    [cardIndex]
  );

  const handleAdd = useCallback(
    async (card: EDHRECCard) => {
      setAdding(card.name);
      try {
        const scry = await getCardByName(card.name);
        if (!scry) {
          setError(`Couldn't resolve ${card.name}.`);
          return;
        }
        const allocations = buildAllocationMap(decks);
        const claim = pickCollectionCopy(card.name, collection, allocations, scry.id);
        onAdd(scry, claim?.copyId ?? null);
        setCandidates((prev) => prev.filter((c) => c.name !== card.name));
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to add ${card.name}`);
      } finally {
        setAdding(null);
      }
    },
    [collection, decks, onAdd]
  );

  if (!hasCommander) {
    return (
      <section className="deck-analysis-suggestions">
        <p className="deck-combos-empty">
          Suggestions come from EDHREC&rsquo;s commander pages — set a commander to see picks
          tailored to your deck.
        </p>
      </section>
    );
  }

  const gapsLabel = deficitRoles.length > 0 ? `Fill gaps (${deficitRoles.length})` : 'Top picks';

  const archetypeOptions: SelectOption<string>[] = [
    { value: '', label: 'Any' },
    ...themes.slice(0, 30).map((t) => ({
      value: t.slug,
      // Trigger shows just the name; the popover row adds the deck count.
      label: t.name,
      itemLabel: `${t.name} · ${t.count.toLocaleString()} ${t.count === 1 ? 'deck' : 'decks'}`,
    })),
  ];

  return (
    <section className="deck-analysis-suggestions">
      {themes.length > 0 && (
        <SelectMenu
          className="deck-analysis-archetype-select"
          value={themeSlug ?? ''}
          options={archetypeOptions}
          onChange={(v) => setThemeSlug(v === '' ? null : v)}
          label="Archetype"
          ariaLabel="Filter suggestions by archetype"
        />
      )}

      <div className="deck-analysis-filter-row" role="group" aria-label="Suggestion filter">
        <FilterPill
          active={filter === 'gaps'}
          onClick={() => setFilter('gaps')}
          label={gapsLabel}
        />
        <FilterPill active={filter === 'ramp'} onClick={() => setFilter('ramp')} label="Ramp" />
        <FilterPill
          active={filter === 'cardDraw'}
          onClick={() => setFilter('cardDraw')}
          label="Draw"
        />
        <FilterPill
          active={filter === 'removal'}
          onClick={() => setFilter('removal')}
          label="Removal"
        />
        <FilterPill
          active={filter === 'boardwipe'}
          onClick={() => setFilter('boardwipe')}
          label="Wipes"
        />
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
      </div>

      {loading && <p className="deck-combos-empty">Loading suggestions from EDHREC…</p>}
      {error && !loading && <p className="deck-combos-empty deck-combos-error">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="deck-combos-empty">
          {filter === 'gaps' && deficitRoles.length > 0
            ? 'No EDHREC picks matched the roles you lack. Try the per-role filters.'
            : 'No suggestions available.'}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <ul className="deck-analysis-suggest-list" role="list">
          {filtered.map((entry, idx) => (
            <SuggestionRow
              key={entry.card.name}
              entry={entry}
              imageUrl={resolveThumb(entry.card)}
              isAdding={adding === entry.card.name}
              onAdd={() => void handleAdd(entry.card)}
              onPreview={() => void openCarousel(filtered, idx)}
            />
          ))}
        </ul>
      )}

      <p className="deck-analysis-suggest-hint" aria-label={`Deck ${deckId.slice(0, 6)}`}>
        {themeSlug
          ? `Picks scoped to the ${themes.find((t) => t.slug === themeSlug)?.name ?? themeSlug} archetype, filtered against your deck.`
          : 'Picks from EDHREC’s top cards for this commander, filtered against your deck.'}
      </p>

      {previewCards && previewCards.length > 0 && (
        <CardPreview
          cards={previewCards}
          index={previewIndex}
          binderName="Suggestions"
          sectionLabels={previewSectionLabels}
          pageNumbers={previewCards.map(() => 0)}
          totalPages={1}
          currentDeckId={deckId}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewCards(null)}
        />
      )}
    </section>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`deck-combos-filter-pill${active ? ' active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

const ROLE_BADGE: Record<string, string> = {
  ramp: 'Ramp',
  cardDraw: 'Draw',
  removal: 'Removal',
  boardwipe: 'Wipe',
};

function renderOwnershipBadge(o: Ownership): React.ReactNode {
  if (o.state === 'unowned') return null;
  if (o.state === 'available') {
    const tip =
      o.otherDecks.length > 0
        ? `${o.freeCopies} free · also in ${o.otherDecks.join(', ')}`
        : `${o.freeCopies} ${o.freeCopies === 1 ? 'copy' : 'copies'} owned`;
    return (
      <span className="deck-analysis-suggest-owned" title={tip}>
        Owned
      </span>
    );
  }
  // in-other-deck — every copy is checked out elsewhere
  const tip =
    o.otherDecks.length === 1
      ? `Owned, currently in "${o.otherDecks[0]}"`
      : `Owned, currently in: ${o.otherDecks.join(', ')}`;
  return (
    <span className="deck-analysis-suggest-elsewhere" title={tip}>
      In other deck
    </span>
  );
}

function SuggestionRow({
  entry,
  imageUrl,
  isAdding,
  onAdd,
  onPreview,
}: {
  entry: SuggestionEntry;
  imageUrl: string;
  isAdding: boolean;
  onAdd: () => void;
  onPreview: () => void;
}) {
  const { card, role, ownership } = entry;
  const ownershipBadge = renderOwnershipBadge(ownership);
  return (
    <li className="deck-analysis-suggest-row">
      <button
        type="button"
        className="deck-analysis-suggest-art"
        onClick={onPreview}
        aria-label={`Preview ${card.name}`}
      >
        <img src={imageUrl} alt={card.name} loading="lazy" decoding="async" />
      </button>
      <button
        type="button"
        className="deck-analysis-suggest-body"
        onClick={onPreview}
        aria-label={`Preview ${card.name}`}
      >
        <div className="deck-analysis-suggest-title-row">
          <span className="deck-analysis-suggest-name" title={card.name}>
            {card.name}
          </span>
          {role && <span className="deck-analysis-suggest-role">{ROLE_BADGE[role] ?? role}</span>}
          {ownershipBadge}
        </div>
        <p className="deck-analysis-suggest-meta">
          {card.inclusion > 0 && <>In {card.inclusion.toFixed(0)}% of decks</>}
          {card.synergy != null && card.synergy > 0 && (
            <> · synergy +{(card.synergy * 100).toFixed(0)}%</>
          )}
        </p>
      </button>
      <button
        type="button"
        className="deck-analysis-suggest-add"
        onClick={onAdd}
        disabled={isAdding}
        aria-label={`Add ${card.name}`}
      >
        <Plus width={12} height={12} aria-hidden />
        {isAdding ? 'Adding…' : 'Add'}
      </button>
    </li>
  );
}
