import './CommanderSearch.css';
import { Shuffle, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  commanderFinderSupportsRegex,
  getCardByName,
  getCardPrice,
  getOwnedPrinting,
  searchCommanderFinder,
} from '@/deck-builder/services/scryfall/client';
import {
  fetchAllCommanderNames,
  fetchCommanderData,
  fetchCommandersWithinColors,
  fetchPlaystyleCommanders,
  fetchTopCommanders,
} from '@/deck-builder/services/edhrec/client';
import type { ScryfallCard, DeckFormat, EDHRECTopCommander } from '@/deck-builder/types';
import { useCollectionStore } from '../../store/collection';
import {
  computeReadiness,
  extractCommanderCandidates,
  isPdhCommanderCandidate,
  MIN_COLLECTION_SIZE,
  type ReadinessScore,
} from '../../lib/commander-readiness';
import {
  classifyCommanderPlaystyles,
  classifyOwnedCommanderPlaystyles,
  playstyleById,
  PLAYSTYLES,
} from '../../lib/commander-playstyle-index';
import {
  buildScryfallQuery,
  colorComboName,
  colorIdentityMatches,
  colorModeHint,
  colorWords,
  compareEntries,
  effectiveSort,
  filterSummary,
  isSearching,
  matchReason,
  relaxations,
  type ColorMode,
  type FinderEntry,
  type FinderQuery,
  type FinderSort,
  type FinderSource,
  type Relaxation,
} from '../../lib/commander-finder';
import { buildCollectionSearch } from '../../lib/deck-add-search';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useMediaQuery } from '../../lib/use-media-query';
import { CommanderReadiness } from './CommanderReadiness';
import { CommanderResultCard } from './CommanderResultCard';
import type { EnrichedCard } from '../../types';
import { ManaCost } from '../ManaCost';
import { ColorPip } from '../shared/ManaSymbol';
import { SearchPill } from '../SearchPill';
import { SelectMenu } from '../SelectMenu';
import { InfoTip } from '../InfoTip';
import { buildCommanderKey } from '../../lib/commander-key';
import { getCommanderStatsBatch, type CommanderStats } from '../../lib/aggregates-client';
import { getCurrency } from '@/lib/currency';
import { formatMoney } from '@/lib/format-money';
import { userMessage } from '@/lib/user-error';
import { Button, IconButton } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { Count } from '@/components/shared/Count';
import { FilterChipsRow, type FilterChipDescriptor } from '@/components/shared/FilterChipsRow';
import { SegmentedControl } from '@/components/shared/form';
import { RulesTextParagraphs } from '@/components/RulesText';

/**
 * Resolves the commander-picker platform-deck-count badge (social W4) for a
 * settled list of visible commanders: looks up each one's oracle id via the
 * already cache-backed `getCardByName`, builds each commander key, and fires
 * ONE batch lookup — never per row. A candidate whose name fails to resolve
 * (offline, or a name Scryfall doesn't recognize) is skipped rather than
 * failing the whole batch.
 *
 * Exported and dependency-injected so it's directly unit-testable.
 */
export async function resolvePlatformCounts(
  candidates: Array<{ name: string }>,
  deps: {
    getCardByName: (name: string) => Promise<ScryfallCard>;
    getCommanderStatsBatch: (keys: string[]) => Promise<Map<string, CommanderStats>>;
  }
): Promise<Map<string, number>> {
  const resolved = await Promise.all(
    candidates.map(async (c) => {
      try {
        return await deps.getCardByName(c.name);
      } catch {
        return null;
      }
    })
  );
  const keyToName = new Map<string, string>();
  resolved.forEach((card, i) => {
    if (card) keyToName.set(buildCommanderKey(card.oracle_id), candidates[i].name);
  });
  if (keyToName.size === 0) return new Map();

  const stats = await deps.getCommanderStatsBatch([...keyToName.keys()]);
  const out = new Map<string, number>();
  for (const [key, name] of keyToName) {
    const s = stats.get(key);
    if (s) out.set(name.toLowerCase(), s.deckCount);
  }
  return out;
}

type SearchMode = 'name' | 'playstyle' | 'binder';

interface Props {
  value: ScryfallCard | null;
  onSelect: (card: ScryfallCard | null) => void;
  /**
   * Deck format this picker serves. 'paupercommander' searches uncommon
   * creatures instead of commanders and hides the EDHREC-backed surfaces
   * (the popular list, "you own N%"): EDHREC has no data for PDH commanders.
   */
  format?: DeckFormat;
  /**
   * A pick made while browsing "In my collection" sorted by "Most of the deck
   * owned" lands here instead of `onSelect` (E283), so the caller can switch
   * on its owned-only build settings. Only the new-deck flow wires it, and the
   * finder says so under the sort while it applies.
   */
  onSelectFromBinder?: (card: ScryfallCard) => void;
  /**
   * How to open. 'binder' (the Decks index's "From my collection" door) opens
   * on "In my collection" sorted by "Most of the deck owned". The other two
   * name tabs of the old picker and open the default view.
   */
  initialSearchMode?: SearchMode;
}

