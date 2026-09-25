import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './cube.css';
import { BackLink } from '../../components/BackLink';
import { PageHeader } from '../../components/PageHeader';
import { Disclosure } from '../../components/shared/form';
import { NameInputDialog } from '../../components/NameInputDialog';
import { useCollectionStore } from '../../store/collection';
import { useToastsStore } from '../../store/toasts';
import { useCubeStore } from '../../store/cube';
import { DEFAULT_POOL_FILTERS, type PoolFilters } from '../../lib/cube/pool-filters';
import { SelectMenu } from '../../components/SelectMenu';
import { InfoTip } from '../../components/InfoTip';
import { formatMoney } from '../../lib/format-money';
import { useCurrency, type Currency } from '../../lib/currency';
import { Link } from 'react-router-dom';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { useOwnedCubePool } from '../../lib/cube/use-owned-pool';
import type { ScryfallCard } from '@/deck-builder/types';
import { CubeSize } from '../../lib/cube/targets';
import { generateCubeAsync, type CubeProgress } from '../../lib/cube/generate-async';
import { toCubeCobraList } from '../../lib/cube/format';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import {
  useOwnershipFor,
  CubeEmptyState,
  CubeSizePicker,
  CardPrioritySegmented,
  CubeLoadingBlock,
  CubeErrorBlock,
  type CardPriority,
} from './shared';
import { CubeResult } from './CubeResult';

import { userMessage } from '@/lib/user-error';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import { Button } from '../../components/shared/Button';

const PRICE_CEILINGS: (number | null)[] = [null, 1, 2, 5, 10];

function poolFiltersSummary(filters: PoolFilters, currency: Currency): string {
  const source =
    filters.source === 'available'
      ? 'Available cards'
      : filters.source === 'spares'
        ? 'Spares only'
        : 'Everything you own';
  const price =
    filters.maxPrice === null
      ? 'any price'
      : `up to ${formatMoney(filters.maxPrice, { currency, wholeDollars: true })}`;
  const rarity =
    filters.rarity === 'any'
      ? 'any rarity'
      : filters.rarity === 'peasant'
        ? 'commons and uncommons'
        : 'commons only';
  return `${source} · ${price} · ${rarity}`;
}

/**
 * "Draw from" — the three pool pickers (source, price ceiling, rarity cap)
 * moved inside a closed `Disclosure` whose summary states the current
 * setting (STYLE_GUIDE § Config surfaces: "defaults most people keep are
 * Disclosure rows that state their value").
 */
function PoolFilterRow({
  filters,
  onChange,
}: {
  filters: PoolFilters;
  onChange: (next: PoolFilters) => void;
}) {
  const currency = useCurrency();
  const price = (v: number | null) =>
    v === null ? 'Any price' : `Up to ${formatMoney(v, { currency, wholeDollars: true })}`;
  return (
    <Disclosure title="Draw from" summary={poolFiltersSummary(filters, currency)}>
      <p className="cube-pool-filters-hint">
        <InfoTip
          label="Draw from"
          text="Available cards are the copies no deck or physical cube has claimed, so what you build is what you can pull. Spares only also needs two or more copies, so your singles stay in their binders. A price ceiling reads the cheapest copy you own at today's market price; the rarity cap reads the printing you own."
        />
      </p>
      <div className="cube-pool-filters">
        <SelectMenu<PoolFilters['source']>
          label="Cards"
          value={filters.source}
          onChange={(source) => onChange({ ...filters, source })}
          options={[
            { value: 'available', label: 'Available' },
            { value: 'spares', label: 'Spares only' },
            { value: 'all', label: 'Everything I own' },
          ]}
        />
        <SelectMenu<string>
          label="Price"
          value={String(filters.maxPrice)}
          onChange={(v) => onChange({ ...filters, maxPrice: v === 'null' ? null : Number(v) })}
          options={PRICE_CEILINGS.map((v) => ({ value: String(v), label: price(v) }))}
        />
        <SelectMenu<PoolFilters['rarity']>
          label="Rarity"
          value={filters.rarity}
          onChange={(rarity) => onChange({ ...filters, rarity })}
          options={[
            { value: 'any', label: 'Any rarity' },
            { value: 'peasant', label: 'Commons and uncommons' },
            { value: 'pauper', label: 'Commons only' },
          ]}
        />
      </div>
    </Disclosure>
  );
}

