import { Shuffle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  searchCommanders,
  getCardByName,
  getOwnedPrinting,
} from '@/deck-builder/services/scryfall/client';
import {
  fetchTopCommanders,
  fetchAllCommanderNames,
  fetchCommandersIncludingColors,
  fetchCommanderData,
  fetchPlaystyleCommanders,
} from '@/deck-builder/services/edhrec/client';
import type { ScryfallCard, EDHRECTopCommander } from '@/deck-builder/types';
import { useCollectionStore } from '../../store/collection';
import { normalizeForSearch } from '../../lib/normalize-search';
import {
  computeReadiness,
  extractCommanderCandidates,
  type ReadinessScore,
} from '../../lib/commander-readiness';
import {
  classifyCommanderPlaystyles,
  classifyOwnedCommanderPlaystyles,
  type Playstyle,
} from '../../lib/commander-playstyle-index';
import { CommanderReadiness } from './CommanderReadiness';
import { PlaystyleGrid } from './PlaystyleGrid';
import { CommanderResultCard } from './CommanderResultCard';
import type { EnrichedCard } from '../../types';
import { ManaCost } from '../ManaCost';
import { ColorPip } from '../shared/ManaSymbol';
import { Tabs } from '../Tabs';
import { SearchPill } from '../SearchPill';
import { InfoTip } from '../InfoTip';

interface Props {
  value: ScryfallCard | null;
  onSelect: (card: ScryfallCard | null) => void;
}

const WUBRG_ORDER = 'WUBRGC';
const COLORS: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = ['W', 'U', 'B', 'R', 'G', 'C'];
const COLOR_LABEL: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};
// Map a sorted color key (e.g. "UBR") to its canonical MTG color-combo name.
const COLOR_COMBO: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
  WU: 'Azorius',
  WB: 'Orzhov',
  WR: 'Boros',
  WG: 'Selesnya',
  UB: 'Dimir',
  UR: 'Izzet',
  UG: 'Simic',
  BR: 'Rakdos',
  BG: 'Golgari',
  RG: 'Gruul',
  WUB: 'Esper',
  WUR: 'Jeskai',
  WUG: 'Bant',
  WBR: 'Mardu',
  WBG: 'Abzan',
  WRG: 'Naya',
  UBR: 'Grixis',
  UBG: 'Sultai',
  URG: 'Temur',
  BRG: 'Jund',
  WUBR: 'Yore-Tiller',
  WUBG: 'Witch-Maw',
  WURG: 'Ink-Treader',
  WBRG: 'Dune-Brood',
  UBRG: 'Glint-Eye',
  WUBRG: 'Five-Color',
};

const OWNED_ONLY_KEY = 'commander-search-owned-only';
const COLOR_FILTER_KEY = 'commander-search-color-filter';
const SEARCH_MODE_KEY = 'commander-search-mode';

// How many commanders to show before the "Show more" expander. Keeps the
// inline-growing panel short until the user opts into the full list.
const PLAYSTYLE_PREVIEW_COUNT = 10;

type SearchMode = 'name' | 'playstyle';

/**
 * The WUBRG + Colorless pip filter, shared by the by-name suggestions and the
 * by-playstyle browser so both read and write the same `colorFilter`. Colorless
 * is mutually exclusive with the five colors (a colorless commander has no color
 * identity).
 */