/** A result, with whatever it came from: an owned copy, a Scryfall card, or only a name. */
type Entry = FinderEntry & {
  owned?: EnrichedCard;
  card?: ScryfallCard;
  imageUrl?: string;
};

interface RemoteResult {
  key: string;
  status: 'loading' | 'done' | 'error';
  entries: Entry[];
  total: number;
  /** The popular list comes from EDHREC; a search from Scryfall. */
  from: 'edhrec' | 'scryfall';
  error?: string;
}

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
const COLOR_LABEL: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

// "In my collection" keeps the old "Commanders I own" key, so a returning
// player lands where they left off.
const SOURCE_KEY = 'commander-search-owned-only';
const COLOR_FILTER_KEY = 'commander-search-color-filter';
const COLOR_MODE_KEY = 'commander-search-color-mode';

/** Tiles shown before "Show more"; each press adds two pages. */
const PAGE = 12;
/** Parallel EDHREC page fetches while scoring a whole list (the client throttles too). */
const SCORE_CONCURRENCY = 4;
/** Re-sort by coverage after this many new scores, not after each one. */
const SCORE_RESORT_EVERY = 12;
/** Commanders "Worth buying the commander for" scores, and how many it shows. */
const BUY_POOL = 30;
const BUY_SHOWN = 6;
/** Playstyle chips shown before "N more" on a wide screen. */
const STYLE_PREVIEW = 9;

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
}

function pickRandom<T>(arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

async function runPool<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
  cancelled: () => boolean
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SCORE_CONCURRENCY, items.length) }, async () => {
      while (!cancelled() && next < items.length) await fn(items[next++]);
    })
  );
}

/** EDHREC's popular list for the color filter. */
function fetchPopular(colors: ReadonlySet<string>, mode: ColorMode): Promise<EDHRECTopCommander[]> {
  if (colors.size === 0) return fetchTopCommanders([]);
  return mode === 'within' && !colors.has('C')
    ? fetchCommandersWithinColors([...colors])
    : fetchTopCommanders([...colors]);
}

const identityOf = (ci: readonly string[] | undefined): string[] =>
  ci && ci.length > 0 ? [...ci] : ['C'];

const popularEntry = (c: EDHRECTopCommander, i: number): Entry => ({
  key: c.sanitized || c.name,
  name: c.name,
  colors: identityOf(c.colorIdentity),
  popularity: i,
  numDecks: c.numDecks,
  playstyleIds: [],
});

const playstyleLabels = (ids: readonly string[]): string[] =>
  ids.flatMap((id) => {
    const p = playstyleById(id);
    return p ? [p.label] : [];
  });

/** The WUBRG + colorless filter. Colorless can't combine with a color. */
function ColorPips({
  colors,
  onChange,
}: {
  colors: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="commander-color-filter">
      {COLORS.map((c) => {
        const active = colors.has(c);
        return (
          <IconButton
            className={`commander-color-pip${active ? ' active' : ''}`}
            key={c}
            aria-pressed={active}
            onClick={() => {
              const next = new Set(colors);
              if (next.has(c)) {
                next.delete(c);
              } else {
                next.add(c);
                if (c === 'C') {
                  for (const other of [...next]) if (other !== 'C') next.delete(other);
                } else {
                  next.delete('C');
                }
              }
              onChange(next);
            }}
            label={COLOR_LABEL[c]}
            icon={<ColorPip color={c} pip={false} />}
          />
        );
      })}
    </div>
  );
}

/**
 * The commander finder: one search box and one result list, narrowed by
 * filters that combine (colors, playstyles, "In my collection") and ordered
 * by a sort. Every commander picker renders it: the generator, Brew, the
 * deck editor's "Choose a commander" sheet and both import dialogs. Picking
 * one collapses it to the chosen commander with a Change button.
 */
