import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import './SetsPage.css';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { fetchPrintings, getSetCards, useSetMap, type SetMap } from '../lib/api';
import {
  CARD_SEARCH_MIN_CHARS,
  SET_SORT_LABEL,
  completionPct,
  computeSetProgress,
  computeSldDropProgress,
  overlaySetOwnership,
  searchCollectionCardSets,
  sortSetRows,
  type CardSetMatch,
  type SetGridRow,
  type SetProgress,
  type SetSortKey,
} from '../lib/set-completion';
import {
  SLD_CODE,
  SLD_UNASSIGNED,
  dropsForNumber,
  useSldDrops,
  type SldDropsIndex,
} from '../lib/sld-drops';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import { CardPreview } from '../components/CardPreview';
import { RarityBadge } from '../components/shared/RarityBadge';
import { Tabs } from '../components/Tabs';
import { MeterBar } from '../components/shared/MeterBar';
import { useSealMoment } from '../components/shared/SealMoment';

/** Sets whose 100%-completion seal already fired this app-open (STYLE_GUIDE
 *  "Completion moments": once per subject per app-open). */
const celebratedSetComplete = new Set<string>();

export function SetsPage() {
  const { code } = useParams();
  return code ? <SetDetail code={code} /> : <SetsIndex />;
}

function releaseYear(releasedAt: string): string {
  return releasedAt ? releasedAt.slice(0, 4) : '';
}

const SORT_OPTIONS: SelectOption<SetSortKey>[] = (
  Object.entries(SET_SORT_LABEL) as [SetSortKey, string][]
).map(([value, label]) => ({ value, label }));

const SORT_STORAGE_KEY = 'sets-sort';

function loadSort(): SetSortKey {
  const saved = localStorage.getItem(SORT_STORAGE_KEY);
  return saved && saved in SET_SORT_LABEL ? (saved as SetSortKey) : 'release';
}

/** Hub link for a progress row — drop rows deep-link into the SLD checklist. */
function setRowLink(s: SetProgress): string {
  const base = `/collection/sets/${s.code.toLowerCase()}`;
  return s.drop ? `${base}?drop=${encodeURIComponent(s.drop)}` : base;
}

/** One completion row — a hub set, or a Secret Lair drop inside the SLD page. */
function SetProgressRow({ s }: { s: SetProgress }) {
  const complete = s.pct === 100;
  return (
    <li>
      <Link
        to={setRowLink(s)}
        className={`sets-row${complete ? ' is-complete' : ''}`}
        aria-label={
          s.total > 0
            ? `${s.name}, ${s.owned} of ${s.total} cards, ${s.pct}% complete`
            : `${s.name}, ${s.owned} cards owned`
        }
      >
        {s.iconSvgUri ? (
          <img src={s.iconSvgUri} alt="" aria-hidden className="sets-row-icon" />
        ) : (
          <span className="sets-row-icon sets-row-icon-ph" aria-hidden />
        )}
        <span className="sets-row-body">
          <span className="sets-row-name">{s.name}</span>
          <span className="sets-row-meta">
            <span className="sets-row-code">{s.code}</span>
            {releaseYear(s.releasedAt) && <span>{releaseYear(s.releasedAt)}</span>}
            <span>
              {s.total > 0
                ? `${s.owned}/${s.total} cards`
                : `${s.owned} ${s.owned === 1 ? 'card' : 'cards'}`}
            </span>
          </span>
          {s.total > 0 && (
            <MeterBar
              value={s.owned}
              max={s.total}
              minPct={1.5}
              color={complete ? 'var(--brand-seal-gold)' : undefined}
              className="sets-row-bar"
            />
          )}
        </span>
        <span className={`sets-row-pct${complete ? ' is-complete' : ''}`}>
          {complete && <CheckCircle2 width={16} height={16} aria-hidden strokeWidth={2.2} />}
          {s.total > 0 ? `${s.pct}%` : '—'}
        </span>
      </Link>
    </li>
  );
}

// ── Card → sets search results (hub "Cards in your collection" section) ─────

