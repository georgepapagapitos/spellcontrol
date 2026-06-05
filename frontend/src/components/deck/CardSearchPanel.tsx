import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { searchCards, getCardByName } from '@/deck-builder/services/scryfall/client';
import { ManaCost } from '../ManaCost';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../../lib/allocations';
import { normalizeForSearch } from '../../lib/normalize-search';
import { useToastsStore } from '../../store/toasts';
import { useSetMap } from '../../lib/api';
import { fetchTypeSuggestions } from '../../lib/scryfall-catalog';
import { parseTypeLine, SUPERTYPES, TYPES } from '../../lib/card-types';
import {
  compileExpression,
  effectiveTreatments,
  exactMatchesExpression,
  isExpressionEmpty,
  legalityMatchesExpression,
  setMatchesExpression,
  substringMatchesExpression,
} from '../../lib/rules';
import { CollectionFiltersDialog } from '../CollectionFiltersDialog';
import type { ChipExpression, EnrichedCard } from '../../types';

function isOffColor(cardCI: string[] | undefined, commanderCI: string[]): boolean {
  if (commanderCI.length === 0) return false;
  const set = new Set(commanderCI);
  return (cardCI ?? []).some((c) => !set.has(c));
}

export interface AddCardChoice {
  card: ScryfallCard;
  /** copyId of the collection copy claimed for this slot, or null if none. */
  allocatedCopyId: string | null;
}

export interface CardSearchPanelHandle {
  focusInput(): void;
  /** Seed the panel from an external search (the deck's in-deck search
   *  bar): set the query, jump to the Scryfall tab, and focus. */
  seed(query: string): void;
}

interface Props {
  deckId: string;
  commanderColorIdentity: string[];
  /**
   * Quantity of each card name already in this deck. Drives the "in deck × N"
   * hint and lets the panel hint that a duplicate add is intentional (e.g. for
   * basic lands).
   */
  existingCardCounts: Map<string, number>;
  onAdd: (choice: AddCardChoice) => void;
  /** Called when the user dismisses the panel via Escape. */
  onClose?: () => void;
}

type Mode = 'collection' | 'scryfall';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

// Local copy of the same enum vocabularies the collection page uses.
// Kept local so this component isn't load-coupled to that page.
const COLOR_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];
const RARITIES = ['mythic', 'rare', 'uncommon', 'common'] as const;