export function CommanderSearch({
  value,
  onSelect,
  format = 'commander',
  onSelectFromBinder,
  initialSearchMode,
}: Props) {
  const pdh = format === 'paupercommander';
  const isPhone = useMediaQuery('(max-width: 599px)');
  const baseId = useId();
  const filtersId = `${baseId}-filters`;

  // ── Collection ────────────────────────────────────────────────────────
  const collectionCards = useCollectionStore((s) => s.cards);
  // importId → addedAt so "most recent copy" is real: prod importIds are random
  // UUIDs, so recency can't be read off the id itself (audit F6).
  const importHistory = useCollectionStore((s) => s.importHistory);
  const importRecency = useMemo(
    () => new Map(importHistory.map((h) => [h.id, h.addedAt])),
    [importHistory]
  );
  // One row per commander you own (the collection stores one per copy). The
  // shared `isCommanderEligible` keeps this from drifting from binder routing.
  const collectionLegends = useMemo(
    () =>
      pdh
        ? extractCommanderCandidates(collectionCards, importRecency, isPdhCommanderCandidate)
        : extractCommanderCandidates(collectionCards, importRecency),
    [pdh, collectionCards, importRecency]
  );
  const ownedLegendNames = useMemo(
    () => new Set(collectionLegends.map((c) => c.name.toLowerCase())),
    [collectionLegends]
  );
  // Readiness scores a commander's staples against the WHOLE collection.
  const ownedCardNames = useMemo(
    () => new Set(collectionCards.map((c) => c.name.toLowerCase())),
    [collectionCards]
  );
  // "You own N%" needs EDHREC staples (none for PDH) and a collection to
  // measure; below MIN_COLLECTION_SIZE every commander reads close to 0%.
  const canScore = !pdh && collectionCards.length >= MIN_COLLECTION_SIZE;

  // ── Readiness: how much of a commander's deck you own ─────────────────
  const [readiness, setReadiness] = useState<Map<string, ReadinessScore | 'loading'>>(new Map());
  const readinessInflight = useRef<Set<string>>(new Set());
  const readinessDone = useRef<Set<string>>(new Set());
  const ensureReadiness = useCallback(
    async (name: string): Promise<void> => {
      if (!canScore) return;
      const key = name.toLowerCase();
      if (readinessDone.current.has(key) || readinessInflight.current.has(key)) return;
      readinessInflight.current.add(key);
      setReadiness((prev) => new Map(prev).set(key, 'loading'));
      let score: ReadinessScore;
      try {
        const data = await fetchCommanderData(name);
        score = computeReadiness(data.cardlists.allNonLand, ownedCardNames);
      } catch {
        score = computeReadiness([], ownedCardNames);
      }
      readinessDone.current.add(key);
      readinessInflight.current.delete(key);
      setReadiness((prev) => new Map(prev).set(key, score));
    },
    [canScore, ownedCardNames]
  );

  // Covers a prefilled selection; a hover or the eager load usually cached it.
  useEffect(() => {
    if (value) void ensureReadiness(value.name);
  }, [value, ensureReadiness]);

  // ── Filters ───────────────────────────────────────────────────────────
  const [text, setText] = useState('');
  const debouncedText = useDebouncedValue(text, 250);
  const [source, setSourceState] = useState<FinderSource>(() =>
    initialSearchMode === 'binder' || readPref(SOURCE_KEY) === 'true' ? 'owned' : 'all'
  );
  const [colors, setColorsState] = useState<Set<string>>(() => {
    try {
      const raw = readPref(COLOR_FILTER_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [colorMode, setColorModeState] = useState<ColorMode>(() =>
    readPref(COLOR_MODE_KEY) === 'within' ? 'within' : 'exact'
  );
  const [playstyleIds, setPlaystyleIds] = useState<string[]>([]);
  const [sortChoice, setSortChoice] = useState<FinderSort | null>(
    initialSearchMode === 'binder' ? 'owned' : null
  );
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // "In my collection" needs something to show; with no legends it's "All".
  const hasLegends = collectionLegends.length > 0;
  const activeSource: FinderSource = hasLegends ? source : 'all';

  const setSource = (next: FinderSource) => {
    setSourceState(next);
    writePref(SOURCE_KEY, String(next === 'owned'));
  };
  const setColors = (next: Set<string>) => {
    setColorsState(next);
    writePref(COLOR_FILTER_KEY, JSON.stringify([...next]));
  };
  const setColorMode = (next: ColorMode) => {
    setColorModeState(next);
    writePref(COLOR_MODE_KEY, next);
  };
  const togglePlaystyle = (id: string) =>
    setPlaystyleIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  const clearAll = () => {
    setText('');
    setColors(new Set());
    setPlaystyleIds([]);
  };

  const query: FinderQuery = useMemo(
    () => ({ text: debouncedText, colors, colorMode, playstyleIds }),
    [debouncedText, colors, colorMode, playstyleIds]
  );
  const searching = isSearching(query);
  const sort = effectiveSort(sortChoice === 'owned' && !canScore ? null : sortChoice, searching);

  // ── Your commanders: local, instant, offline ──────────────────────────
  const ownedPlaystyles = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const legend of collectionLegends) {
      map.set(
        legend.name,
        classifyOwnedCommanderPlaystyles(legend).map((m) => m.playstyle.id)
      );
    }
    return map;
  }, [collectionLegends]);

  const ownedEntries = useMemo<Entry[]>(() => {
    if (activeSource !== 'owned') return [];
    const search = buildCollectionSearch(query.text.trim().length >= 2 ? query.text : '');
    return collectionLegends.flatMap((c) => {
      if (!colorIdentityMatches(c.colorIdentity, query.colors, query.colorMode)) return [];
      if (!search.match(c).hit) return [];
      const ids = ownedPlaystyles.get(c.name) ?? [];
      if (query.playstyleIds.length > 0 && !query.playstyleIds.some((id) => ids.includes(id))) {
        return [];
      }
      return [
        {
          key: c.scryfallId ?? c.name,
          name: c.name,
          colors: identityOf(c.colorIdentity),
          typeLine: c.typeLine,
          oracleText: c.oracleText,
          cmc: c.cmc,
          popularity: c.edhrecRank,
          playstyleIds: ids,
          owned: c,
          imageUrl: c.imageNormal,
        },
      ];
    });
  }, [activeSource, collectionLegends, ownedPlaystyles, query]);

  // ── Every commander: EDHREC's popular list, or a Scryfall search ──────
  // The key summarises everything the fetch reads, so the effect runs once
  // per distinct request rather than once per `query` identity.
  const remoteKey = JSON.stringify([
    activeSource,
    pdh,
    query.text.trim().length >= 2 ? query.text.trim() : '',
    [...query.colors].sort(),
    query.colorMode,
    [...query.playstyleIds].sort(),
    reloadKey,
  ]);
  const [remote, setRemote] = useState<RemoteResult | null>(null);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (activeSource !== 'all') return;
    let cancelled = false;
    const q = queryRef.current;
    const browse = !isSearching(q) && !pdh;
    const from = browse ? 'edhrec' : 'scryfall';
    const settle = (next: Omit<RemoteResult, 'key' | 'from'>) => {
      if (!cancelled) setRemote({ key: remoteKey, from, ...next });
    };
    void (async () => {
      // Keep the previous tiles up, dimmed, instead of collapsing the grid.
      setRemote((prev) => ({
        key: remoteKey,
        from,
        status: 'loading',
        entries: prev?.entries ?? [],
        total: prev?.total ?? 0,
      }));
      try {
        if (browse) {
          const list = await fetchPopular(q.colors, q.colorMode);
          const entries = list.filter((c) => !c.name.includes('//')).map(popularEntry);
          settle({ status: 'done', entries, total: entries.length });
          return;
        }
        const regex = commanderFinderSupportsRegex();
        const selected = q.playstyleIds;
        const [page, tagLists] = await Promise.all([
          searchCommanderFinder(buildScryfallQuery(q, regex), { pdh }),
          // EDHREC's crowd list for each chosen playstyle ranks first.
          Promise.all(
            (pdh ? [] : selected).map(async (id) => {
              const slug = playstyleById(id)?.edhrecSlug;
              const list = slug
                ? await fetchPlaystyleCommanders(slug).catch((): EDHRECTopCommander[] => [])
                : [];
              return { id, list };
            })
          ),
        ]);
        const tagRank = new Map<string, number>();
        const tagStyles = new Map<string, string[]>();
        for (const { id, list } of tagLists) {
          list.forEach((c, i) => {
            const k = c.name.toLowerCase();
            tagRank.set(k, Math.min(tagRank.get(k) ?? i, i));
            tagStyles.set(k, [...(tagStyles.get(k) ?? []), id]);
          });
        }
        const entries: Entry[] = page.cards.flatMap((card, i) => {
          const k = card.name.toLowerCase();
          let ids = classifyCommanderPlaystyles(card).map((m) => m.playstyle.id);
          for (const id of tagStyles.get(k) ?? []) if (!ids.includes(id)) ids = [id, ...ids];
          // Scryfall already applied a lone playstyle's clause (typal rides on
          // otag:typal, which the local reader can't always see), so trust it.
          if (regex && selected.length === 1 && !ids.includes(selected[0])) {
            ids = [selected[0], ...ids];
          }
          // Offline, the query had no playstyle clause: filter here instead.
          if (!regex && selected.length > 0 && !selected.some((id) => ids.includes(id))) return [];
          return [
            {
              key: card.id,
              name: card.name,
              colors: identityOf(card.color_identity),
              typeLine: card.type_line,
              oracleText: card.oracle_text ?? card.card_faces?.[0]?.oracle_text,
              cmc: card.cmc,
              popularity: card.edhrec_rank ?? 100_000 + i,
              playstyleIds: ids,
              tagRank: tagRank.get(k),
              card,
              imageUrl: card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal,
            },
          ];
        });
        // Crowd-listed commanders the rules-text pattern missed, when nothing
        // is typed (a typed search has to match what was typed).
        if (q.text.trim().length < 2) {
          const seen = new Set(entries.map((e) => e.name.toLowerCase()));
          for (const { list } of tagLists) {
            for (const c of list) {
              const k = c.name.toLowerCase();
              if (seen.has(k) || c.name.includes('//')) continue;
              if (!colorIdentityMatches(c.colorIdentity, q.colors, q.colorMode)) continue;
              seen.add(k);
              entries.push({
                ...popularEntry(c, 100_000 + entries.length),
                playstyleIds: tagStyles.get(k) ?? [],
                tagRank: tagRank.get(k),
              });
            }
          }
        }
        settle({ status: 'done', entries, total: Math.max(page.total, entries.length) });
      } catch (e) {
        settle({
          status: 'error',
          entries: [],
          total: 0,
          error: browse
            ? "Couldn't reach EDHREC for popular commanders. Searching by name still works."
            : userMessage(e, "Couldn't run that search. Check your connection and try again."),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteKey, activeSource, pdh]);

  const current = remote?.key === remoteKey ? remote : null;
  const loading = activeSource === 'all' && (current === null || current.status === 'loading');
  const entries = useMemo<Entry[]>(
    () => (activeSource === 'owned' ? ownedEntries : (remote?.entries ?? [])),
    [activeSource, ownedEntries, remote]
  );
  const total = activeSource === 'owned' ? ownedEntries.length : (remote?.total ?? 0);

  // ── Scoring the whole list for "Most of the deck owned" ───────────────
  // The sort reads a snapshot taken every few scores rather than the live
  // map, so tiles don't jump under the pointer while the list is scored.
  const scoringOn = sort === 'owned' && canScore;
  const scoringKey = `${scoringOn}|${activeSource}|${remoteKey}|${entries.length}`;
  const [scoring, setScoring] = useState<{ key: string; done: number; of: number } | null>(null);
  const [scoreSnapshot, setScoreSnapshot] = useState<Map<string, number>>(new Map());
  const readinessRef = useRef(readiness);
  useEffect(() => {
    readinessRef.current = readiness;
  }, [readiness]);
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    if (!scoringOn) return;
    let cancelled = false;
    const names = entriesRef.current.map((e) => e.name);
    if (names.length === 0) return;
    const snapshot = () => {
      const map = new Map<string, number>();
      for (const [k, v] of readinessRef.current) {
        if (v !== 'loading' && v.available) map.set(k, v.percent);
      }
      setScoreSnapshot(map);
    };
    let done = 0;
    void (async () => {
      setScoring({ key: scoringKey, done: 0, of: names.length });
      await runPool(
        names,
        async (name) => {
          await ensureReadiness(name);
          done += 1;
          if (cancelled) return;
          setScoring({ key: scoringKey, done, of: names.length });
          if (done % SCORE_RESORT_EVERY === 0) snapshot();
        },
        () => cancelled
      );
      // One more turn so the last score has landed in the ref.
      await new Promise((r) => setTimeout(r, 0));
      if (!cancelled) snapshot();
    })();
    return () => {
      cancelled = true;
    };
  }, [scoringKey, scoringOn, ensureReadiness]);
  const scoringNow =
    scoringOn && scoring?.key === scoringKey && scoring.done < scoring.of ? scoring : null;

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) =>
        compareEntries(a, b, {
          sort,
          text: query.text,
          selectedPlaystyles: query.playstyleIds,
          readiness: (k) => scoreSnapshot.get(k),
        })
      ),
    [entries, sort, query.text, query.playstyleIds, scoreSnapshot]
  );

  // Collapse to one page whenever the list itself changes.
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const listKey = `${activeSource}|${remoteKey}|${sort}`;
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setVisibleCount(PAGE);
  }
  const visible = sorted.slice(0, visibleCount);
  const visibleNames = visible.map((e) => e.name).join('|');

  // Eager "you own N%" for the visible tiles: a bounded set, fetched in turn.
  useEffect(() => {
    if (!canScore || !visibleNames) return;
    let cancelled = false;
    void (async () => {
      for (const name of visibleNames.split('|')) {
        if (cancelled) return;
        await ensureReadiness(name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleNames, canScore, ensureReadiness]);

  // "N on SpellControl" for the visible tiles (social W4), one batch per page.
  const [platformCounts, setPlatformCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (pdh || !visibleNames) return;
    let cancelled = false;
    void (async () => {
      const map = await resolvePlatformCounts(
        visibleNames.split('|').map((name) => ({ name })),
        { getCardByName, getCommanderStatsBatch }
      );
      if (!cancelled) setPlatformCounts((prev) => new Map([...prev, ...map]));
    })();
    return () => {
      cancelled = true;
    };
  }, [pdh, visibleNames]);

  // ── "Worth buying the commander for" ──────────────────────────────────
  // Popular commanders you don't own, ranked by how much of their deck you do.
  const showBuy = activeSource === 'owned' && sort === 'owned' && canScore && !searching;
  const buyKey = JSON.stringify([showBuy, [...colors].sort(), colorMode]);
  const [buyPool, setBuyPool] = useState<{ key: string; entries: Entry[] }>({
    key: '',
    entries: [],
  });
  const ownedLegendNamesRef = useRef(ownedLegendNames);
  useEffect(() => {
    ownedLegendNamesRef.current = ownedLegendNames;
  }, [ownedLegendNames]);
  useEffect(() => {
    if (!showBuy) return;
    let cancelled = false;
    const [, colorList, mode] = JSON.parse(buyKey) as [boolean, string[], ColorMode];
    void (async () => {
      const list = await fetchPopular(new Set(colorList), mode).catch(
        (): EDHRECTopCommander[] => []
      );
      const pool = list
        .filter(
          (c) => !c.name.includes('//') && !ownedLegendNamesRef.current.has(c.name.toLowerCase())
        )
        .slice(0, BUY_POOL)
        .map(popularEntry);
      if (cancelled) return;
      setBuyPool({ key: buyKey, entries: pool });
      await runPool(
        pool,
        (e) => ensureReadiness(e.name),
        () => cancelled
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [showBuy, buyKey, ensureReadiness]);
  const buyShown = useMemo(() => {
    if (!showBuy || buyPool.key !== buyKey) return [];
    return buyPool.entries
      .flatMap((e) => {
        const r = readiness.get(e.name.toLowerCase());
        return r && r !== 'loading' && r.available && r.percent > 0 ? [{ e, pct: r.percent }] : [];
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, BUY_SHOWN)
      .map(({ e }) => e);
  }, [showBuy, buyKey, buyPool, readiness]);
  const buyNames = buyShown.map((e) => e.name).join('|');
  const [buyPrices, setBuyPrices] = useState<Map<string, string | null>>(new Map());
  const pricedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!buyNames) return;
    let cancelled = false;
    void (async () => {
      for (const name of buyNames.split('|')) {
        if (cancelled) return;
        if (pricedRef.current.has(name)) continue;
        pricedRef.current.add(name);
        let price: string | null = null;
        try {
          const raw = getCardPrice(await getCardByName(name), getCurrency());
          price = raw ? formatMoney(Number(raw), { wholeDollars: Number(raw) >= 10 }) : null;
        } catch {
          price = null;
        }
        setBuyPrices((prev) => new Map(prev).set(name, price));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buyNames]);

  // ── Selection ─────────────────────────────────────────────────────────
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // E283: browsing what you own by coverage is a build-from-my-collection
  // intent, so the caller preselects owned-only settings for that pick.
  const fromBinder = activeSource === 'owned' && sort === 'owned' && !!onSelectFromBinder;

  const finish = (card: ScryfallCard, viaBinder: boolean) => {
    (viaBinder && onSelectFromBinder ? onSelectFromBinder : onSelect)(card);
    setText('');
  };

  const selectEntry = async (entry: Entry) => {
    setError(null);
    setSelecting(entry.key);
    try {
      if (entry.owned) {
        // The exact printing you own, so the deck binds the copy on screen.
        finish(await getOwnedPrinting(entry.owned.scryfallId, entry.owned.name), fromBinder);
      } else if (entry.card) {
        finish(entry.card, false);
      } else {
        finish(await getCardByName(entry.name), false);
      }
    } catch (e) {
      setError(userMessage(e, "Couldn't load that card. Try again in a moment."));
    } finally {
      setSelecting(null);
    }
  };

  const [randomLoading, setRandomLoading] = useState(false);
  const handleRandom = async () => {
    setError(null);
    setRandomLoading(true);
    try {
      // With nothing set, any commander EDHREC knows; otherwise one from the
      // list on screen, so Random respects every filter.
      if (activeSource === 'all' && !pdh && !searching && colors.size === 0) {
        const pick = pickRandom((await fetchAllCommanderNames()).filter((n) => !n.includes('//')));
        if (!pick) {
          setError("Couldn't load EDHREC's commander list. Try again.");
          return;
        }
        finish(await getCardByName(pick), false);
        return;
      }
      const pick = pickRandom(sorted);
      if (!pick) {
        setError(`No ${pdh ? 'uncommon creatures' : 'commanders'} match these filters.`);
        return;
      }
      await selectEntry(pick);
    } catch (e) {
      setError(userMessage(e, "Couldn't pick a random commander. Try again."));
    } finally {
      setRandomLoading(false);
    }
  };

  // ── Selected commander ────────────────────────────────────────────────
  if (value) {
    const selectedReadiness = readiness.get(value.name.toLowerCase());
    // Two-faced commanders keep oracle text on card_faces; fall back to the
    // front face. Both faces belong to the card preview, not here.
    const front = value.card_faces?.[0];
    const manaCost = value.mana_cost ?? front?.mana_cost ?? '';
    const oracleText = value.oracle_text ?? front?.oracle_text ?? '';
    const power = value.power ?? front?.power;
    const toughness = value.toughness ?? front?.toughness;
    const loyalty = value.loyalty;
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
              <RulesTextParagraphs text={oracleText} names={[value.name]} />
            </div>
          )}
          {playstyleMatches.length > 0 && (
            <div className="commander-pick-playstyles">
              <span className="commander-pick-playstyles-label">
                Plays like
                <InfoTip
                  label="Plays like"
                  text="How this commander tends to win, read from its rules text. Change the commander and filter by playstyle to find more like it."
                />
              </span>
              {playstyleMatches.map((m) => (
                <Chip key={m.playstyle.id} className="commander-pick-playstyle-tag" tone="neutral">
                  {m.playstyle.label}
                </Chip>
              ))}
            </div>
          )}
          {canScore && (
            <div className="commander-pick-readiness">
              <CommanderReadiness
                score={selectedReadiness === 'loading' ? undefined : selectedReadiness}
              />
            </div>
          )}
        </div>
        <Button onClick={() => onSelect(null)} className="commander-pick-change">
          Change
        </Button>
      </div>
    );
  }

  // ── Finder ────────────────────────────────────────────────────────────
  const noun = pdh ? 'uncommon creature' : 'commander';
  const nouns = `${noun}s`;
  const count = (n: number) => `${n.toLocaleString()} ${n === 1 ? noun : nouns}`;
  const comboName = colorComboName(colors);
  const summary = filterSummary(query);
  const anyFilter = summary.length > 0;
  const filterCount = (colors.size > 0 ? 1 : 0) + playstyleIds.length;

  const sortOptions: Array<{ value: FinderSort; label: string }> = [
    ...(searching ? [{ value: 'match' as const, label: 'Best match' }] : []),
    { value: 'popular', label: 'Popular' },
    ...(canScore ? [{ value: 'owned' as const, label: 'Most of the deck owned' }] : []),
    { value: 'name', label: 'Name' },
    // The popular list carries no mana values.
    ...(activeSource === 'owned' || searching || pdh
      ? [{ value: 'mv' as const, label: 'Mana value' }]
      : []),
  ];

  const checking = scoringNow
    ? ` · checking coverage, ${scoringNow.done} of ${scoringNow.of} done`
    : '';
  // The popular list only takes colors, and its status line names them.
  const browsingPopular =
    activeSource === 'all' && current?.from === 'edhrec' && current.status === 'done';
  const status =
    loading && entries.length === 0
      ? 'Searching…'
      : activeSource === 'owned'
        ? `${count(total)} you own${checking}`
        : browsingPopular
          ? `Popular ${comboName ? `${comboName} ` : ''}commanders on EDHREC${checking}`
          : `${count(total)}${checking}`;

  const relax = (r: Relaxation) => {
    if (r.id === 'source') setSource('all');
    else if (r.id === 'within') setColorMode('within');
    else if (r.id === 'text') setText('');
    else togglePlaystyle(r.id.slice('style:'.length));
  };
  const emptyReasons = relaxations({ ...query, source: activeSource });

  const colorChipLabel =
    colorMode === 'within' && !colors.has('C')
      ? `Within ${colorWords(colors).toLowerCase()}`
      : comboName;
  const filterChips: FilterChipDescriptor[] = [
    ...(colors.size > 0
      ? [{ id: 'colors', label: colorChipLabel, onClear: () => setColors(new Set()) }]
      : []),
    ...playstyleIds.flatMap((id) => {
      const p = playstyleById(id);
      return p ? [{ id: `style:${id}`, label: p.label, onClear: () => togglePlaystyle(id) }] : [];
    }),
  ];

  const stylesShown =
    isPhone || showAllStyles
      ? PLAYSTYLES
      : PLAYSTYLES.filter((p, i) => i < STYLE_PREVIEW || playstyleIds.includes(p.id));

  const filters = (
    <div className="commander-finder-filters" id={filtersId}>
      <div className="commander-finder-row">
        <span className="commander-finder-label" id={`${baseId}-colors`}>
          Colors
        </span>
        <div className="commander-finder-control" role="group" aria-labelledby={`${baseId}-colors`}>
          <ColorPips colors={colors} onChange={setColors} />
          {comboName && <span className="commander-finder-combo">{comboName}</span>}
          {colors.size > 0 && !colors.has('C') && (
            <SegmentedControl
              ariaLabel="Color match"
              value={colorMode}
              onChange={setColorMode}
              options={[
                { value: 'exact', label: 'Exactly' },
                { value: 'within', label: 'Within' },
              ]}
            />
          )}
          {colors.size > 0 && (
            <span className="commander-finder-hint">{colorModeHint(colors, colorMode)}</span>
          )}
        </div>
      </div>
      <div className="commander-finder-row">
        <span className="commander-finder-label" id={`${baseId}-styles`}>
          Playstyle
        </span>
        <div className="commander-finder-control" role="group" aria-labelledby={`${baseId}-styles`}>
          {stylesShown.map((p) => (
            <Chip
              key={p.id}
              className="filter-chip"
              pressed={playstyleIds.includes(p.id)}
              onClick={() => togglePlaystyle(p.id)}
            >
              {p.label}
            </Chip>
          ))}
          {!isPhone && PLAYSTYLES.length > STYLE_PREVIEW && (
            <Button variant="link" onClick={() => setShowAllStyles((v) => !v)}>
              {showAllStyles ? 'Fewer' : `${PLAYSTYLES.length - stylesShown.length} more`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="commander-search commander-finder">
      <SearchPill
        className="commander-finder-search"
        inputType="text"
        placeholder="Name, creature type or rules text"
        value={text}
        onChange={setText}
        ariaLabel={`Search ${nouns} by name, type or rules text`}
      />
      {text.trim().length > 0 && (
        <p className="commander-finder-syntax">
          Scryfall syntax works too: <code>o:&quot;dies&quot;</code> <code>t:vampire</code>{' '}
          <code>pow&gt;=5</code>
        </p>
      )}

      {(hasLegends || isPhone) && (
        <div className="commander-finder-source">
          {hasLegends && (
            <SegmentedControl
              ariaLabel={`Which ${nouns}`}
              value={activeSource}
              onChange={setSource}
              options={[
                { value: 'all', label: isPhone ? 'All' : `All ${nouns}` },
                {
                  value: 'owned',
                  label: `${isPhone ? 'Mine' : 'In my collection'} · ${collectionLegends.length.toLocaleString()}`,
                },
              ]}
            />
          )}
          {isPhone && (
            <Button
              icon={<SlidersHorizontal width={14} height={14} strokeWidth={1.8} />}
              aria-expanded={filtersOpen}
              aria-controls={filtersOpen ? filtersId : undefined}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <>
                Filters
                <Count
                  className="commander-finder-filter-count"
                  value={filterCount}
                  placement="inline"
                />
              </>
            </Button>
          )}
        </div>
      )}

      {!isPhone || filtersOpen ? (
        filters
      ) : (
        <FilterChipsRow chips={filterChips} onClearAll={clearAll} />
      )}

      <div className="commander-finder-toolbar">
        <p className="commander-finder-status" role="status" aria-live="polite">
          <span className="commander-finder-status-count">{status}</span>
          {summary && !isPhone && !browsingPopular && (
            <span className="commander-finder-summary"> · {summary}</span>
          )}
        </p>
        <div className="commander-finder-actions">
          {anyFilter && !isPhone && (
            <Button variant="link" onClick={clearAll}>
              Clear all
            </Button>
          )}
          <SelectMenu
            label="Sort"
            ariaLabel="Sort commanders"
            value={sort}
            options={sortOptions}
            onChange={setSortChoice}
          />
          <Button
            icon={<Shuffle width={14} height={14} strokeWidth={1.8} />}
            onClick={() => void handleRandom()}
            disabled={randomLoading || selecting !== null || (loading && entries.length === 0)}
          >
            {randomLoading ? 'Picking…' : 'Random'}
          </Button>
        </div>
      </div>

      {playstyleIds.length > 0 && (
        <ul className="commander-finder-style-notes">
          {playstyleIds.map((id) => {
            const p = playstyleById(id);
            return p ? (
              <li key={id}>
                <strong>{p.label}:</strong> {p.blurb}
              </li>
            ) : null;
          })}
        </ul>
      )}
      {fromBinder && (
        <p className="commander-finder-note">
          Picking from here builds with only your cards. Change that in Customize.
        </p>
      )}

      <div className="commander-search-panel" id="commander-search-panel">
        {current?.status === 'error' ? (
          <p className="commander-finder-alert" role="alert">
            <span>{current.error}</span>
            <Button variant="link" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </Button>
          </p>
        ) : loading && entries.length === 0 ? (
          <ul className="commander-result-grid" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <span className="commander-result-card commander-finder-skeleton">
                  <span className="commander-result-art">
                    <span className="commander-result-art-skeleton" />
                  </span>
                  <span className="commander-result-body">
                    <span className="commander-finder-skeleton-line" />
                    <span className="commander-finder-skeleton-line is-short" />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : sorted.length === 0 ? (
          <div className="commander-finder-empty">
            <p className="commander-finder-empty-title">
              {activeSource === 'owned' && !anyFilter
                ? `No ${nouns} in your collection yet.`
                : activeSource === 'owned'
                  ? `None of your ${nouns} match these filters.`
                  : `No ${nouns} match these filters.`}
            </p>
            {emptyReasons.length > 0 && (
              <div className="commander-finder-empty-actions">
                {emptyReasons.map((r) => (
                  <Button key={r.id} onClick={() => relax(r)}>
                    {r.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <ul className="commander-result-grid" aria-busy={loading}>
              {visible.map((e) => (
                <li key={e.key}>
                  <CommanderResultCard
                    name={e.name}
                    imageUrl={e.imageUrl}
                    colors={e.colors}
                    comboName={colorComboName(e.colors)}
                    reason={matchReason(e, query.text)}
                    owned={activeSource === 'all' && ownedLegendNames.has(e.name.toLowerCase())}
                    readiness={canScore ? readiness.get(e.name.toLowerCase()) : undefined}
                    coverageBar={sort === 'owned'}
                    playstyles={playstyleLabels(
                      // The playstyles you filtered by lead, so the tile says why it's here.
                      [...e.playstyleIds].sort(
                        (a, b) =>
                          Number(playstyleIds.includes(b)) - Number(playstyleIds.includes(a))
                      )
                    )}
                    numDecks={e.numDecks}
                    platformDeckCount={platformCounts.get(e.name.toLowerCase())}
                    selecting={selecting === e.key}
                    disabled={selecting !== null}
                    onSelect={() => void selectEntry(e)}
                    onPeek={() => void ensureReadiness(e.name)}
                  />
                </li>
              ))}
            </ul>
            {sorted.length > visibleCount ? (
              <Button
                variant="link"
                className="commander-finder-more"
                onClick={() => setVisibleCount((n) => n + PAGE * 2)}
              >
                Show {Math.min(PAGE * 2, sorted.length - visibleCount)} more
              </Button>
            ) : (
              activeSource === 'all' &&
              total > sorted.length && (
                <p className="commander-finder-hint commander-finder-cap">
                  Showing the top {sorted.length.toLocaleString()}. Narrow the search to see the
                  rest.
                </p>
              )
            )}
          </>
        )}

        {buyShown.length > 0 && (
          <section className="commander-finder-buy" aria-labelledby={`${baseId}-buy`}>
            <h3 className="commander-finder-buy-title" id={`${baseId}-buy`}>
              Worth buying the commander for
            </h3>
            <p className="commander-finder-hint">
              Popular commanders you don't own whose decks your collection already covers.
            </p>
            <ul className="commander-result-grid">
              {buyShown.map((e) => {
                const price = buyPrices.get(e.name);
                return (
                  <li key={e.key}>
                    <CommanderResultCard
                      name={e.name}
                      colors={e.colors}
                      comboName={colorComboName(e.colors)}
                      readiness={readiness.get(e.name.toLowerCase())}
                      coverageBar
                      numDecks={e.numDecks}
                      detail={
                        <span className="commander-result-type">
                          Not in your collection{price ? ` · ${price}` : ''}
                        </span>
                      }
                      selecting={selecting === e.key}
                      disabled={selecting !== null}
                      onSelect={() => void selectEntry(e)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {error && <p className="commander-search-error">{error}</p>}
    </div>
  );
}
