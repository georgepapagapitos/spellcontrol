import '@/styles/deck-builder-commander.css';
import './CommanderSearch.css';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  commanderFinderSupportsRegex,
  getCardByName,
  getOwnedPrinting,
  searchCommanderFinder,
} from '@/deck-builder/services/scryfall/client';
import {
  backfillColorIdentities,
  fetchAllCommanderNames,
  fetchPlaystyleCommanders,
  fetchTagPageData,
} from '@/deck-builder/services/edhrec/client';
import type { ScryfallCard, DeckFormat, EDHRECTopCommander } from '@/deck-builder/types';
import { useCollectionStore } from '../../store/collection';
import {
  coverageHintFor,
  scoreShortlist,
  extractCommanderCandidates,
  isPdhCommanderCandidate,
  MIN_COLLECTION_SIZE,
} from '@/lib/deck/commander-readiness';
import { heldByDecks } from '@/lib/deck/held-elsewhere';
import { useAllocations } from '@/lib/collection/allocations';
import { useCoverageNotes } from './use-coverage-notes';
import { BRACKET_OPTIONS, useBracketPref, useCommanderReadiness } from './use-commander-readiness';
import {
  classifyCommanderPlaystyles,
  classifyOwnedCommanderPlaystyles,
  playstyleById,
  PLAYSTYLES,
} from '@/lib/deck/commander-playstyle-index';
import {
  isVoltronVetoedByName,
  loadVoltronVeto,
  useVoltronVeto,
} from '@/lib/deck/commander-voltron-veto';
import { useCommanderProfile } from '@/lib/deck/use-commander-profile';
import {
  buildScryfallQuery,
  colorComboName,
  colorIdentityMatches,
  colorModeHint,
  colorWords,
  exclusiveColorless,
  compareEntries,
  effectiveSort,
  filterSummary,
  isSearching,
  matchReason,
  relaxations,
  type ColorMode,
  type FinderQuery,
  type FinderSort,
  type FinderSource,
  type Relaxation,
} from '@/lib/deck/commander-finder';
import { buildCollectionSearch } from '@/lib/search/deck-add-search';
import { useDebouncedValue } from '@/lib/util/use-debounced-value';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { CommanderResultCard } from './CommanderResultCard';
import { ManaColorPicker, colorModeOptions } from '@/components/filter-kit';
import { SearchPill } from '@/components/search/SearchPill';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { getCommanderStatsBatch } from '@/lib/discover/aggregates-client';
import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
import { CommanderRandomButton } from './CommanderRandomButton';
import { Chip } from '@/components/shared/Chip';
import { Count } from '@/components/shared/Count';
import { FilterChipsRow, type FilterChipDescriptor } from '@/components/shared/FilterChipsRow';
import { SegmentedControl } from '@/components/shared/form';
import { CommanderLeans } from './CommanderLeans';
import { BuildAroundRows } from './BuildAroundRows';
import { CommanderPick } from './CommanderPick';
import { useBuyCandidates } from './use-buy-candidates';
import {
  fetchPopular,
  identityOf,
  popularEntry,
  resolvePlatformCounts,
  runPool,
  type Entry,
  type IdeaFinderProps,
} from './commander-finder-shared';

export { resolvePlatformCounts, type IdeaFinderProps };
import { CommanderSummaryRow } from './CommanderSummaryRow';
import { IdeaSearchBox } from './IdeaSearchBox';
import { IdeaStrip } from './IdeaStrip';
import { findIdea, normalizeQuery, useIdeaIndex, type Idea } from '@/lib/deck/idea-index';

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
  /** Turns on the idea-aware generator layout; see {@link IdeaFinderProps}. */
  ideaFinder?: IdeaFinderProps;
}

interface RemoteResult {
  key: string;
  status: 'loading' | 'done' | 'error';
  entries: Entry[];
  total: number;
  /** The popular list comes from EDHREC; a search from Scryfall. */
  from: 'edhrec' | 'scryfall';
  error?: string;
  /** The idea's list had no page in the chosen colors, so it shows every color. */
  colorFallback?: boolean;
  /** The idea this list is for, so a list never shows under another idea's name. */
  idea?: string | null;
}

// "In my collection" keeps the old "Commanders I own" key, so a returning
// player lands where they left off.
const SOURCE_KEY = 'commander-search-owned-only';
const COLOR_FILTER_KEY = 'commander-search-color-filter';
const COLOR_MODE_KEY = 'commander-search-color-mode';