interface CardLineProps {
  setCode: string;
  collectorNumber: string;
  setMap: SetMap | undefined;
  sldIndex: SldDropsIndex | null | undefined;
  /** Owned copies of this printing; shown as ×N when > 1. */
  qty?: number;
  /** Owned/Missing badge (all-printings rows only). */
  owned?: boolean;
}

/** One compact "this card lives in this set" line, linking to the checklist. */
function CardSetLine({ setCode, collectorNumber, setMap, sldIndex, qty, owned }: CardLineProps) {
  const meta = setMap?.[setCode];
  // SLD printings deep-link straight to their drop when the map knows it.
  let to = `/collection/sets/${setCode.toLowerCase()}`;
  if (setCode === SLD_CODE && sldIndex) {
    const drops = dropsForNumber(sldIndex, collectorNumber);
    if (drops[0]) to += `?drop=${encodeURIComponent(drops[0].name)}`;
  }
  const setName = meta?.name || setCode;
  return (
    <li>
      <Link
        to={to}
        className="sets-card-line"
        aria-label={`${setName}, #${collectorNumber}${
          owned === undefined ? '' : owned ? ', owned' : ', missing'
        }`}
      >
        {meta?.iconSvgUri ? (
          <img src={meta.iconSvgUri} alt="" aria-hidden className="sets-card-line-icon" />
        ) : (
          <span className="sets-card-line-icon sets-row-icon-ph" aria-hidden />
        )}
        <span className="sets-card-line-name">{setName}</span>
        <span className="sets-card-line-meta">
          {releaseYear(meta?.releasedAt ?? '') && (
            <span>{releaseYear(meta?.releasedAt ?? '')}</span>
          )}
          <span>#{collectorNumber}</span>
          {qty !== undefined && qty > 1 && <span>×{qty}</span>}
        </span>
        {owned !== undefined && (
          <span className={`sets-card-badge ${owned ? 'is-owned' : 'is-missing'}`}>
            {owned ? 'Owned' : 'Missing'}
          </span>
        )}
      </Link>
    </li>
  );
}

const PRINTINGS_PREVIEW = 8;

type PrintingsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; printings: ScryfallCard[] };

/** One matched card: its owned sets, plus an on-demand full printing list. */
function CardMatchGroup({
  match,
  setMap,
  sldIndex,
}: {
  match: CardSetMatch;
  setMap: SetMap | undefined;
  sldIndex: SldDropsIndex | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<PrintingsState>({ status: 'idle' });
  const [showEvery, setShowEvery] = useState(false);

  const ownedSorted = useMemo(
    () =>
      [...match.printings].sort((a, b) =>
        (setMap?.[b.setCode]?.releasedAt ?? '').localeCompare(setMap?.[a.setCode]?.releasedAt ?? '')
      ),
    [match.printings, setMap]
  );

  const loadAll = () => {
    setAll({ status: 'loading' });
    fetchPrintings(match.name)
      .then((printings) => setAll({ status: 'done', printings }))
      .catch(() => setAll({ status: 'error' }));
  };

  const toggleAll = () => {
    const next = !open;
    setOpen(next);
    if (next && all.status === 'idle') loadAll();
  };

  const bodyId = `sets-card-printings-${match.name.replace(/\W+/g, '-').toLowerCase()}`;
  const visible =
    all.status === 'done'
      ? showEvery
        ? all.printings
        : all.printings.slice(0, PRINTINGS_PREVIEW)
      : [];

  return (
    <div className="sets-card-group">
      <h3 className="sets-card-group-name">{match.name}</h3>
      <ul className="sets-card-lines">
        {ownedSorted.map((p) => (
          <CardSetLine
            key={`${p.setCode}:${p.collectorNumber}`}
            setCode={p.setCode}
            collectorNumber={p.collectorNumber}
            qty={p.qty}
            setMap={setMap}
            sldIndex={sldIndex}
          />
        ))}
      </ul>
      <button
        type="button"
        className="sets-card-expander"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggleAll}
      >
        All printings
        {open ? (
          <ChevronUp width={14} height={14} aria-hidden />
        ) : (
          <ChevronDown width={14} height={14} aria-hidden />
        )}
      </button>
      <div id={bodyId} hidden={!open}>
        {all.status === 'loading' && (
          <p className="sets-status" role="status">
            Loading printings…
          </p>
        )}
        {all.status === 'error' && (
          <p className="sets-status" role="alert">
            Couldn't load printings.{' '}
            <button type="button" className="sets-retry" onClick={loadAll}>
              Retry
            </button>
          </p>
        )}
        {all.status === 'done' &&
          (all.printings.length === 0 ? (
            <p className="sets-status" role="status">
              Scryfall lists no printings for {match.name}.
            </p>
          ) : (
            <>
              <ul className="sets-card-lines">
                {visible.map((card) => {
                  const code = (card.set ?? '').toUpperCase();
                  const cn = card.collector_number ?? '';
                  return (
                    <CardSetLine
                      key={card.id}
                      setCode={code}
                      collectorNumber={cn}
                      owned={match.printings.some(
                        (p) => p.setCode === code && p.collectorNumber === cn
                      )}
                      setMap={setMap}
                      sldIndex={sldIndex}
                    />
                  );
                })}
              </ul>
              {!showEvery && all.printings.length > PRINTINGS_PREVIEW && (
                <button
                  type="button"
                  className="sets-card-expander"
                  onClick={() => setShowEvery(true)}
                >
                  Show all {all.printings.length} printings
                </button>
              )}
            </>
          ))}
      </div>
    </div>
  );
}

