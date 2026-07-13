import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, Plus } from 'lucide-react';
import './SetsPage.css';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { getSetCards, useSetMap } from '../lib/api';
import {
  completionPct,
  computeSetProgress,
  overlaySetOwnership,
  type SetGridRow,
} from '../lib/set-completion';
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

function SetsIndex() {
  const cards = useCollectionStore((s) => s.cards);
  const setMap = useSetMap();
  const [query, setQuery] = useState('');

  const progress = useMemo(() => computeSetProgress(cards, setMap), [cards, setMap]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return progress;
    return progress.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [progress, query]);
  const completeCount = useMemo(() => progress.filter((s) => s.pct === 100).length, [progress]);

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
          <input
            type="search"
            className="sets-search"
            placeholder="Filter sets…"
            aria-label="Filter sets by name or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {shown.length === 0 ? (
            <p className="sets-empty" role="status">
              No sets match “{query.trim()}”.
            </p>
          ) : (
            <ul className="sets-list">
              {shown.map((s) => {
                const complete = s.pct === 100;
                return (
                  <li key={s.code}>
                    <Link
                      to={`/collection/sets/${s.code.toLowerCase()}`}
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
                        {complete && (
                          <CheckCircle2 width={16} height={16} aria-hidden strokeWidth={2.2} />
                        )}
                        {s.total > 0 ? `${s.pct}%` : '—'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
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

  const rows = useMemo(
    () => (state.status === 'done' ? overlaySetOwnership(state.cards, collection, upper) : []),
    [state, collection, upper]
  );
  const ownedCount = useMemo(() => rows.filter((r) => r.qty > 0).length, [rows]);
  const pct = completionPct(ownedCount, rows.length);
  const setName = meta?.name || upper;

  // Seal moment on an observed <100% → 100% transition (never on mount of an
  // already-complete set), once per set per app-open.
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  const prevPct = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (rows.length > 0 && prevPct.current !== null && prevPct.current < 100 && pct === 100) {
      if (!celebratedSetComplete.has(upper)) {
        celebratedSetComplete.add(upper);
        fireSealMoment();
        pushToast({
          message: `${setName} complete — all ${rows.length} cards collected!`,
          tone: 'success',
        });
      }
    }
    prevPct.current = rows.length > 0 ? pct : null;
  }, [pct, rows.length, upper, setName, fireSealMoment, pushToast]);

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
          {setName}
        </h1>
        <p className="binder-hero-meta sets-page-sub">
          <span className="sets-row-code">{upper}</span>
          {meta?.releasedAt && <span> · released {meta.releasedAt}</span>}
        </p>
      </header>

      {state.status === 'loading' && (
        <div aria-busy="true">
          <p className="sets-status" role="status">
            Loading the {setName} checklist…
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
                ? `You own every card in ${setName}.`
                : filter === 'owned'
                  ? `Nothing from ${setName} yet — tap a card to add it.`
                  : `Scryfall lists no cards for ${setName}.`}
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