export const CardSearchPanel = forwardRef<CardSearchPanelHandle, Props>(function CardSearchPanel(
  { deckId, commanderColorIdentity, existingCardCounts, onAdd, onClose },
  ref
) {
  const [mode, setMode] = useState<Mode>('collection');
  const [query, setQuery] = useState('');
  const [announce, setAnnounce] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Chip-expression filter state — applies only in the Collection tab.
  // Scryfall already has its own query DSL, so we don't shoehorn this
  // there. Each section mirrors the collection page so the muscle memory
  // is identical; Binder + Group-printings are intentionally omitted
  // (no binder concept here, no per-printing rows).
  const [supertypeExpr, setSupertypeExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [typesExpr, setTypesExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [subtypeExpr, setSubtypeExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [rarityExpr, setRarityExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [oracleExpr, setOracleExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [legalityExpr, setLegalityExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [layoutExpr, setLayoutExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [treatmentExpr, setTreatmentExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [borderExpr, setBorderExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [setFilter, setSetFilter] = useState<Set<string>>(new Set());
  const [subtypeSuggestions, setSubtypeSuggestions] = useState<string[]>([]);
  const setMap = useSetMap();

  // Same subtype-suggestion fetch the collection page does — Scryfall
  // catalog minus known supertypes/types, deduped case-insensitively.
  const collection = useCollectionStore((s) => s.cards);
  useEffect(() => {
    const supertypeSet = new Set<string>(SUPERTYPES);
    const typeSet = new Set<string>(TYPES);
    const collectionSubtypeTokens = new Set<string>();
    for (const c of collection) {
      const { subtypes } = parseTypeLine(c.typeLine);
      for (const s of subtypes) collectionSubtypeTokens.add(s);
    }
    fetchTypeSuggestions().then((catalog) => {
      const byLower = new Map<string, string>();
      for (const t of [...catalog, ...collectionSubtypeTokens]) {
        const key = t.toLowerCase();
        if (supertypeSet.has(key) || typeSet.has(key)) continue;
        const existing = byLower.get(key);
        if (!existing || (existing === key && t !== key)) byLower.set(key, t);
      }
      setSubtypeSuggestions([...byLower.values()].sort((a, b) => a.localeCompare(b)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeFilterCount =
    (!isExpressionEmpty(supertypeExpr) ? 1 : 0) +
    (!isExpressionEmpty(typesExpr) ? 1 : 0) +
    (!isExpressionEmpty(subtypeExpr) ? 1 : 0) +
    (colorFilter.size > 0 ? 1 : 0) +
    (!isExpressionEmpty(rarityExpr) ? 1 : 0) +
    (!isExpressionEmpty(oracleExpr) ? 1 : 0) +
    (!isExpressionEmpty(legalityExpr) ? 1 : 0) +
    (!isExpressionEmpty(layoutExpr) ? 1 : 0) +
    (!isExpressionEmpty(treatmentExpr) ? 1 : 0) +
    (!isExpressionEmpty(borderExpr) ? 1 : 0) +
    (setFilter.size > 0 ? 1 : 0);

  // Pre-compile the chip expressions once per change so the per-card
  // loop in CollectionResults doesn't redo string work.
  const compiledSupertype = useMemo(() => compileExpression(supertypeExpr), [supertypeExpr]);
  const compiledTypes = useMemo(() => compileExpression(typesExpr), [typesExpr]);
  const compiledSubtype = useMemo(() => compileExpression(subtypeExpr), [subtypeExpr]);
  const compiledRarity = useMemo(() => compileExpression(rarityExpr), [rarityExpr]);
  const compiledOracle = useMemo(() => compileExpression(oracleExpr), [oracleExpr]);
  const compiledLegality = useMemo(() => compileExpression(legalityExpr), [legalityExpr]);
  const compiledLayout = useMemo(() => compileExpression(layoutExpr), [layoutExpr]);
  const compiledTreatment = useMemo(() => compileExpression(treatmentExpr), [treatmentExpr]);
  const compiledBorder = useMemo(() => compileExpression(borderExpr), [borderExpr]);
  // The two result lists publish their currently-visible cards here so the
  // panel-level "Enter to add the first result" handler is independent of
  // which tab is active.
  const visibleResultsRef = useRef<ScryfallCard[]>([]);
  const addCurrentRef = useRef<((index: number) => Promise<void> | void) | null>(null);

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
    seed: (q: string) => {
      setQuery(q);
      setMode('scryfall');
      inputRef.current?.focus();
    },
  }));

  // Auto-focus on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Resetting the active row when query/tab changes keeps "Enter adds the
  // top result" predictable.
  const [prevQueryMode, setPrevQueryMode] = useState({ query, mode });
  if (prevQueryMode.query !== query || prevQueryMode.mode !== mode) {
    setPrevQueryMode({ query, mode });
    setActiveIndex(0);
  }

  const handleAnnounce = (msg: string) => {
    // Cycle the live region by emptying first; some screen readers ignore
    // re-announcements of the same string.
    setAnnounce('');
    window.setTimeout(() => setAnnounce(msg), 30);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const max = visibleResultsRef.current.length;
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
      } else {
        onClose?.();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      if (max === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(max - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      if (max === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      if (max === 0) return;
      e.preventDefault();
      const idx = Math.min(activeIndex, max - 1);
      addCurrentRef.current?.(idx);
    }
  };

  return (
    <div className="card-search-panel">
      <div className="card-search-tabs" role="tablist" aria-label="Card source">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'collection'}
          className={`card-search-tab${mode === 'collection' ? ' active' : ''}`}
          onClick={() => setMode('collection')}
        >
          My collection
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'scryfall'}
          className={`card-search-tab${mode === 'scryfall' ? ' active' : ''}`}
          onClick={() => setMode('scryfall')}
        >
          Scryfall
        </button>
      </div>

      <div className="card-search-input-row">
        <input
          ref={inputRef}
          type="search"
          className="card-search-input"
          placeholder={
            mode === 'collection' ? 'Search your collection…' : 'Search all of Scryfall…'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={mode === 'collection' ? 'Search your collection' : 'Search Scryfall'}
          aria-controls="card-search-results"
          aria-activedescendant={visibleCount > 0 ? `card-search-result-${activeIndex}` : undefined}
        />
        {mode === 'collection' && (
          <CollectionFiltersDialog
            supertypeExpr={supertypeExpr}
            setSupertypeExpr={setSupertypeExpr}
            typesExpr={typesExpr}
            setTypesExpr={setTypesExpr}
            subtypeExpr={subtypeExpr}
            setSubtypeExpr={setSubtypeExpr}
            subtypeSuggestions={subtypeSuggestions}
            colorFilter={colorFilter}
            setColorFilter={setColorFilter}
            colorOptions={COLOR_FILTERS}
            rarityExpr={rarityExpr}
            setRarityExpr={setRarityExpr}
            rarities={RARITIES}
            oracleExpr={oracleExpr}
            setOracleExpr={setOracleExpr}
            legalityExpr={legalityExpr}
            setLegalityExpr={setLegalityExpr}
            layoutExpr={layoutExpr}
            setLayoutExpr={setLayoutExpr}
            treatmentExpr={treatmentExpr}
            setTreatmentExpr={setTreatmentExpr}
            borderExpr={borderExpr}
            setBorderExpr={setBorderExpr}
            setFilter={setFilter}
            setSetFilter={setSetFilter}
            setMap={setMap}
            activeCount={activeFilterCount}
          />
        )}
      </div>
      <p className="card-search-hint" aria-hidden>
        ↑ ↓ to navigate · Enter to add · Esc to close
      </p>

      {mode === 'collection' ? (
        <CollectionResults
          deckId={deckId}
          colorIdentity={commanderColorIdentity}
          existingCardCounts={existingCardCounts}
          query={query}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          onAdd={onAdd}
          onAnnounce={handleAnnounce}
          publishVisible={(cards, addAt) => {
            visibleResultsRef.current = cards;
            addCurrentRef.current = addAt;
            setVisibleCount(cards.length);
          }}
          compiledSupertype={compiledSupertype}
          compiledTypes={compiledTypes}
          compiledSubtype={compiledSubtype}
          compiledRarity={compiledRarity}
          compiledOracle={compiledOracle}
          compiledLegality={compiledLegality}
          compiledLayout={compiledLayout}
          compiledTreatment={compiledTreatment}
          compiledBorder={compiledBorder}
          colorFilter={colorFilter}
          setFilter={setFilter}
        />
      ) : (
        <ScryfallResults
          deckId={deckId}
          colorIdentity={commanderColorIdentity}
          existingCardCounts={existingCardCounts}
          query={query}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          onAdd={onAdd}
          onAnnounce={handleAnnounce}
          publishVisible={(cards, addAt) => {
            visibleResultsRef.current = cards;
            addCurrentRef.current = addAt;
            setVisibleCount(cards.length);
          }}
        />
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
});

interface ResultsProps {
  deckId: string;
  colorIdentity: string[];
  existingCardCounts: Map<string, number>;
  query: string;
  activeIndex: number;
  onActiveChange: (i: number) => void;
  onAdd: (choice: AddCardChoice) => void;
  onAnnounce: (msg: string) => void;
  publishVisible: (cards: ScryfallCard[], addAt: (index: number) => Promise<void> | void) => void;
}

interface CollectionResultsProps extends ResultsProps {
  // Optional pre-compiled chip expressions + the color/set sets.
  // CollectionResults applies them to the substring/CI-filtered list.
  // Absent for the Scryfall tab — only the Collection tab routes them in.
  compiledSupertype: ReturnType<typeof compileExpression>;
  compiledTypes: ReturnType<typeof compileExpression>;
  compiledSubtype: ReturnType<typeof compileExpression>;
  compiledRarity: ReturnType<typeof compileExpression>;
  compiledOracle: ReturnType<typeof compileExpression>;
  compiledLegality: ReturnType<typeof compileExpression>;
  compiledLayout: ReturnType<typeof compileExpression>;
  compiledTreatment: ReturnType<typeof compileExpression>;
  compiledBorder: ReturnType<typeof compileExpression>;
  colorFilter: Set<string>;
  setFilter: Set<string>;
}

// ── Collection results ───────────────────────────────────────────────────
function CollectionResults({
  deckId: _deckId,
  colorIdentity,
  existingCardCounts,
  query,
  activeIndex,
  onActiveChange,
  onAdd,
  onAnnounce,
  publishVisible,
  compiledSupertype,
  compiledTypes,
  compiledSubtype,
  compiledRarity,
  compiledOracle,
  compiledLegality,
  compiledLayout,
  compiledTreatment,
  compiledBorder,
  colorFilter,
  setFilter,
}: CollectionResultsProps) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);

  const filtered = useMemo(() => {
    const nq = normalizeForSearch(query);
    const seenNames = new Set<string>();
    const out: EnrichedCard[] = [];
    for (const c of collection) {
      const ci = c.colorIdentity ?? [];
      if (!ci.every((k) => colorIdentity.includes(k))) continue;
      const legality = c.legalities?.commander;
      if (legality && legality !== 'legal' && legality !== 'restricted') continue;
      if (nq && !normalizeForSearch(c.name).includes(nq)) continue;

      // User-authored chip-expression filters from the filter dialog.
      // Color filter additionally narrows the commander-CI-constrained
      // set; e.g. a Naya commander + "blue" chip yields zero matches
      // (correct — Naya can't run blue cards anyway).
      if (colorFilter.size > 0) {
        const k = (ci.length === 0 ? 'C' : ci[0]) as string;
        const matches =
          (k === 'C' && colorFilter.has('C')) ||
          ci.some((kk) => colorFilter.has(kk)) ||
          (k !== 'C' && colorFilter.has(k));
        if (!matches) continue;
      }
      if (compiledSupertype || compiledTypes || compiledSubtype) {
        const parsed = parseTypeLine(c.typeLine);
        if (compiledSupertype && !setMatchesExpression(parsed.supertypes, compiledSupertype))
          continue;
        if (compiledTypes && !setMatchesExpression(parsed.types, compiledTypes)) continue;
        if (compiledSubtype) {
          const joined = parsed.subtypes.join(' ');
          if (!substringMatchesExpression(joined, compiledSubtype)) continue;
        }
      }
      if (compiledRarity && !exactMatchesExpression(c.rarity, compiledRarity)) continue;
      if (compiledOracle && !substringMatchesExpression(c.oracleText, compiledOracle)) continue;
      if (compiledLegality && !legalityMatchesExpression(c.legalities, compiledLegality)) continue;
      if (compiledLayout && !exactMatchesExpression(c.layout, compiledLayout)) continue;
      if (compiledTreatment && !setMatchesExpression(effectiveTreatments(c), compiledTreatment))
        continue;
      if (compiledBorder && !exactMatchesExpression(c.borderColor, compiledBorder)) continue;
      if (setFilter.size > 0 && !setFilter.has((c.setCode || '').toUpperCase())) continue;

      if (seenNames.has(c.name)) continue;
      seenNames.add(c.name);
      out.push(c);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, 200);
  }, [
    collection,
    colorIdentity,
    query,
    compiledSupertype,
    compiledTypes,
    compiledSubtype,
    compiledRarity,
    compiledOracle,
    compiledLegality,
    compiledLayout,
    compiledTreatment,
    compiledBorder,
    colorFilter,
    setFilter,
  ]);

  const addAtIndex = async (index: number) => {
    const c = filtered[index];
    if (!c) return;
    const full = await getCardByName(c.name).catch(() => null);
    if (!full) return;
    const claim = pickCollectionCopy(c.name, collection, allocations, c.scryfallId);
    onAdd({ card: full, allocatedCopyId: claim?.copyId ?? null });
    onAnnounce(`Added ${c.name}`);
  };

  // Publish visible results so the parent's Enter handler can add the
  // currently-active row. We can't drive the parent input from here directly,
  // so we hand it a closure.
  useEffect(() => {
    // Convert EnrichedCards to a thin ScryfallCard-ish list; we only need the
    // length / order on the parent side.
    publishVisible(
      filtered.map((c) => ({ name: c.name }) as unknown as ScryfallCard),
      addAtIndex
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  if (collection.length === 0) {
    return (
      <p className="card-search-empty">
        Your collection is empty. Import cards on the Collection page first.
      </p>
    );
  }
  if (filtered.length === 0) {
    return <p className="card-search-empty">No matches in your collection.</p>;
  }

  return (
    <ul className="card-search-results" id="card-search-results" role="listbox">
      {filtered.map((c, i) => {
        const ownedCount = collection.filter((x) => x.name === c.name).length;
        const inDeck = existingCardCounts.get(c.name) ?? 0;
        const active = i === activeIndex;
        return (
          <li
            key={c.scryfallId}
            id={`card-search-result-${i}`}
            role="option"
            aria-selected={active}
            className={`card-search-row${active ? ' active' : ''}`}
            onMouseEnter={() => onActiveChange(i)}
          >
            <button
              type="button"
              className="card-search-add"
              aria-label={inDeck > 0 ? `Add another ${c.name}` : `Add ${c.name}`}
              onClick={() => addAtIndex(i)}
            >
              +
            </button>
            <span className="card-search-name">{c.name}</span>
            {c.manaCost && <ManaCost cost={c.manaCost} className="card-search-mana" />}
            <span className="card-search-meta">
              owned {ownedCount}
              {inDeck > 0 && (
                <>
                  {' · '}
                  <span className="card-search-indeck">in deck × {inDeck}</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Scryfall results ─────────────────────────────────────────────────────
function ScryfallResults({
  deckId: _deckId,
  colorIdentity,
  existingCardCounts,
  query,
  activeIndex,
  onActiveChange,
  onAdd,
  onAnnounce,
  publishVisible,
}: ResultsProps) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);

  const pushToast = useToastsStore((s) => s.push);

  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);
  const ownedNames = useMemo(() => new Set(collection.map((c) => c.name)), [collection]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setError(null);
          setResults([]);
        }
        return;
      }
      if (debounce.current) window.clearTimeout(debounce.current);
      await new Promise<void>((resolve) => {
        debounce.current = window.setTimeout(resolve, 300);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        // Skip the color-identity filter so off-color cards still appear —
        // they're tagged in the row UI and an add-time warning lets the user
        // know they're outside the deck's color identity.
        const resp = await searchCards(q, colorIdentity, { skipColorFilter: true });
        if (!cancelled) setResults(resp.data.slice(0, 60));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query, colorIdentity]);

  const addAtIndex = (index: number) => {
    const c = results[index];
    if (!c) return;
    const owned = ownedNames.has(c.name);
    const claim = owned ? pickCollectionCopy(c.name, collection, allocations, c.id) : null;
    onAdd({ card: c, allocatedCopyId: claim?.copyId ?? null });
    onAnnounce(`Added ${c.name}`);
    if (isOffColor(c.color_identity, colorIdentity)) {
      pushToast({
        message: `${c.name} is outside your commander's color identity`,
        tone: 'warn',
      });
    }
  };

  useEffect(() => {
    publishVisible(results, addAtIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  if (query.trim().length < 2) {
    return <p className="card-search-empty">Type at least two characters to search Scryfall.</p>;
  }
  if (loading) {
    return <p className="card-search-empty">Searching…</p>;
  }
  if (error) {
    return <p className="card-search-empty card-search-error">{error}</p>;
  }
  if (results.length === 0) {
    return <p className="card-search-empty">No matches.</p>;
  }

  return (
    <ul className="card-search-results" id="card-search-results" role="listbox">
      {results.map((c, i) => {
        const inDeck = existingCardCounts.get(c.name) ?? 0;
        const owned = ownedNames.has(c.name);
        const active = i === activeIndex;
        const offColor = isOffColor(c.color_identity, colorIdentity);
        return (
          <li
            key={c.id}
            id={`card-search-result-${i}`}
            role="option"
            aria-selected={active}
            className={`card-search-row${active ? ' active' : ''}${offColor ? ' is-off-color' : ''}`}
            onMouseEnter={() => onActiveChange(i)}
          >
            <button
              type="button"
              className="card-search-add"
              aria-label={
                offColor
                  ? `Add ${c.name} (off-color)`
                  : inDeck > 0
                    ? `Add another ${c.name}`
                    : `Add ${c.name}`
              }
              onClick={() => addAtIndex(i)}
            >
              +
            </button>
            <span className="card-search-name">{c.name}</span>
            {c.mana_cost && <ManaCost cost={c.mana_cost} className="card-search-mana" />}
            <span className="card-search-meta">
              {offColor && (
                <span
                  className="card-search-badge card-search-badge--warn"
                  title="Outside your commander's color identity"
                >
                  Off-color
                </span>
              )}
              {owned ? 'owned' : 'not owned'}
              {inDeck > 0 && (
                <>
                  {' · '}
                  <span className="card-search-indeck">in deck × {inDeck}</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