function SetsIndex() {
  const cards = useCollectionStore((s) => s.cards);
  const setMap = useSetMap();
  const sldIndex = useSldDrops();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SetSortKey>(loadSort);

  // One row per set code — Secret Lair stays a single row here; its per-drop
  // breakdown lives inside the SLD page ("Your drops"), not at the top level.
  const progress = useMemo(
    () => sortSetRows(computeSetProgress(cards, setMap), sort),
    [cards, setMap, sort]
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return progress;
    return progress.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [progress, query]);
  const completeCount = useMemo(() => progress.filter((s) => s.pct === 100).length, [progress]);
  // Card-name search: which sets is this card in? (fires at 3+ characters)
  const cardResults = useMemo(() => searchCollectionCardSets(cards, query), [cards, query]);

  return (
    <div className="sets-page">
      <header className="binder-hero">
        <h1 className="binder-hero-name">Sets</h1>
        <p className="binder-hero-meta sets-page-sub">
          {progress.length === 0
            ? 'Track how much of each Magic set you own.'
            : `${progress.length} ${progress.length === 1 ? 'set' : 'sets'} in your collection` +
              (completeCount > 0 ? ` · ${completeCount} complete` : '')}
        </p>
      </header>

      {progress.length === 0 ? (
        <div className="sets-empty">
          <p>No sets to track yet — your collection is empty.</p>
          <Link to="/collection" className="sets-empty-link">
            Add or import cards to start completing sets.
          </Link>
        </div>
      ) : (
        <>
          <div className="sets-toolbar">
            <input
              type="search"
              className="sets-search"
              placeholder="Filter sets or search a card…"
              aria-label="Filter sets by name or code, or search cards by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <SelectMenu
              label="Sort"
              ariaLabel="Sort sets"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(s) => {
                setSort(s);
                localStorage.setItem(SORT_STORAGE_KEY, s);
              }}
              className="sets-sort-menu"
            />
          </div>
          {shown.length === 0 && cardResults.total === 0 ? (
            <p className="sets-empty" role="status">
              No sets{query.trim().length >= CARD_SEARCH_MIN_CHARS ? ' or cards' : ''} match “
              {query.trim()}”.
            </p>
          ) : (
            <>
              {shown.length > 0 && (
                <ul className="sets-list">
                  {shown.map((s) => (
                    <SetProgressRow key={s.code} s={s} />
                  ))}
                </ul>
              )}
              {cardResults.total > 0 && (
                <section className="sets-card-results" aria-label="Cards in your collection">
                  <h2 className="sets-detail-drops-title">Cards in your collection</h2>
                  {cardResults.matches.map((m) => (
                    <CardMatchGroup key={m.name} match={m} setMap={setMap} sldIndex={sldIndex} />
                  ))}
                  {cardResults.total > cardResults.matches.length && (
                    <p className="sets-card-more">
                      +{cardResults.total - cardResults.matches.length} more{' '}
                      {cardResults.total - cardResults.matches.length === 1 ? 'card' : 'cards'}{' '}
                      match — keep typing to narrow.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; cards: ScryfallCard[] };

const LOADING: FetchState = { status: 'loading' };

type OwnFilter = 'all' | 'owned' | 'missing';

function SetDetail({ code }: { code: string }) {
  const upper = code.toUpperCase();
  const setMap = useSetMap();
  const meta = setMap?.[upper];
  const collection = useCollectionStore((s) => s.cards);
  const addCard = useCollectionStore((s) => s.addCard);
  const pushToast = useToastsStore((s) => s.push);

  // Secret Lair drop filter (E140): `?drop=<name>` narrows the flat SLD
  // checklist to one drop (or the unassigned remainder). Inert for other sets.
  const [searchParams, setSearchParams] = useSearchParams();
  const isSld = upper === SLD_CODE;
  const sldIndex = useSldDrops();
  const dropParam = isSld ? searchParams.get('drop') : null;

  // Result is keyed by code+attempt; a key mismatch (new set / retry) reads
  // as loading, so the effect never has to set state synchronously.
  const [attempt, setAttempt] = useState(0);
  const fetchKey = `${code}:${attempt}`;
  const [result, setResult] = useState<{
    key: string;
    state: Exclude<FetchState, { status: 'loading' }>;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSetCards(code)
      .then((cards) => {
        if (!cancelled) setResult({ key: fetchKey, state: { status: 'done', cards } });
      })
      .catch(() => {
        if (!cancelled)
          setResult({
            key: fetchKey,
            state: {
              status: 'error',
              message: navigator.onLine
                ? 'Couldn’t load this set’s card list from Scryfall.'
                : 'You’re offline — set checklists need a connection.',
            },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [code, fetchKey]);
  const state: FetchState = result && result.key === fetchKey ? result.state : LOADING;

  const allRows = useMemo(
    () => (state.status === 'done' ? overlaySetOwnership(state.cards, collection, upper) : []),
    [state, collection, upper]
  );
  const rows = useMemo(() => {
    if (!dropParam || !sldIndex) return allRows;
    if (dropParam === SLD_UNASSIGNED) {
      return allRows.filter(
        (r) => dropsForNumber(sldIndex, r.card.collector_number ?? '').length === 0
      );
    }
    return allRows.filter((r) =>
      dropsForNumber(sldIndex, r.card.collector_number ?? '').some((d) => d.name === dropParam)
    );
  }, [allRows, dropParam, sldIndex]);
  const ownedCount = useMemo(() => rows.filter((r) => r.qty > 0).length, [rows]);
  const pct = completionPct(ownedCount, rows.length);
  const setName = meta?.name || upper;
  /** What this checklist is: the drop when filtered, else the set. */
  const displayName =
    dropParam && dropParam !== SLD_UNASSIGNED
      ? dropParam
      : dropParam === SLD_UNASSIGNED
        ? 'Secret Lair · unassigned'
        : setName;
  const dropOptions = useMemo<SelectOption<string>[]>(
    () =>
      sldIndex
        ? [
            { value: '', label: 'All drops' },
            ...sldIndex.drops.map((d) => ({ value: d.name, label: d.name })),
            { value: SLD_UNASSIGNED, label: 'Unassigned' },
          ]
        : [],
    [sldIndex]
  );
  const dropReleasedAt =
    (dropParam &&
      dropParam !== SLD_UNASSIGNED &&
      sldIndex?.drops.find((d) => d.name === dropParam)?.releasedAt) ||
    '';
  // Per-drop completion over the owned SLD cards — the in-set "Your drops"
  // list (collection-local; renders even while the checklist fetch is out).
  const dropRows = useMemo(
    () =>
      isSld && sldIndex ? computeSldDropProgress(collection, sldIndex, meta?.iconSvgUri ?? '') : [],
    [isSld, sldIndex, collection, meta?.iconSvgUri]
  );

  // Seal moment on an observed <100% → 100% transition (never on mount of an
  // already-complete set), once per set per app-open.
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  const prevPct = useRef<number | null>(null);
  const prevSealKey = useRef<string>('');
  const sealKey = dropParam ? `${upper}:${dropParam}` : upper;
  useLayoutEffect(() => {
    // Switching drops swaps the whole checklist — never read the old drop's
    // pct as "before" for the new one.
    if (prevSealKey.current !== sealKey) {
      prevSealKey.current = sealKey;
      prevPct.current = null;
    }
    if (rows.length > 0 && prevPct.current !== null && prevPct.current < 100 && pct === 100) {
      if (!celebratedSetComplete.has(sealKey)) {
        celebratedSetComplete.add(sealKey);
        fireSealMoment();
        pushToast({
          message: `${displayName} complete — all ${rows.length} cards collected!`,
          tone: 'success',
        });
      }
    }
    prevPct.current = rows.length > 0 ? pct : null;
  }, [pct, rows.length, sealKey, displayName, fireSealMoment, pushToast]);

  const [filter, setFilter] = useState<OwnFilter>('all');
  const filtered = useMemo(
    () =>
      filter === 'owned'
        ? rows.filter((r) => r.qty > 0)
        : filter === 'missing'
          ? rows.filter((r) => r.qty === 0)
          : rows,
    [rows, filter]
  );

  // Carousel over the filtered rows; missing cards are synthetic EnrichedCards
  // (same trick as InlineCardSearch) so CardPreview can render them.
  const previewCards = useMemo(
    () => filtered.map((r) => scryfallToEnrichedCard(r.card)),
    [filtered]
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});

  const addFromSet = async (card: ScryfallCard) => {
    const finish: Finish = (
      !card.finishes || card.finishes.includes('nonfoil') ? 'nonfoil' : card.finishes[0]
    ) as Finish;
    await addCard(card, finish);
    setAddedCounts((prev) => ({ ...prev, [card.id]: (prev[card.id] ?? 0) + 1 }));
  };

  return (
    <div className="sets-page sets-detail">
      {sealMoment}
      <Link to="/collection/sets" className="sets-back">
        <ArrowLeft width={15} height={15} aria-hidden /> All sets
      </Link>
      <header className="binder-hero sets-detail-hero">
        <h1 className="binder-hero-name sets-detail-name">
          {meta?.iconSvgUri && (
            <img src={meta.iconSvgUri} alt="" aria-hidden className="sets-detail-icon" />
          )}
          {displayName}
        </h1>
        <p className="binder-hero-meta sets-page-sub">
          <span className="sets-row-code">{upper}</span>
          {dropParam ? (
            <span> · Secret Lair drop{dropReleasedAt ? ` · released ${dropReleasedAt}` : ''}</span>
          ) : (
            meta?.releasedAt && <span> · released {meta.releasedAt}</span>
          )}
        </p>
      </header>

      {isSld && sldIndex && (
        <div className="sets-drop-picker">
          <SelectMenu
            label="Drop"
            ariaLabel="Filter by Secret Lair drop"
            searchable
            searchPlaceholder="Search drops…"
            value={dropParam ?? ''}
            options={dropOptions}
            onChange={(v) => {
              setSearchParams(v ? { drop: v } : {}, { replace: true });
              setPreviewIndex(null);
            }}
            className="sets-drop-picker-menu"
          />
        </div>
      )}

      {isSld && !dropParam && dropRows.length > 0 && (
        <section className="sets-detail-drops" aria-label="Your Secret Lair drops">
          <h2 className="sets-detail-drops-title">Your drops</h2>
          <ul className="sets-list">
            {dropRows.map((s) => (
              <SetProgressRow key={s.drop} s={s} />
            ))}
          </ul>
        </section>
      )}

      {state.status === 'loading' && (
        <div aria-busy="true">
          <p className="sets-status" role="status">
            Loading the {displayName} checklist…
          </p>
          <div className="set-grid" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="collection-grid-item set-grid-skeleton" />
            ))}
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="sets-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="sets-retry" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </div>
      )}

      {state.status === 'done' && (
        <>
          <div className="sets-detail-progress">
            <p className="sets-detail-count" role="status">
              <strong>
                {ownedCount}/{rows.length}
              </strong>{' '}
              collected · {pct}%
              {pct === 100 && (
                <CheckCircle2
                  className="sets-detail-complete-icon"
                  width={16}
                  height={16}
                  aria-hidden
                  strokeWidth={2.2}
                />
              )}
            </p>
            <MeterBar
              value={ownedCount}
              max={rows.length}
              size="md"
              minPct={1.5}
              color={pct === 100 ? 'var(--brand-seal-gold)' : undefined}
            />
          </div>

          <Tabs
            ariaLabel="Filter cards by ownership"
            variant="scrollable"
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setPreviewIndex(null);
            }}
            tabs={[
              { id: 'all', label: 'All', count: rows.length },
              { id: 'owned', label: 'Owned', count: ownedCount },
              { id: 'missing', label: 'Missing', count: rows.length - ownedCount },
            ]}
          />

          {filtered.length === 0 ? (
            <p className="sets-status" role="status">
              {filter === 'missing'
                ? `You own every card in ${displayName}.`
                : filter === 'owned'
                  ? `Nothing from ${displayName} yet — tap a card to add it.`
                  : `Scryfall lists no cards for ${displayName}.`}
            </p>
          ) : (
            <div className="set-grid">
              {filtered.map((r, idx) => (
                <SetTile key={r.card.id} row={r} onOpen={() => setPreviewIndex(idx)} />
              ))}
            </div>
          )}

          {previewIndex !== null && previewCards[previewIndex] && (
            <CardPreview
              source="search"
              cards={previewCards}
              index={previewIndex}
              binderName=""
              sectionLabels={[]}
              pageNumbers={[]}
              totalPages={0}
              onIndexChange={setPreviewIndex}
              onClose={() => setPreviewIndex(null)}
              getActions={(i) => {
                const row = filtered[i];
                if (!row) return [];
                const added = addedCounts[row.card.id] ?? 0;
                return [
                  {
                    key: 'add',
                    icon:
                      added > 0 ? (
                        <Check width={18} height={18} strokeWidth={2.4} aria-hidden />
                      ) : (
                        <Plus width={18} height={18} strokeWidth={2.4} aria-hidden />
                      ),
                    label: added > 0 ? `Added ×${added}` : row.qty > 0 ? 'Add another' : 'Add',
                    onClick: () => void addFromSet(row.card),
                  },
                ];
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function SetTile({ row, onOpen }: { row: SetGridRow; onOpen: () => void }) {
  const { card, qty } = row;
  const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
  const missing = qty === 0;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`collection-grid-item grid-1x set-grid-item${missing ? ' is-missing' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${card.name}, #${card.collector_number}, ${
        missing ? 'missing' : `owned${qty > 1 ? ` ×${qty}` : ''}`
      }`}
    >
      {img ? (
        <img src={img} alt={card.name} loading="lazy" className="collection-grid-img" />
      ) : (
        <div className="collection-grid-placeholder">{card.name}</div>
      )}
      {card.rarity && <RarityBadge rarity={card.rarity} className="collection-grid-rarity" />}
      <div className="collection-grid-corner">
        <span className="collection-grid-set set-grid-num">#{card.collector_number}</span>
        {qty > 1 && (
          <span className="collection-grid-qty">
            <span className="collection-grid-qty-x" aria-hidden="true">
              ×
            </span>
            {qty}
          </span>
        )}
      </div>
      {missing && (
        <span className="set-grid-missing-chip" aria-hidden>
          Missing
        </span>
      )}
    </div>
  );
}