/** `/decks/cube/new/collection` — build a cube from the collection. Phase 3a's
 *  own controls: size (SelectMenu, six options), card priority (a 3-stop
 *  SegmentedControl replacing the raw synergy slider), and "Draw from" behind
 *  a Disclosure. A fresh build always starts blank (never a stale previously
 *  loaded cube's result) — saving hands off to the cube's own page. */
export function CubeBuildPage() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const awaitingFirstPull = useAwaitingFirstPull();
  const pushToast = useToastsStore((s) => s.push);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<PoolFilters>(DEFAULT_POOL_FILTERS);

  const cubeStore = useCubeStore();
  const [size, setSize] = useState<CubeSize>(cubeStore.size);
  // 0 = best cards (today's goodstuff); higher leans into supportable archetypes.
  const [priority, setPriority] = useState<CardPriority>(0);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [fetchProgress, setFetchProgress] = useState<{ fetched: number; total: number } | null>(
    null
  );
  const [refineProgress, setRefineProgress] = useState<CubeProgress | null>(null);
  const genAbort = useRef<AbortController | null>(null);
  useEffect(() => () => genAbort.current?.abort(), []);
  const cube = cubeStore.result;
  const { ownershipFor, committedFor } = useOwnershipFor();
  const { uniqueNames, hidden, load: loadPool } = useOwnedCubePool(filters);

  // This route is always a fresh build — if the store still carries a
  // PREVIOUSLY SAVED cube as the working result (e.g. from a Rebuild elsewhere,
  // or simply a stale reload), drop it once so the build controls open on a
  // clean slate instead of someone else's already-saved cube. An unsaved
  // in-progress build (loadedId null) is left alone so it survives a
  // navigate-away-and-back.
  const clearedStale = useRef(false);
  useEffect(() => {
    if (clearedStale.current) return;
    clearedStale.current = true;
    if (useCubeStore.getState().loadedId) cubeStore.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saveOpen, setSaveOpen] = useState(false);
  const [enrichedMap, setEnrichedMap] = useState<Map<string, ScryfallCard>>(new Map());

  const generate = useCallback(async () => {
    genAbort.current?.abort();
    const controller = new AbortController();
    genAbort.current = controller;
    setStatus('working');
    setError('');
    setFetchProgress(null);
    setRefineProgress(null);
    setEnrichedMap(new Map());
    cubeStore.clear();
    try {
      const pool = await loadPool((fetched, total) => setFetchProgress({ fetched, total }));
      setFetchProgress(null);
      if (!pool) throw new Error("Couldn't load your collection's cards. Try again.");
      const newCube = await generateCubeAsync(
        pool,
        size,
        { synergyLevel: priority, format: filters.format },
        { onProgress: setRefineProgress, signal: controller.signal }
      );
      cubeStore.setResult(size, newCube);
      setStatus('done');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(userMessage(e, "Couldn't build the cube. Try again."));
      setStatus('error');
    }
  }, [loadPool, filters.format, size, priority, cubeStore]);

  const copyList = useCallback(async () => {
    if (!cube) return;
    await navigator.clipboard.writeText(toCubeCobraList(cube.picks));
    pushToast({
      message: `Copied ${cube.picks.length} cards. Paste into CubeCobra's Add Cards.`,
      tone: 'success',
    });
  }, [cube, pushToast]);

  const handleSave = (name: string) => {
    const id = cubeStore.saveCurrent(name, false, [], { synergyLevel: priority, filters });
    setSaveOpen(false);
    if (!id) return;
    pushToast({ message: `Saved "${name}"`, tone: 'success' });
    navigate(`/decks/cube/${id}`);
  };

  useEffect(() => {
    if (cube === null || enrichedMap.size > 0) return;
    let cancelled = false;
    const names = [...new Set(cube.picks.map((p) => p.card.name))];
    getCardsByNames(names).then((enriched) => {
      if (!cancelled) setEnrichedMap(enriched);
    });
    return () => {
      cancelled = true;
    };
  }, [cube, enrichedMap.size]);

  return (
    <div className="cube-page">
      <BackLink to="/decks/cube/new" label="New cube" />
      <PageHeader title="From my collection" />

      {collectionCards.length === 0 && awaitingFirstPull ? (
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">Loading your collection…</span>
        </div>
      ) : collectionCards.length === 0 ? (
        <CubeEmptyState
          message="You haven't imported a collection yet."
          ctaHref="/collection"
          ctaLabel="Import your collection"
          hint="A cube is built from the cards you own. Bring them in first."
        />
      ) : (
        <div className="cube-build">
          <div className="cube-controls">
            <CubeSizePicker
              size={size}
              onSize={setSize}
              shortfallFor={(s) => Math.max(0, s - uniqueNames.length)}
            />
            <CardPrioritySegmented value={priority} onChange={setPriority} />
            <PoolFilterRow filters={filters} onChange={setFilters} />
          </div>

          <div className="cube-footer-answer">
            <p className="cube-pool-note">
              {uniqueNames.length.toLocaleString()} cards to draw from
              {[
                hidden.basics > 0 && `${hidden.basics.toLocaleString()} basic lands left out`,
                hidden.committed > 0 &&
                  `${hidden.committed.toLocaleString()} committed to a deck or cube`,
                hidden.singles > 0 && `${hidden.singles.toLocaleString()} single copies`,
                hidden.commanderOnly > 0 &&
                  `${hidden.commanderOnly.toLocaleString()} Commander-only cards left out`,
                hidden.politics > 0 &&
                  `${hidden.politics.toLocaleString()} multiplayer politics cards left out`,
                hidden.rarity > 0 && `${hidden.rarity.toLocaleString()} above the rarity cap`,
                hidden.price > 0 &&
                  `${hidden.price.toLocaleString()} over ${formatMoney(filters.maxPrice, { wholeDollars: true })}`,
              ]
                .filter((s): s is string => Boolean(s))
                .map((s) => (
                  <span key={s}> · {s}</span>
                ))}
              {hidden.unpriced > 0 && (
                <span>
                  {' · '}
                  {hidden.unpriced.toLocaleString()} without a price yet (
                  <Link to="/collection">refresh prices</Link>)
                </span>
              )}
            </p>
            <Button variant="primary" onClick={generate} disabled={status === 'working'}>
              {status === 'working' ? 'Building…' : cube ? 'Rebuild' : 'Build cube'}
            </Button>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {status === 'working' && (
              <CubeLoadingBlock
                fetchProgress={fetchProgress}
                refineProgress={refineProgress}
                lookupLabel="Looking up your cards"
                finalizingLabel="Selecting your best cards and balancing the cube…"
              />
            )}

            {status === 'error' && <CubeErrorBlock error={error} onRetry={generate} />}

            {status === 'done' && cube && (
              <CubeResult
                cube={cube}
                onCopy={copyList}
                onSave={() => setSaveOpen(true)}
                loaded={null}
                ownershipFor={ownershipFor}
                committedFor={committedFor}
                enrichedMap={enrichedMap}
              />
            )}
          </div>

          {saveOpen && (
            <NameInputDialog
              title="Save this cube"
              label="Cube name"
              placeholder="My Vintage 540"
              confirmLabel="Save"
              onSubmit={handleSave}
              onCancel={() => setSaveOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
