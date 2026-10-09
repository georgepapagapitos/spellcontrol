import '@/styles/deck-builder-tabs.css';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Plus } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import {
  fetchCommanderData,
  fetchCommanderThemeData,
  fetchPartnerCommanderData,
  fetchPartnerThemeData,
} from '@/deck-builder/services/edhrec/client';
import type { EDHRECCard, EDHRECTheme } from '@/deck-builder/types';
import { useTaggerReady } from '@/lib/cards/use-tagger-ready';
import {
  analyzeDeck,
  classifyCandidate,
  type DeckAnalysisResult,
} from '@/lib/deck-analysis/deck-analysis';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { buildAllocationMap, pickCollectionCopy } from '@/lib/collection/allocations';
import { scryfallToEnrichedCard } from '@/lib/cards/scryfall-to-enriched';
import { buildCardImageIndex, buildCardIndex } from '@/lib/deck-analysis/deck-card-index';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { classifyInclusion } from '@/lib/deck-analysis/inclusion-label';
import type { EnrichedCard } from '../../types';
import { CardPreview } from '@/components/card/CardPreview';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { type SelectOption } from '@/lib/util/select-option';
import { OwnershipBadge } from './OwnershipBadge';
import { Chip } from '@/components/shared/Chip';
import { Surface } from '@/components/shared/Surface';

import { userMessage } from '@/lib/util/user-error';
export interface DeckAnalysisPanelHandle {
  /** Scroll the panel into view. */
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

export const DeckAnalysisPanel = forwardRef<DeckAnalysisPanelHandle, Props>(
  function DeckAnalysisPanel(
    { deckId, format, commander, partnerCommander, mainboard, onAdd },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      reveal: () => {
        window.requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      },
    }));

    const taggerReady = useTaggerReady();

    const analysis: DeckAnalysisResult = useMemo(
      () => analyzeDeck({ format, commander, partnerCommander, mainboard }, taggerReady),
      [format, commander, partnerCommander, mainboard, taggerReady]
    );

    return (
      <Surface
        as="div"
        variant="framed"
        ref={containerRef}
        className="deck-analysis-panel deck-combos-panel is-embedded"
        role="region"
        aria-label="Analysis"
      >
        <div id="deck-analysis-body" className="deck-combos-body">
          {/* Suggestions only: the Roles strip already covers the Diagnosis
              (role current-vs-target). */}
          <SuggestionsSection
            analysis={analysis}
            commander={commander}
            partnerCommander={partnerCommander}
            mainboard={mainboard}
            deckId={deckId}
            onAdd={onAdd}
          />
        </div>
      </Surface>
    );
  }
);

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
  const savedCubes = useCubeStore((s) => s.saved);
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

  const cardImageIndex = useMemo(() => buildCardImageIndex(collection, deck), [collection, deck]);

  const cardIndex = useMemo(() => buildCardIndex(collection, deck), [collection, deck]);

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
        setError(userMessage(err, "Couldn't load suggestions. Try again in a moment."));
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
    const allocations = buildAllocationMap(decks, savedCubes);
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
  }, [collection, decks, savedCubes, deckId]);

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
    let limit = 30;
    if (filter === 'gaps') {
      if (deficitRoles.length === 0) {
        limit = 24;
      } else {
        const roleSet = new Set(deficitRoles);
        list = classified.filter((c) => c.role && roleSet.has(c.role));
      }
    } else if (filter !== 'all') {
      list = classified.filter((c) => c.role === filter);
    }
    // Owned-first (the locked default): a free owned copy surfaces above an
    // only-in-other-deck copy, above an unowned staple — so "build it tonight"
    // beats "go buy this". A stable sort preserves EDHREC inclusion order
    // within each ownership band (candidates arrive inclusion-ranked).
    const ownedRank = (o: Ownership): number =>
      o.state === 'available' ? 0 : o.state === 'in-other-deck' ? 1 : 2;
    return [...list]
      .sort((a, b) => ownedRank(a.ownership) - ownedRank(b.ownership))
      .slice(0, limit);
  }, [classified, filter, deficitRoles]);

  /** Resolve a thumbnail URL for an EDHREC card. Mirrors the priority used
   *  by DeckCombosPanel — local indexes first (free, no network), then
   *  EDHREC's own image_uris, then a Scryfall named-card image endpoint
   *  which returns a CDN-cached redirect with no JS API call. */
  const resolveThumb = useCallback(
    (card: EDHRECCard): string | undefined => {
      const nameKey = card.name.toLowerCase();
      const local = cardImageIndex.byName.get(nameKey);
      if (local) return local;
      // EDHREC art is already a CDN URL; for anything else, return undefined and
      // let SuggestionRow resolve the CDN image by name (never the rate-limited
      // API host).
      return card.image_uris?.[0]?.normal;
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
        labels.push(classifyInclusion(entry.card.inclusion).label);
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
        const allocations = buildAllocationMap(decks, savedCubes);
        const claim = pickCollectionCopy(card.name, collection, allocations, scry.id);
        onAdd(scry, claim?.copyId ?? null);
        setCandidates((prev) => prev.filter((c) => c.name !== card.name));
      } catch (err) {
        setError(userMessage(err, `Couldn't add ${card.name}. Try again.`));
      } finally {
        setAdding(null);
      }
    },
    [collection, decks, savedCubes, onAdd]
  );

  if (!hasCommander) {
    return (
      <section className="deck-analysis-suggestions">
        <p className="deck-combos-empty">Set a commander to see suggestions for your deck.</p>
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

      <p className="deck-analysis-suggest-hint">
        {themeSlug
          ? `${themes.find((t) => t.slug === themeSlug)?.name ?? themeSlug} picks, matched to your deck.`
          : "EDHREC's top cards for this commander, matched to your deck."}
      </p>

      {previewCards && previewCards.length > 0 && (
        <CardPreview
          source="suggestion"
          showRole
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
    <Chip className="filter-chip" pressed={active} onClick={onClick}>
      {label}
    </Chip>
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
    return <OwnershipBadge owned title={tip} />;
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
  imageUrl?: string;
  isAdding: boolean;
  onAdd: () => void;
  onPreview: () => void;
}) {
  const { card, role, ownership } = entry;
  const ownershipBadge = renderOwnershipBadge(ownership);
  // Resolve the CDN art by name (cached + batched) when no URL was passed in.
  const resolved = useCardThumb(imageUrl ? undefined : card.name);
  const thumb = imageUrl ?? resolved;
  return (
    <li className="deck-analysis-suggest-row">
      <button
        type="button"
        className="deck-analysis-suggest-art"
        onClick={onPreview}
        aria-label={`Preview ${card.name}`}
      >
        {thumb && <img src={thumb} alt={card.name} loading="lazy" decoding="async" />}
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
          {classifyInclusion(card.inclusion).label}
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
        <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
        {isAdding ? 'Adding…' : 'Add'}
      </button>
    </li>
  );
}