function ColorPips({
  colorFilter,
  setColorFilter,
}: {
  colorFilter: Set<string>;
  setColorFilter: (update: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
}) {
  return (
    <div className="commander-color-filter" role="group" aria-label="Filter by color identity">
      {COLORS.map((c) => {
        const active = colorFilter.has(c);
        return (
          <button
            key={c}
            type="button"
            className={`commander-color-pip${active ? ' active' : ''}`}
            aria-pressed={active}
            aria-label={COLOR_LABEL[c]}
            title={COLOR_LABEL[c]}
            onClick={() =>
              setColorFilter((prev) => {
                const next = new Set(prev);
                if (next.has(c)) {
                  next.delete(c);
                } else {
                  next.add(c);
                  if (c === 'C') {
                    for (const other of next) if (other !== 'C') next.delete(other);
                  } else {
                    next.delete('C');
                  }
                }
                return next;
              })
            }
          >
            <ColorPip color={c} pip={false} />
          </button>
        );
      })}
      {colorFilter.size > 0 && (
        <button
          type="button"
          className="commander-color-clear"
          onClick={() => setColorFilter(new Set())}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function getColorFilterLabel(colors: Set<string>): string {
  if (colors.size === 0) return 'Top';
  const sorted = [...colors]
    .sort((a, b) => WUBRG_ORDER.indexOf(a) - WUBRG_ORDER.indexOf(b))
    .join('');
  const name = COLOR_COMBO[sorted];
  return name ? `Top ${name}` : 'Top';
}

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function CommanderSearch({ value, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [randomLoading, setRandomLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const collectionCards = useCollectionStore((s) => s.cards);
  // The collection stores one row per physical copy, so a card owned in
  // multiples (or across printings) appears many times. Commander selection
  // only cares about the card identity, so de-dup by name — otherwise the
  // search dropdown, Random pool and suggestion chips all show repeats.
  // Uses the shared `isCommanderEligible` (via extractCommanderCandidates) so
  // detection can't drift from binder routing — this also catches non-creature
  // commanders ("can be your commander" planeswalkers/backgrounds) that a bare
  // legendary-creature type-line check would miss.
  const collectionLegends = useMemo(
    () => extractCommanderCandidates(collectionCards),
    [collectionCards]
  );
  const ownedNames = useMemo(
    () => new Set(collectionLegends.map((c) => c.name)),
    [collectionLegends]
  );
  // All owned card names (lowercased) — readiness measures a commander's staples
  // against the *whole* collection, not just its legends.
  const ownedCardNames = useMemo(
    () => new Set(collectionCards.map((c) => c.name.toLowerCase())),
    [collectionCards]
  );

  // Collection readiness per commander, fetched lazily when a result is
  // highlighted (hover/focus) or selected — so typing never triggers a burst of
  // throttled EDHREC requests. Keyed by lowercased name; deduped via refs.
  const [readiness, setReadiness] = useState<Map<string, ReadinessScore | 'loading'>>(new Map());
  const readinessInflight = useRef<Set<string>>(new Set());
  const readinessDone = useRef<Set<string>>(new Set());
  const ensureReadiness = useCallback(
    async (name: string): Promise<void> => {
      const key = name.toLowerCase();
      if (readinessDone.current.has(key) || readinessInflight.current.has(key)) return;
      readinessInflight.current.add(key);
      setReadiness((prev) => new Map(prev).set(key, 'loading'));
      try {
        const data = await fetchCommanderData(name);
        const score = computeReadiness(data.cardlists.allNonLand, ownedCardNames, name);
        readinessDone.current.add(key);
        setReadiness((prev) => new Map(prev).set(key, score));
      } catch {
        readinessDone.current.add(key);
        setReadiness((prev) => new Map(prev).set(key, computeReadiness([], ownedCardNames, name)));
      } finally {
        readinessInflight.current.delete(key);
      }
    },
    [ownedCardNames]
  );

  // Resolve readiness for the selected commander (covers prefilled selections);
  // a prior hover usually cached it already, so this is instant.
  useEffect(() => {
    if (!value) return;
    void (async () => {
      await ensureReadiness(value.name);
    })();
  }, [value, ensureReadiness]);
  const selectedReadiness = value ? readiness.get(value.name.toLowerCase()) : undefined;

  const [ownedOnly, setOwnedOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OWNED_ONLY_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [colorFilter, setColorFilterState] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLOR_FILTER_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const setColorFilter = (update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setColorFilterState((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      try {
        localStorage.setItem(COLOR_FILTER_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Top commanders from EDHREC, filtered by colorFilter. Kept loaded so the
  // empty-query state always has chips to click. (Reference repo refetches
  // on every filter change — we mirror that.)
  const [topCommanders, setTopCommanders] = useState<EDHRECTopCommander[]>([]);
  const [topLoading, setTopLoading] = useState(false);
  const [showAllTopCommanders, setShowAllTopCommanders] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) setTopLoading(true);
      try {
        const data = await fetchTopCommanders([...colorFilter]);
        if (!cancelled) setTopCommanders(data);
      } catch {
        if (!cancelled) setTopCommanders([]);
      } finally {
        if (!cancelled) setTopLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [colorFilter]);

  // Local search results (owned mode). Kept in state so the dropdown can read
  // it without recomputing on every render. Declared before the search effect
  // so setLocalResults is in scope when the effect uses it.
  const [localResults, setLocalResults] = useState<EnrichedCard[]>([]);
  const [showAllNameResults, setShowAllNameResults] = useState(false);

  // Reset local results when switching out of owned-only mode.
  const [prevOwnedOnly, setPrevOwnedOnly] = useState(ownedOnly);
  if (prevOwnedOnly !== ownedOnly) {
    setPrevOwnedOnly(ownedOnly);
    if (!ownedOnly) setLocalResults([]);
  }

  // The panel below the input sizes to its content and only grows downward,
  // so the input never moves. `queried` decides *what* the panel shows —
  // results vs. EDHREC suggestions.
  const queried = query.trim().length >= 2;

  // Search effect — switches source by ownedOnly. Scryfall when off, local
  // collection-legend filter when on.
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
      if (ownedOnly) {
        const nq = normalizeForSearch(q);
        // Rank hits so the closest match leads: exact name, then prefix, then
        // any substring; ties broken alphabetically. Ranking folds punctuation
        // the same way the filter does so "mr house" still ranks "Mr. House"
        // as an exact hit.
        const rank = (name: string): number => {
          const n = normalizeForSearch(name);
          if (n === nq) return 0;
          if (n.startsWith(nq)) return 1;
          return 2;
        };
        const matched = collectionLegends
          .filter((c) => normalizeForSearch(c.name).includes(nq))
          .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
        // Resolve full ScryfallCards lazily — we don't need them in the list,
        // just for the final selection. Show owned legends as a name+type list.
        // To keep typing snappy we don't pre-fetch; click handler hits Scryfall.
        if (!cancelled) {
          setError(null);
          setResults([]); // not used for owned mode; we render `localResults` directly
          // store local results into a separate memo via state to avoid rerender churn:
          setLocalResults(matched.slice(0, 12));
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, 220);
      });
      if (cancelled) return;
      setSearchLoading(true);
      setError(null);
      try {
        const cards = await searchCommanders(q);
        if (!cancelled) setResults(cards.slice(0, 12));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, ownedOnly, collectionLegends]);

  // Filter top commanders: hide split-card "//" entries; in owned mode,
  // surface only those the user actually has so the chip row reads as
  // "what can I build right now" rather than aspirational.
  // NOTE: this useMemo MUST live above the `if (value) return` below — moving
  // it past the early return would mismatch the hooks count when the user
  // picks a commander.
  const visibleTop = useMemo(() => {
    const base = topCommanders.filter((c) => !c.name.includes('//'));
    if (!ownedOnly) return base;

    const owned = base.filter((c) => ownedNames.has(c.name));
    const MIN = 10;
    if (owned.length >= MIN) return owned;

    // Pad with the user's other owned legends so the empty-query state isn't
    // sparse just because their owned legends rarely overlap with EDHREC's top
    // list. Respect the same exact-match color filter Surprise-me uses.
    const seen = new Set(owned.map((c) => c.name));
    const fillerSource = collectionLegends.filter((c) => {
      if (seen.has(c.name)) return false;
      if (colorFilter.size === 0) return true;
      const ci = c.colorIdentity ?? [];
      if (ci.length !== colorFilter.size) return false;
      return ci.every((color) => colorFilter.has(color));
    });

    const filler: EDHRECTopCommander[] = fillerSource.slice(0, MIN - owned.length).map((c, i) => ({
      rank: owned.length + i + 1,
      name: c.name,
      sanitized: c.scryfallId ?? c.name,
      colorIdentity: c.colorIdentity ?? [],
      numDecks: 0,
    }));

    return [...owned, ...filler];
  }, [topCommanders, ownedOnly, ownedNames, collectionLegends, colorFilter]);
  const topResultKey = `${ownedOnly}|${[...colorFilter].sort().join('')}|${visibleTop
    .map((c) => c.name)
    .join('|')}`;
  const [prevTopResultKey, setPrevTopResultKey] = useState(topResultKey);
  if (prevTopResultKey !== topResultKey) {
    setPrevTopResultKey(topResultKey);
    setShowAllTopCommanders(false);
  }

  // Eager-load readiness for the recommended pills — a small, bounded set (≤12)
  // shown without typing, so a sequential throttled fetch is affordable and the
  // pills show a spinner → % instead of staying blank until hovered. (Search
  // *results* stay lazy-on-hover, since those churn per keystroke.)
  useEffect(() => {
    if (visibleTop.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const c of visibleTop.slice(0, 12)) {
        if (cancelled) return;
        await ensureReadiness(c.name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleTop, ensureReadiness]);

  // ── By-playstyle discovery ────────────────────────────────────────────
  // A second facet alongside name search: pick a playstyle (aristocrats,
  // tokens, voltron, …) and browse the commanders that do it best.
  const [searchMode, setSearchMode] = useState<SearchMode>(() => {
    try {
      return localStorage.getItem(SEARCH_MODE_KEY) === 'playstyle' ? 'playstyle' : 'name';
    } catch {
      return 'name';
    }
  });
  const changeMode = (mode: SearchMode) => {
    setSearchMode(mode);
    try {
      localStorage.setItem(SEARCH_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };
  const [playstyle, setPlaystyle] = useState<Playstyle | null>(null);
  const [playstyleCommanders, setPlaystyleCommanders] = useState<EDHRECTopCommander[]>([]);
  const [playstyleLoading, setPlaystyleLoading] = useState(false);
  // Browse list is collapsed to PLAYSTYLE_PREVIEW_COUNT until "Show more"; reset
  // to collapsed whenever the result set's identity changes. Render-phase reset
  // (the React-recommended pattern, same as `prevOwnedOnly` below) rather than a
  // setState-in-effect, which would cascade renders.
  const [showAllPlaystyle, setShowAllPlaystyle] = useState(false);
  const playstyleResultKey = `${playstyle?.id ?? ''}|${ownedOnly}|${[...colorFilter].sort().join('')}`;
  const [prevPlaystyleResultKey, setPrevPlaystyleResultKey] = useState(playstyleResultKey);
  if (prevPlaystyleResultKey !== playstyleResultKey) {
    setPrevPlaystyleResultKey(playstyleResultKey);
    setShowAllPlaystyle(false);
  }

  // Local playstyle classification of the user's own legendary creatures — pure,
  // instant, offline. Owned-mode browsing reads this instead of EDHREC so it can
  // surface owned commanders that aren't in EDHREC's top-N for a tag.
  const ownedByPlaystyle = useMemo(() => {
    const map = new Map<string, EnrichedCard[]>();
    for (const legend of collectionLegends) {
      for (const { playstyle: ps } of classifyOwnedCommanderPlaystyles(legend)) {
        const bucket = map.get(ps.id);
        if (bucket) bucket.push(legend);
        else map.set(ps.id, [legend]);
      }
    }
    return map;
  }, [collectionLegends]);

  // Aspirational browse: fetch EDHREC's top commanders for the chosen playstyle.
  // Owned mode skips the network entirely (uses the local index above).
  useEffect(() => {
    if (searchMode !== 'playstyle' || !playstyle || ownedOnly) return;
    let cancelled = false;
    const slug = playstyle.edhrecSlug;
    void (async () => {
      setPlaystyleLoading(true);
      setPlaystyleCommanders([]);
      try {
        const list = await fetchPlaystyleCommanders(slug);
        if (!cancelled) setPlaystyleCommanders(list);
      } catch {
        if (!cancelled) setPlaystyleCommanders([]);
      } finally {
        if (!cancelled) setPlaystyleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchMode, playstyle, ownedOnly]);

  // Commanders shown for the chosen playstyle, narrowed by the color pips.
  // Within-identity match: a color filter shows commanders castable in those
  // colors (a mono-black commander still shows under a B/G filter).
  const playstyleResults = useMemo(() => {
    if (searchMode !== 'playstyle' || !playstyle) return [];
    const matchesColor = (ci: string[]): boolean => {
      if (colorFilter.size === 0) return true;
      const ident = ci.length > 0 ? ci : ['C'];
      return ident.every((color) => colorFilter.has(color));
    };
    if (ownedOnly) {
      return (ownedByPlaystyle.get(playstyle.id) ?? [])
        .filter((c) => matchesColor(c.colorIdentity ?? []))
        .map((c) => ({
          name: c.name,
          colors: c.colorIdentity && c.colorIdentity.length > 0 ? c.colorIdentity : ['C'],
          key: c.scryfallId ?? c.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return playstyleCommanders
      .filter((c) => !c.name.includes('//') && matchesColor(c.colorIdentity))
      .map((c) => ({
        name: c.name,
        colors: c.colorIdentity.length > 0 ? c.colorIdentity : ['C'],
        key: c.sanitized || c.name,
      }));
  }, [searchMode, playstyle, ownedOnly, ownedByPlaystyle, playstyleCommanders, colorFilter]);

  // Eager-load readiness for the visible playstyle commanders (bounded set),
  // mirroring the recommended-pills behavior so the % shows without hovering.
  useEffect(() => {
    if (searchMode !== 'playstyle' || playstyleResults.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const c of playstyleResults.slice(0, 12)) {
        if (cancelled) return;
        await ensureReadiness(c.name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchMode, playstyleResults, ensureReadiness]);

  const nameResults = ownedOnly ? localResults : results;
  const nameResultKey = `${ownedOnly}|${query.trim()}|${nameResults
    .map((card) => ('scryfallId' in card ? card.scryfallId : card.id))
    .join('|')}`;
  const [prevNameResultKey, setPrevNameResultKey] = useState(nameResultKey);
  if (prevNameResultKey !== nameResultKey) {
    setPrevNameResultKey(nameResultKey);
    setShowAllNameResults(false);
  }
  const visibleRemoteResults = showAllNameResults
    ? results
    : results.slice(0, PLAYSTYLE_PREVIEW_COUNT);
  const visibleLocalResults = showAllNameResults
    ? localResults
    : localResults.slice(0, PLAYSTYLE_PREVIEW_COUNT);

  // ── Selection handlers ────────────────────────────────────────────────
  const selectCard = (card: ScryfallCard) => {
    onSelect(card);
    setQuery('');
    setResults([]);
    setLocalResults([]);
  };

  const selectByName = async (name: string) => {
    setSearchLoading(true);
    setError(null);
    try {
      const card = await getCardByName(name, true);
      selectCard(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load card");
    } finally {
      setSearchLoading(false);
    }
  };

  // Owned-mode selection. Resolve the user's *exact* printing (by its
  // scryfallId) rather than the cheapest one `getCardByName` would return, so
  // the generated deck binds the physical copy they picked — right printing and
  // finish. The allocator keys on `card.id` (see pickCollectionCopy), so this
  // is what makes "build from my collection" honor the copy on screen.
  const selectOwnedCard = async (owned: EnrichedCard) => {
    setSearchLoading(true);
    setError(null);
    try {
      const card = await getOwnedPrinting(owned.scryfallId, owned.name);
      selectCard(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load card");
    } finally {
      setSearchLoading(false);
    }
  };

  // Owned suggestion chips carry only a name (EDHREC payload), so map back to
  // the owned copy to resolve its printing; fall back to name resolution if the
  // name somehow isn't in the collection (shouldn't happen in owned mode).
  const selectOwnedByName = async (name: string) => {
    const owned = collectionLegends.find((c) => c.name === name);
    if (owned) {
      await selectOwnedCard(owned);
    } else {
      await selectByName(name);
    }
  };

  // Surprise me — random pick, respecting owned-only and color filter.
  const handleSurpriseMe = async () => {
    setError(null);
    setRandomLoading(true);
    try {
      if (ownedOnly) {
        const pool = collectionLegends.filter((c) => {
          if (colorFilter.size === 0) return true;
          const ci = c.colorIdentity ?? [];
          // Exact-match: a single-color filter shouldn't surface multicolor
          // commanders that just happen to include that color.
          if (ci.length !== colorFilter.size) return false;
          return ci.every((color) => colorFilter.has(color));
        });
        const fallback =
          colorFilter.size > 0 && pool.length === 0
            ? collectionLegends.filter((c) => {
                const ci = c.colorIdentity ?? [];
                return ci.every((color) => colorFilter.has(color));
              })
            : pool;
        const pick = pickRandom(fallback.length > 0 ? fallback : collectionLegends);
        if (!pick) {
          setError('No legendary creatures in your collection match that filter.');
          return;
        }
        await selectOwnedCard(pick);
        return;
      }
      // Online — pick from the EDHREC commander list, narrowed by color.
      if (colorFilter.size > 0) {
        const all = await fetchCommandersIncludingColors([...colorFilter]);
        const exact = all.filter(
          (c) =>
            c.colorIdentity.length === colorFilter.size &&
            c.colorIdentity.every((color) => colorFilter.has(color))
        );
        const pool = exact.length > 0 ? exact : all;
        const pick = pickRandom(pool);
        if (!pick) {
          setError('No commanders matched that color filter.');
          return;
        }
        await selectByName(pick.name);
      } else {
        const names = await fetchAllCommanderNames();
        const filtered = names.filter((n) => !n.includes('//'));
        const pick = pickRandom(filtered);
        if (!pick) {
          setError("Couldn't load EDHREC commander list.");
          return;
        }
        await selectByName(pick);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Random pick failed');
    } finally {
      setRandomLoading(false);
    }
  };

  // ── Selected commander view ───────────────────────────────────────────
  if (value) {
    // Two-faced commanders (DFCs, MDFCs) keep their oracle text on the
    // card_faces array, not on the top-level card. Prefer the top-level
    // values; fall back to the front face. We don't try to render both
    // faces — that's reserved for the card preview modal.
    const front = value.card_faces?.[0];
    const manaCost = value.mana_cost ?? front?.mana_cost ?? '';
    const oracleText = value.oracle_text ?? front?.oracle_text ?? '';
    const power = value.power ?? front?.power;
    const toughness = value.toughness ?? front?.toughness;
    const loyalty = value.loyalty;
    // Detected playstyles (top 3) — an explainable "how this deck wins" read,
    // and a bridge to the By-playstyle browser.
    const playstyleMatches = classifyCommanderPlaystyles(value).slice(0, 3);
    return (
      <div className="commander-pick">
        <img
          className="commander-pick-art"
          src={
            value.image_uris?.normal ??
            value.card_faces?.[0]?.image_uris?.normal ??
            value.image_uris?.large ??
            value.image_uris?.art_crop ??
            value.card_faces?.[0]?.image_uris?.art_crop
          }
          alt=""
          aria-hidden="true"
        />
        <div className="commander-pick-body">
          <div className="commander-pick-headline">
            <span className="commander-pick-name">{value.name}</span>
            {manaCost && <ManaCost cost={manaCost} className="commander-pick-mana" />}
            {power && toughness && (
              <span className="commander-pick-stat">
                <span className="commander-pick-stat-value">
                  {power}/{toughness}
                </span>
              </span>
            )}
            {loyalty && (
              <span className="commander-pick-stat">
                <span className="commander-pick-stat-label">Loyalty</span>
                <span className="commander-pick-stat-value">{loyalty}</span>
              </span>
            )}
          </div>
          <div className="commander-pick-type">{value.type_line}</div>
          {oracleText && (
            <div className="commander-pick-oracle">
              {oracleText.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
          {playstyleMatches.length > 0 && (
            <div className="commander-pick-playstyles">
              <span className="commander-pick-playstyles-label">
                Plays like
                <InfoTip
                  label="Plays like"
                  text="Playstyles detected from this commander's rules text — a quick read on how the deck wants to win. Switch to the “By playstyle” tab to find more commanders like this."
                />
              </span>
              {playstyleMatches.map((m) => (
                <span key={m.playstyle.id} className="commander-pick-playstyle-tag">
                  {m.playstyle.label}
                </span>
              ))}
            </div>
          )}
          <div className="commander-pick-readiness">
            <CommanderReadiness
              score={selectedReadiness === 'loading' ? undefined : selectedReadiness}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn commander-pick-change"
          onClick={() => {
            onSelect(null);
            setQuery('');
            setResults([]);
            setLocalResults([]);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  // ── Search UI ─────────────────────────────────────────────────────────
  const listboxId = 'commander-search-listbox';
  const resultItems = (
    <>
      <ul className="commander-result-grid" role="listbox" id={listboxId}>
        {searchLoading && <li className="commander-search-loading">Searching…</li>}
        {!ownedOnly &&
          visibleRemoteResults.map((card) => (
            <li key={card.id}>
              <CommanderResultCard
                name={card.name}
                imageUrl={card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small}
                colors={card.color_identity}
                typeLine={card.type_line}
                readiness={readiness.get(card.name.toLowerCase())}
                onSelect={() => selectCard(card)}
                onPeek={() => void ensureReadiness(card.name)}
              />
            </li>
          ))}
        {ownedOnly &&
          visibleLocalResults.map((card) => (
            <li key={card.scryfallId}>
              <CommanderResultCard
                name={card.name}
                imageUrl={card.imageSmall}
                colors={card.colorIdentity ?? card.colors ?? []}
                typeLine={card.typeLine ?? 'Legendary Creature'}
                readiness={readiness.get(card.name.toLowerCase())}
                onSelect={() => void selectOwnedCard(card)}
                onPeek={() => void ensureReadiness(card.name)}
              />
            </li>
          ))}
      </ul>
      {nameResults.length > PLAYSTYLE_PREVIEW_COUNT && (
        <button
          type="button"
          className="commander-playstyle-more"
          onClick={() => setShowAllNameResults((v) => !v)}
        >
          {showAllNameResults ? 'Show fewer' : `Show all ${nameResults.length}`}
        </button>
      )}
    </>
  );
  const hasResults = nameResults.length > 0;

  return (
    <div className="commander-search">
      <Tabs
        ariaLabel="Commander search mode"
        variant="underline"
        className="commander-search-modes"
        value={searchMode}
        onChange={changeMode}
        tabs={[
          { id: 'name', label: 'By name', controls: 'commander-search-panel' },
          { id: 'playstyle', label: 'By playstyle', controls: 'commander-search-panel' },
        ]}
      />

      {searchMode === 'name' && (
        <SearchPill
          inputType="text"
          placeholder={ownedOnly ? 'Search your commanders…' : 'Search for a commander…'}
          value={query}
          onChange={setQuery}
          ariaLabel={ownedOnly ? 'Search your commanders' : 'Search for a commander'}
          inputProps={{
            role: 'combobox',
            'aria-expanded': queried,
            'aria-controls': listboxId,
            'aria-autocomplete': 'list',
          }}
        />
      )}

      {/* Owned-only toggle — only visible if the collection has any legends. */}
      {(collectionLegends.length > 0 || ownedOnly) && (
        <label className="commander-owned-toggle">
          <input
            type="checkbox"
            checked={ownedOnly}
            onChange={(e) => {
              const next = e.target.checked;
              setOwnedOnly(next);
              try {
                localStorage.setItem(OWNED_ONLY_KEY, String(next));
              } catch {
                /* ignore */
              }
              setResults([]);
              setLocalResults([]);
            }}
          />
          <span>
            Commanders I own
            {collectionLegends.length > 0 && (
              <span className="commander-owned-count">
                {' '}
                ({collectionLegends.length.toLocaleString()} legend
                {collectionLegends.length === 1 ? '' : 's'})
              </span>
            )}
          </span>
        </label>
      )}

      {/* Readiness legend — explains the % chip and that it loads on hover. */}
      {collectionCards.length > 0 && (
        <p className="commander-readiness-hint">
          The <strong>%</strong> beside a commander is how many of its staple cards you already own
          — hover a commander to load it.
        </p>
      )}

      {/* Results panel: search results when a query is active, EDHREC
          suggestions otherwise. Sizes to its content and grows inline with the
          page, so long lists use page scroll instead of an inner scroll box. */}
      <div
        className="commander-search-panel"
        id="commander-search-panel"
        role="tabpanel"
        aria-labelledby={`sc-tab-${searchMode}`}
      >
        {searchMode === 'playstyle' ? (
          <div className="commander-playstyle-browse">
            {playstyle ? (
              <>
                <div className="playstyle-picker-bar">
                  <button type="button" className="btn-link" onClick={() => setPlaystyle(null)}>
                    ← All play styles
                  </button>
                  <span className="playstyle-picker-current">{playstyle.label}</span>
                </div>
                <p className="commander-suggestions-label">{playstyle.blurb}</p>
                <ColorPips colorFilter={colorFilter} setColorFilter={setColorFilter} />
                {!ownedOnly && playstyleLoading ? (
                  <p className="commander-suggestions-empty">Loading commanders…</p>
                ) : playstyleResults.length === 0 ? (
                  <p className="commander-suggestions-empty">
                    {ownedOnly
                      ? 'None of your commanders fit that playstyle yet.'
                      : 'No commanders found for that playstyle.'}
                  </p>
                ) : (
                  <>
                    <ul className="commander-result-grid">
                      {(showAllPlaystyle
                        ? playstyleResults
                        : playstyleResults.slice(0, PLAYSTYLE_PREVIEW_COUNT)
                      ).map((c) => (
                        <li key={c.key}>
                          <CommanderResultCard
                            name={c.name}
                            colors={c.colors}
                            readiness={readiness.get(c.name.toLowerCase())}
                            disabled={searchLoading}
                            onSelect={() =>
                              void (ownedOnly ? selectOwnedByName(c.name) : selectByName(c.name))
                            }
                            onPeek={() => void ensureReadiness(c.name)}
                          />
                        </li>
                      ))}
                    </ul>
                    {playstyleResults.length > PLAYSTYLE_PREVIEW_COUNT && (
                      <button
                        type="button"
                        className="commander-playstyle-more"
                        onClick={() => setShowAllPlaystyle((v) => !v)}
                      >
                        {showAllPlaystyle ? 'Show fewer' : `Show all ${playstyleResults.length}`}
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <p className="commander-suggestions-hint">
                  Pick how you want to play. We’ll show the commanders that do it best
                  {ownedOnly ? ' from your collection' : ' on EDHREC'}.
                </p>
                <PlaystyleGrid onSelect={setPlaystyle} />
              </>
            )}
          </div>
        ) : queried ? (
          hasResults ? (
            resultItems
          ) : searchLoading ? (
            <p className="commander-search-status">Searching…</p>
          ) : (
            <p className="commander-search-status">No commanders found.</p>
          )
        ) : (
          <div className="commander-suggestions">
            <p className="commander-suggestions-label">
              {getColorFilterLabel(colorFilter)} commanders on EDHREC
              {ownedOnly ? ' (yours)' : ''}:
            </p>
            <ColorPips colorFilter={colorFilter} setColorFilter={setColorFilter} />

            {topLoading && visibleTop.length === 0 ? (
              <p className="commander-suggestions-empty">Loading…</p>
            ) : visibleTop.length === 0 ? (
              <p className="commander-suggestions-empty">
                {ownedOnly
                  ? 'You don’t own any of EDHREC’s top commanders for that filter.'
                  : 'No commanders found.'}
              </p>
            ) : (
              <>
                <ul className="commander-result-grid" aria-busy={topLoading}>
                  {(showAllTopCommanders
                    ? visibleTop
                    : visibleTop.slice(0, PLAYSTYLE_PREVIEW_COUNT)
                  ).map((c) => {
                    const colors = c.colorIdentity.length > 0 ? c.colorIdentity : ['C'];
                    return (
                      <li key={c.sanitized}>
                        <CommanderResultCard
                          name={c.name}
                          colors={colors}
                          readiness={readiness.get(c.name.toLowerCase())}
                          disabled={searchLoading}
                          onSelect={() =>
                            void (ownedOnly ? selectOwnedByName(c.name) : selectByName(c.name))
                          }
                          onPeek={() => void ensureReadiness(c.name)}
                        />
                      </li>
                    );
                  })}
                </ul>
                {visibleTop.length > PLAYSTYLE_PREVIEW_COUNT && (
                  <button
                    type="button"
                    className="commander-playstyle-more"
                    onClick={() => setShowAllTopCommanders((v) => !v)}
                  >
                    {showAllTopCommanders ? 'Show fewer' : `Show all ${visibleTop.length}`}
                  </button>
                )}
              </>
            )}

            <div className="commander-surprise">
              <button
                type="button"
                className="commander-suggestion-chip commander-surprise-chip"
                onClick={handleSurpriseMe}
                disabled={
                  randomLoading || searchLoading || (ownedOnly && collectionLegends.length === 0)
                }
              >
                <Shuffle
                  className="commander-surprise-icon"
                  width={14}
                  height={14}
                  strokeWidth={2}
                  aria-hidden
                />
                {randomLoading ? 'Picking…' : 'Random'}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="commander-search-error">{error}</p>}
    </div>
  );
}