/** Tiles shown before "Show more"; each press adds two pages. */
const PAGE = 12;
/** Re-sort by coverage after this many new scores, not after each one. */
const SCORE_RESORT_EVERY = 12;
/**
 * Most commanders one "Most of the deck owned" pass scores, most-played first.
 * Each costs an EDHREC page; the list says so when it stops short.
 * ponytail: a cap, not paging; raise it or score on demand if the note starts to bite.
 */
const SCORE_CAP = 60;

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

// The finder's two readings of a color identity: Scryfall `id=` and `id<=`.
const COMMANDER_COLOR_MODES = colorModeOptions(['all', 'within']);

const playstyleLabels = (ids: readonly string[]): string[] =>
  ids.flatMap((id) => {
    const p = playstyleById(id);
    return p ? [p.label] : [];
  });

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
  ideaFinder,
}: Props) {
  const pdh = format === 'paupercommander';
  const isPhone = useMediaQuery('(max-width: 599px)');
  const baseId = useId();
  // EDHREC's Voltron veto (golden R11) for every commander listed here: the shipped snapshot, so
  // "Plays like" and the Voltron filter agree with the commander profile.
  const voltronVeto = useVoltronVeto();
  const filtersId = `${baseId}-filters`;
  // The picked commander's own page, once any surface cached it, vetoes too: the profile card
  // below this chip reads the same cache.
  const pickedProfile = useCommanderProfile(value);

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
  const legendByName = useMemo(
    () => new Map(collectionLegends.map((c) => [c.name.toLowerCase(), c])),
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
  // Cut for the target bracket when one is chosen; cards whose every copy is
  // in one of your decks are labeled rather than counted as free.
  const [bracket, setBracket] = useBracketPref();
  const allocations = useAllocations();
  const heldBy = useMemo(
    () => heldByDecks(collectionCards, allocations),
    [collectionCards, allocations]
  );
  const { readiness, ensureReadiness } = useCommanderReadiness({
    canScore,
    ownedCardNames,
    heldBy,
    bracket,
  });

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
    // 'within' is the default: a saved 'exact' choice is kept, nothing saved reads within.
    readPref(COLOR_MODE_KEY) === 'exact' ? 'exact' : 'within'
  );
  const [playstyleIds, setPlaystyleIds] = useState<string[]>([]);
  const [sortChoice, setSortChoice] = useState<FinderSort | null>(
    initialSearchMode === 'binder' ? 'owned' : null
  );
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // ── Deck idea (generator layout only) ─────────────────────────────────
  const ideaOn = !!ideaFinder;
  const ideaState = useIdeaIndex(ideaOn);
  const ideaIndex = ideaState.status === 'ready' ? ideaState.index : null;
  // `undefined` until the player picks or removes one: the `?idea=` link applies by derivation,
  // once the closed list has loaded (an unknown slug applies nothing).
  const [ideaPick, setIdea] = useState<Idea | null | undefined>(undefined);
  const initialSlug = ideaFinder?.initialSlug ?? null;
  const idea: Idea | null =
    ideaPick !== undefined
      ? ideaPick
      : ideaIndex && initialSlug
        ? (findIdea(ideaIndex, initialSlug) ?? null)
        : null;
  const [commanderNames, setCommanderNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!ideaOn) return;
    let cancelled = false;
    fetchAllCommanderNames()
      .then((names) => {
        if (!cancelled) setCommanderNames(names);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ideaOn]);

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
        classifyOwnedCommanderPlaystyles(legend, {
          voltronVetoed: isVoltronVetoedByName(voltronVeto, legend.name),
        }).map((m) => m.playstyle.id)
      );
    }
    return map;
  }, [collectionLegends, voltronVeto]);

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
  // The key summarizes everything the fetch reads, so the effect runs once
  // per distinct request rather than once per `query` identity.
  const remoteKey = JSON.stringify([
    activeSource,
    pdh,
    idea?.slug ?? null,
    // With an idea applied, typed text only narrows the list by name here, so it is not a fetch.
    !idea && query.text.trim().length >= 2 ? query.text.trim() : '',
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
  const ideaRef = useRef(idea);
  useEffect(() => {
    ideaRef.current = idea;
  }, [idea]);

  useEffect(() => {
    const ideaNow = ideaRef.current;
    if (activeSource !== 'all' && !ideaNow) return;
    let cancelled = false;
    const q = queryRef.current;
    const browse = ideaNow ? true : !isSearching(q) && !pdh;
    const from = browse ? 'edhrec' : 'scryfall';
    const ideaSlug = ideaNow?.slug ?? null;
    const settle = (next: Omit<RemoteResult, 'key' | 'from' | 'idea'>) => {
      if (!cancelled) setRemote({ key: remoteKey, from, idea: ideaSlug, ...next });
    };
    void (async () => {
      // Keep the previous tiles up, dimmed, instead of collapsing the grid.
      setRemote((prev) => ({
        key: remoteKey,
        from,
        idea: ideaSlug,
        status: 'loading',
        entries: prev && prev.idea === ideaSlug ? prev.entries : [],
        total: prev && prev.idea === ideaSlug ? prev.total : 0,
      }));
      try {
        if (ideaNow) {
          // The idea's EDHREC list, with deck counts for that idea. One color combination asks
          // EDHREC for that page; a page it lacks falls back to every color, and says so.
          const exact = q.colors.size > 0 && q.colorMode === 'exact';
          const data = await fetchTagPageData(ideaNow.slug, exact ? [...q.colors] : [], Infinity);
          if (!data) throw new Error('offline');
          const commanders = await backfillColorIdentities(data.commanders);
          const fellBack = exact && data.colorSlug === null;
          const entries = commanders
            .filter(
              (c) =>
                fellBack ||
                (!(c.colorsUnknown && q.colors.size > 0) &&
                  colorIdentityMatches(c.colorIdentity, q.colors, q.colorMode))
            )
            .map(popularEntry);
          settle({ status: 'done', entries, total: entries.length, colorFallback: fellBack });
          return;
        }
        if (browse) {
          const list = await fetchPopular(q.colors, q.colorMode);
          const entries = list.filter((c) => !c.name.includes('//')).map(popularEntry);
          settle({ status: 'done', entries, total: entries.length });
          return;
        }
        const regex = commanderFinderSupportsRegex();
        const selected = q.playstyleIds;
        const veto = await loadVoltronVeto();
        // Only the Voltron filter is emptied by the veto: a vetoed commander has no other reason
        // to be listed under it.
        const onlyVoltron = selected.length > 0 && selected.every((id) => id === 'voltron');
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
          const vetoed = isVoltronVetoedByName(veto, card.name);
          if (vetoed && onlyVoltron) return [];
          let ids = classifyCommanderPlaystyles(card, { voltronVetoed: vetoed }).map(
            (m) => m.playstyle.id
          );
          for (const id of tagStyles.get(k) ?? []) {
            if (!ids.includes(id) && !(vetoed && id === 'voltron')) ids = [id, ...ids];
          }
          // Scryfall already applied a lone playstyle's clause (typal rides on
          // otag:typal, which the local reader can't always see), so trust it.
          if (regex && selected.length === 1 && !ids.includes(selected[0]) && !vetoed) {
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
              const vetoed = isVoltronVetoedByName(veto, c.name);
              if (vetoed && onlyVoltron) continue;
              if (c.colorsUnknown && q.colors.size > 0) continue;
              if (!colorIdentityMatches(c.colorIdentity, q.colors, q.colorMode)) continue;
              seen.add(k);
              entries.push({
                ...popularEntry(c, 100_000 + entries.length),
                playstyleIds: (tagStyles.get(k) ?? []).filter(
                  (id) => !(vetoed && id === 'voltron')
                ),
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
          error: ideaNow
            ? "Couldn't reach EDHREC for this idea's commanders. Check your connection and try again."
            : browse
              ? "Couldn't reach EDHREC for popular commanders. Search by name instead."
              : userMessage(e, "Couldn't run that search. Check your connection and try again."),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteKey, activeSource, pdh]);

  const current = remote?.key === remoteKey ? remote : null;
  const fetchesRemote = activeSource === 'all' || !!idea;
  const loading = fetchesRemote && (current === null || current.status === 'loading');
  // The idea's whole list, before the box's name narrowing and "In my collection".
  const ideaList = useMemo<Entry[]>(() => (idea ? (remote?.entries ?? []) : []), [idea, remote]);
  const entries = useMemo<Entry[]>(() => {
    if (idea) {
      const q = normalizeQuery(query.text);
      return ideaList.flatMap((e) => {
        if (q.length >= 2 && !normalizeQuery(e.name).includes(q)) return [];
        if (activeSource !== 'owned') return [e];
        const legend = legendByName.get(e.name.toLowerCase());
        return legend ? [{ ...e, owned: legend, imageUrl: legend.imageNormal }] : [];
      });
    }
    return activeSource === 'owned' ? ownedEntries : (remote?.entries ?? []);
  }, [idea, ideaList, query.text, activeSource, legendByName, ownedEntries, remote]);
  const total = idea
    ? entries.length
    : activeSource === 'owned'
      ? ownedEntries.length
      : (remote?.total ?? 0);

  // ── Scoring the whole list for "Most of the deck owned" ───────────────
  // The sort reads a snapshot taken every few scores rather than the live
  // map, so tiles don't jump under the pointer while the list is scored.
  const scoringOn = sort === 'owned' && canScore;
  const scoringKey = `${scoringOn}|${activeSource}|${remoteKey}|${entries.length}|${bracket ?? 'all'}`;
  const [scoring, setScoring] = useState<{ key: string; done: number; of: number } | null>(null);
  const [scoreSnapshot, setScoreSnapshot] = useState<Map<string, number>>(new Map());
  const readinessRef = useRef(readiness);
  useEffect(() => {
    readinessRef.current = readiness;
  }, [readiness]);
  const [snapshotBracket, setSnapshotBracket] = useState(bracket);
  if (snapshotBracket !== bracket) {
    setSnapshotBracket(bracket);
    setScoreSnapshot(new Map());
  }
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    if (!scoringOn) return;
    let cancelled = false;
    const names = scoreShortlist(entriesRef.current, SCORE_CAP).map((e) => e.name);
    if (names.length === 0) return;
    const snapshot = () => {
      const map = new Map<string, number>();
      for (const [k, v] of readinessRef.current) {
        if (v !== 'loading' && v.available) map.set(k, v.weightedPercent ?? v.percent);
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

  const coverageShown = sort === 'owned' && canScore;
  const visibleList = visible.map((e) => e.name);
  const completionFor = useCoverageNotes(coverageShown, visibleList, readiness);

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
  const showBuy = activeSource === 'owned' && sort === 'owned' && canScore && !searching;
  const { buyShown, buyPrices } = useBuyCandidates({
    showBuy,
    colors,
    colorMode,
    ownedLegendNames,
    readiness,
    ensureReadiness,
  });

  // ── Selection ─────────────────────────────────────────────────────────
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // E283: browsing what you own by coverage is a build-from-my-collection
  // intent, so the caller preselects owned-only settings for that pick.
  const fromBinder = activeSource === 'owned' && sort === 'owned' && !!onSelectFromBinder;

  const finish = async (card: ScryfallCard, viaBinder: boolean, numDecks?: number) => {
    if (viaBinder && onSelectFromBinder) onSelectFromBinder(card);
    // With an idea applied the page also preselects the commander's theme of that idea.
    if (idea && ideaFinder) await ideaFinder.onPickWithIdea(card, idea, numDecks);
    else if (!(viaBinder && onSelectFromBinder)) onSelect(card);
    setText('');
  };

  const selectEntry = async (entry: Entry) => {
    setError(null);
    setSelecting(entry.key);
    try {
      if (entry.owned) {
        // The exact printing you own, so the deck binds the copy on screen.
        await finish(
          await getOwnedPrinting(entry.owned.scryfallId, entry.owned.name),
          fromBinder,
          entry.numDecks
        );
      } else if (entry.card) {
        await finish(entry.card, false, entry.numDecks);
      } else {
        await finish(await getCardByName(entry.name), false, entry.numDecks);
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
      if (activeSource === 'all' && !pdh && !searching && colors.size === 0 && !idea) {
        const pick = pickRandom((await fetchAllCommanderNames()).filter((n) => !n.includes('//')));
        if (!pick) {
          setError("Couldn't load EDHREC's commander list. Try again.");
          return;
        }
        await finish(await getCardByName(pick), false);
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
  if (value && ideaFinder) {
    return (
      <div className="commander-search commander-finder is-ideas">
        <CommanderSummaryRow
          card={value}
          note={ideaFinder.selectedNote}
          onChange={() => onSelect(null)}
          extra={ideaFinder.selectedExtra}
        />
      </div>
    );
  }
  if (value) {
    return (
      <CommanderPick
        value={value}
        canScore={canScore}
        readiness={readiness.get(value.name.toLowerCase())}
        voltronVetoed={
          isVoltronVetoedByName(voltronVeto, value.name) || !!pickedProfile?.voltronVetoed
        }
        onChange={() => onSelect(null)}
      />
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
    ...(canScore
      ? [{ value: 'owned' as const, label: isPhone ? 'Most owned' : 'Most of the deck owned' }]
      : []),
    { value: 'name', label: 'Name' },
    // The popular list carries no mana values.
    ...(!idea && (activeSource === 'owned' || searching || pdh)
      ? [{ value: 'mv' as const, label: 'Mana value' }]
      : []),
  ];

  const checking = scoringNow
    ? ` · checking coverage, ${scoringNow.done} of ${scoringNow.of} done`
    : '';
  // The popular list only takes colors, and its status line names them.
  const browsingPopular =
    activeSource === 'all' && current?.from === 'edhrec' && current.status === 'done';
  // While a search runs the last results stay up, dimmed; their count does not,
  // or the line names the new query over a list that isn't its answer (E635).
  const status = loading
    ? 'Searching…'
    : idea
      ? `${count(total)}${activeSource === 'owned' ? ' you own' : ''}${checking}`
      : activeSource === 'owned'
        ? `${count(total)} you own${checking}`
        : browsingPopular
          ? `Popular ${comboName ? `${comboName} ` : ''}commanders on EDHREC${checking}`
          : `${count(total)}${checking}`;

  const gridTitle = idea
    ? idea.kind === 'typal'
      ? `Commanders that lead ${idea.name.toLowerCase()}`
      : `Commanders built around ${idea.name}`
    : activeSource === 'owned'
      ? 'Commanders you own'
      : searching || colors.size > 0
        ? 'Matching commanders'
        : 'Most built commanders';
  const popularBrowse = browsingPopular && colors.size === 0;
  const coverageHint = coverageHintFor(entries.length, SCORE_CAP, bracket, nouns, popularBrowse);

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
      <div className="commander-finder-row is-stacked">
        <span className="commander-finder-label" id={`${baseId}-colors`}>
          Color
        </span>
        <div className="commander-finder-control" role="group" aria-labelledby={`${baseId}-colors`}>
          <ManaColorPicker
            colors={[...colors]}
            onColorsChange={(next) => setColors(exclusiveColorless(colors, next))}
            mode={colorMode === 'exact' ? 'all' : 'within'}
            modes={COMMANDER_COLOR_MODES}
            onModeChange={(next) => setColorMode(next === 'within' ? 'within' : 'exact')}
            hint={colorModeHint(colors, colorMode)}
          />
          {comboName && <span className="commander-finder-combo">{comboName}</span>}
        </div>
      </div>
      {!ideaFinder && (
        <div className="commander-finder-row">
          <span className="commander-finder-label" id={`${baseId}-styles`}>
            Playstyle
          </span>
          <div
            className="commander-finder-control"
            role="group"
            aria-labelledby={`${baseId}-styles`}
          >
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
      )}
    </div>
  );

  const filterBody = (
    <>
      {(hasLegends || isPhone) && (
        <div className="row-between row-between--snug">
          {hasLegends && (
            <SegmentedControl
              ariaLabel={`Which ${nouns}`}
              value={activeSource}
              onChange={setSource}
              options={[
                { value: 'all', label: isPhone ? 'All' : `All ${nouns}` },
                {
                  value: 'owned',
                  label: `${isPhone || ideaFinder ? 'Mine' : 'In my collection'} · ${collectionLegends.length.toLocaleString()}`,
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

      <div className={`commander-finder-toolbar${ideaFinder ? ' is-filter-row' : ''}`}>
        {!ideaFinder && (
          <p className="commander-finder-status" role="status" aria-live="polite">
            <span className="commander-finder-status-count">{status}</span>
            {summary && !isPhone && !browsingPopular && (
              <span className="commander-finder-summary"> · {summary}</span>
            )}
          </p>
        )}
        <div className="commander-finder-actions">
          {anyFilter && !isPhone && (
            <Button variant="link" onClick={clearAll}>
              Clear all
            </Button>
          )}
          {(coverageShown || ideaFinder) && (
            <SelectMenu
              label="Bracket"
              ariaLabel="Target bracket for coverage"
              value={bracket ?? 0}
              options={BRACKET_OPTIONS}
              onChange={(next) => setBracket(next === 0 ? null : next)}
            />
          )}
          <SelectMenu
            label="Sort"
            ariaLabel="Sort commanders"
            value={sort}
            options={sortOptions}
            onChange={setSortChoice}
          />
          <CommanderRandomButton
            compact={isPhone}
            busy={randomLoading}
            disabled={randomLoading || selecting !== null || (loading && entries.length === 0)}
            onClick={() => void handleRandom()}
          />
        </div>
      </div>
    </>
  );

  return (
    <div className={`commander-search commander-finder${ideaFinder ? ' is-ideas' : ''}`}>
      {ideaFinder ? (
        <IdeaSearchBox
          index={ideaIndex}
          commanderNames={commanderNames}
          ownedNames={ownedLegendNames}
          text={text}
          onText={setText}
          idea={idea}
          onIdea={setIdea}
          onPickCommander={async (name) => {
            await finish(await getCardByName(name), false);
          }}
          nouns={nouns}
        />
      ) : (
        <SearchPill
          className="commander-finder-search"
          inputType="text"
          placeholder="Name, creature type or rules text"
          value={text}
          onChange={setText}
          ariaLabel={`Search ${nouns} by name, type or rules text`}
        />
      )}
      {text.trim().length > 0 && !idea && (
        <p className="commander-finder-syntax">
          Scryfall syntax works too: <code>o:&quot;dies&quot;</code> <code>t:vampire</code>{' '}
          <code>pow&gt;=5</code>
        </p>
      )}

      {ideaFinder && !isPhone ? (
        <div className="commander-finder-filterbar">{filterBody}</div>
      ) : (
        filterBody
      )}

      {ideaFinder && !idea && !text.trim() && ideaIndex && (
        <BuildAroundRows index={ideaIndex} onPick={setIdea} />
      )}
      {ideaFinder && idea && ideaIndex && (
        <IdeaStrip
          idea={idea}
          index={ideaIndex}
          leaders={ideaList.map((e) => e.name)}
          onIdea={setIdea}
          busy={selecting !== null}
          onPickForMe={
            ideaList.length > 0
              ? () => {
                  // The most built commander you own, else the most built.
                  const pick = ideaList.find((e) => ownedLegendNames.has(e.name.toLowerCase()));
                  const entry = pick ?? ideaList[0];
                  const legend = legendByName.get(entry.name.toLowerCase());
                  void selectEntry(legend ? { ...entry, owned: legend } : entry);
                }
              : null
          }
        />
      )}
      {ideaFinder && current?.colorFallback && idea && (
        <p className="commander-finder-note" role="status">
          EDHREC has no {comboName.toLowerCase()} list for {idea.name.toLowerCase()}. Showing every
          color.
        </p>
      )}
      {ideaFinder && (
        <div className="commander-finder-gridhead">
          <h3 className="commander-finder-gridtitle">{gridTitle}</h3>
          <p className="commander-finder-status" role="status" aria-live="polite">
            <span className="commander-finder-status-count">{status}</span>
          </p>
        </div>
      )}

      {coverageShown && coverageHint && <p className="commander-finder-hint">{coverageHint}</p>}

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
                  <span className="text-stack text-stack--auto">
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
              {idea
                ? `No ${idea.name.toLowerCase()} ${nouns} match these filters.`
                : activeSource === 'owned' && !anyFilter
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
                    colorsUnknown={e.colorsUnknown}
                    comboName={colorComboName(e.colors)}
                    reason={matchReason(e, query.text)}
                    owned={activeSource === 'all' && ownedLegendNames.has(e.name.toLowerCase())}
                    readiness={canScore ? readiness.get(e.name.toLowerCase()) : undefined}
                    coverageBar={sort === 'owned'}
                    completion={completionFor(e.name)}
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
                        <span className="truncate-meta truncate-meta--secondary">
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

        {showBuy && (
          <CommanderLeans
            cards={collectionCards}
            colors={colors}
            readiness={readiness}
            ensureReadiness={ensureReadiness}
            isOwned={(n) => ownedLegendNames.has(n.toLowerCase())}
            selectingName={selecting}
            onPick={(name) => {
              const owned = collectionLegends.find((c) => c.name === name);
              void selectEntry({ key: name, name, colors: [], playstyleIds: [], owned });
            }}
          />
        )}
      </div>

      {error && (
        <p className="commander-search-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
