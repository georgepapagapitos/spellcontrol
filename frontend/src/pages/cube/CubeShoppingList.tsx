import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../components/shared/EmptyState';
import { Button } from '../../components/shared/Button';
import { SaveToListDialog } from '../../components/SaveToListDialog';
import { CubeLoadingBlock, CubeErrorBlock } from './shared';
import { useCollectionStore } from '../../store/collection';
import { useToastsStore } from '../../store/toasts';
import { useCurrency } from '@/lib/currency';
import { formatMoney } from '../../lib/format-money';
import { userMessage } from '@/lib/user-error';
import { isTrackingList } from '../../lib/lists';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import { getCardsByNames, getCardPrice } from '../../deck-builder/services/scryfall/client';
import type { CardFetchProgress } from '@/deck-builder/services/scryfall/card-repository';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import type { CubeCard } from '../../lib/cube/core';
import type { SavedCube } from '../../store/cube';
import { buildShoppingList, type ShoppingRow } from '../../lib/cube/shopping-list';
import {
  hasCubeSignal,
  loadCubeSignal,
  rankedCubeSignalNames,
  rankedScopedSignalNames,
} from '../../lib/cube/signal';
import { fetchCubeOracle } from '../../lib/cube/oracle';
import { namesToCubePool } from '../../lib/cube/pool';
import { formatExclusion } from '../../lib/cube/play-format';
import type { RarityCap } from '../../lib/cube/pool-filters';
import { ensureCardTags, getCardTags, isCardTagsFailed } from '@/lib/card-tags';

/** How many popular-by-cube-signal names to fetch oracle facts for — a bound
 *  generous enough that ownership/format filtering still leaves a real list,
 *  small enough that it's one oracle-facts request (server chunks at 2000). */
const CANDIDATE_LIMIT = 300;
const PAGE_SIZE = 30;

interface Props {
  target: SavedCube;
  /** Shared with the Cards tab's Swap/Add/Rebuild sheet (`useOwnedCubePool`) so
   *  switching to this tab reuses an already-loaded pool instead of a second
   *  independent fetch. */
  loadPool: (onProgress?: CardFetchProgress) => Promise<CubeCard[] | null>;
}

type Status = 'loading' | 'error' | 'ready';

/** One ranked row plus its resolved market price (`null` = not priced yet,
 *  either because pricing is still in flight or because it genuinely has
 *  none — `pricesReady` (component state) tells the two apart). */
interface PricedRow {
  row: ShoppingRow;
  price: number | null;
}

/**
 * "Shopping list" tab: the cards you don't own that would most improve this
 * cube, ranked by `buildShoppingList` (lib/cube/shopping-list.ts). This
 * component owns candidate SELECTION — the top cube-signal names, minus
 * anything owned/in-cube/format-ineligible — and prices; the ranking math
 * itself lives in the pure library function.
 */
export function CubeShoppingList({ target, loadPool }: Props) {
  const pushToast = useToastsStore((s) => s.push);
  const currency = useCurrency();
  const collectionCards = useCollectionStore((s) => s.cards);
  const listsAll = useCollectionStore((s) => s.lists);
  const createList = useCollectionStore((s) => s.createList);
  const addListEntries = useCollectionStore((s) => s.addListEntries);

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ShoppingRow[]>([]);
  const [priceByName, setPriceByName] = useState<Map<string, ScryfallCard>>(new Map());
  const [pricesReady, setPricesReady] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [listOpen, setListOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setStatus('loading');
      setError('');
      setPricesReady(false);
      try {
        // A pauper/peasant cube ranks candidates from that corpus, not the
        // all-cube signal — otherwise a pauper cube's shopping list would
        // suggest rares and mythics its own pool can never contain. Read from
        // the settings the cube was (re)built with, same as `loadPool` above
        // (CubeDetailPage threads the same `filters` into both).
        const scope: RarityCap = target.settings?.filters.rarity ?? 'any';
        // The candidate walk below reads `getCardTags`/the ranked-name walk
        // SYNCHRONOUSLY — both are empty until their snapshot has loaded, so
        // both loaders are awaited explicitly here rather than assumed as a
        // side effect of `loadPool` (whose own contract is only "returns a
        // pool"; relying on its internals loading these too is what let a
        // Commander-only / group-hug candidate through silently before this
        // fix, and would break again the moment `loadPool` is backed by
        // anything else — a mock, a future refactor of useOwnedCubePool).
        const [builtPool] = await Promise.all([
          loadPool(),
          ensureCardTags(),
          loadCubeSignal(scope),
        ]);
        if (cancelled) return;
        if (!builtPool) throw new Error("Couldn't load your collection's cards. Try again.");
        // Both loaders swallow their own network errors (they degrade to "no
        // signal" rather than reject — see signal.ts / card-tags.ts) so a
        // failed fetch never throws on its own. Left unchecked, that reads as
        // "nothing beats the cube" (the empty state) rather than the failure
        // it is — this is what let a blocked cube-signal request land there.
        if (!hasCubeSignal(scope) || isCardTagsFailed()) {
          throw new Error("Couldn't load card popularity. Try again.");
        }

        const format = target.cube.format ?? 'limited';
        const ownedNames = new Set(collectionCards.map((c) => c.name));
        const inCubeNames = new Set(target.cube.picks.map((p) => p.card.name));
        const rankedNames =
          scope === 'any' ? rankedCubeSignalNames() : rankedScopedSignalNames(scope);
        const names: string[] = [];
        for (const name of rankedNames) {
          if (names.length >= CANDIDATE_LIMIT) break;
          if (ownedNames.has(name) || inCubeNames.has(name)) continue;
          if (formatExclusion(format, getCardTags(name))) continue;
          names.push(name);
        }

        const enriched = await fetchCubeOracle(names, collectionCards);
        if (cancelled) return;
        const candidates = namesToCubePool(names, collectionCards, enriched, scope);
        const ownedOracleIds = new Set(
          collectionCards.map((c) => c.oracleId).filter((id): id is string => Boolean(id))
        );
        const built = buildShoppingList(candidates, target.cube, builtPool, {
          lockedOracleIds: new Set(target.locked ?? []),
          bannedOracleIds: new Set(target.banned ?? []),
          ownedOracleIds,
          synergyLevel: target.settings?.synergyLevel ?? 0,
        });
        if (cancelled) return;
        setRows(built);
        // Only the rows a first paint actually shows start ticked; "Show
        // more" ticks the next page as it reveals them (handleShowMore) — a
        // row never in view is never silently included in the want-list send.
        setSelected(new Set(built.slice(0, PAGE_SIZE).map((r) => r.card.oracleId)));
        setVisible(PAGE_SIZE);
        setStatus('ready');

        const priceNames = [...new Set(built.map((r) => r.card.name))];
        // Pricing is a nice-to-have layered on an already-ranked list — a
        // failed price fetch must not throw the whole tab into the error
        // state and lose that ranking. Caught on its own so a rejection here
        // just leaves every row unpriced; `pricesReady` still flips in
        // `finally` so "No price yet" reads as final, not "…" forever.
        try {
          const pricedMap = priceNames.length > 0 ? await getCardsByNames(priceNames) : new Map();
          if (!cancelled) setPriceByName(pricedMap);
        } catch {
          // Ranked rows are already committed above; leave them priceless.
        } finally {
          if (!cancelled) setPricesReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(userMessage(e, "Couldn't load the shopping list. Try again."));
          setStatus('error');
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // Re-run only when the viewed cube changes or a retry is requested, not on
    // every store tick — same rule CubeDetailPage's own enrichedMap effect
    // follows for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, retryToken]);

  const priced: PricedRow[] = useMemo(
    () =>
      rows.map((row) => {
        const sc = priceByName.get(row.card.name);
        const raw = sc ? getCardPrice(sc, currency) : null;
        const n = raw != null ? Number(raw) : NaN;
        return { row, price: Number.isFinite(n) ? n : null };
      }),
    [rows, priceByName, currency]
  );
  const visibleRows = priced.slice(0, visible);
  const visibleIds = useMemo(() => visibleRows.map((p) => p.row.card.oracleId), [visibleRows]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  // The header and the want-list button both describe the SELECTION, not the
  // whole ranked list — a hidden row is never counted toward either.
  const selectedPriced = useMemo(
    () => priced.filter((p) => selected.has(p.row.card.oracleId)),
    [priced, selected]
  );
  const selectedTotal = useMemo(
    () => selectedPriced.reduce((sum, p) => sum + (p.price ?? 0), 0),
    [selectedPriced]
  );
  const selectedUnpricedCount = useMemo(
    () => selectedPriced.filter((p) => p.price == null).length,
    [selectedPriced]
  );
  // A total is only meaningful once at least one selected row actually has a
  // price — "$0.00 total" when every selection is unpriced isn't a real
  // total, it's zero cards' worth of nothing.
  const selectedHasAnyPrice = selectedPriced.length - selectedUnpricedCount > 0;

  const handleRetry = useCallback(() => setRetryToken((t) => t + 1), []);
  const handleToggleAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds));
  };
  const handleToggleRow = (oracleId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(oracleId)) next.delete(oracleId);
      else next.add(oracleId);
      return next;
    });
  };
  const handleShowMore = () => {
    const newVisible = Math.min(visible + PAGE_SIZE, priced.length);
    const newlyRevealed = priced.slice(visible, newVisible).map((p) => p.row.card.oracleId);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of newlyRevealed) next.add(id);
      return next;
    });
    setVisible(newVisible);
  };

  const wantLists = useMemo(
    () => listsAll.filter((l) => !l.rule && !isTrackingList(l)),
    [listsAll]
  );
  const handleSendToList = useCallback(
    async (dest: { listId: string } | { newName: string }) => {
      setSending(true);
      try {
        const listId = 'listId' in dest ? dest.listId : createList(dest.newName);
        const chosenRows = rows.filter((r) => selected.has(r.card.oracleId));
        const cards: { card: EnrichedCard; quantity: number }[] = [];
        let unresolved = 0;
        for (const r of chosenRows) {
          const sc = priceByName.get(r.card.name);
          if (!sc) {
            unresolved += 1;
            continue;
          }
          cards.push({ card: scryfallToEnrichedCard(sc), quantity: 1 });
        }
        const { added, skipped } = await addListEntries(listId, cards);
        setListOpen(false);
        const listName =
          useCollectionStore.getState().lists.find((l) => l.id === listId)?.name ?? 'list';
        const parts = [
          added > 0 && `Added ${added} ${added === 1 ? 'card' : 'cards'} to "${listName}"`,
          skipped > 0 && `${skipped} already there`,
          unresolved > 0 && `${unresolved} couldn't be matched`,
        ].filter((s): s is string => Boolean(s));
        pushToast({
          message: parts.length > 0 ? parts.join(' · ') : `Nothing new to add to "${listName}"`,
          tone: added > 0 ? 'success' : 'info',
        });
      } finally {
        setSending(false);
      }
    },
    [rows, selected, priceByName, createList, addListEntries, pushToast]
  );

  if (status === 'loading') {
    return (
      <div aria-live="polite" aria-atomic="true">
        <CubeLoadingBlock
          fetchProgress={null}
          refineProgress={null}
          finalizingLabel="Checking cube prices and popularity…"
        />
      </div>
    );
  }

  if (status === 'error') {
    return <CubeErrorBlock error={error} onRetry={handleRetry} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        tagline="Nothing you could buy beats what's in the cube."
        hint="Every eligible card you own already outranks what's on the market."
      />
    );
  }

  return (
    <div className="cube-shop">
      <div className="cube-shop-toolbar">
        <span className="cube-shop-summary">
          <b>{selected.size}</b> of {rows.length} selected
          {!pricesReady ? (
            ' · Pricing…'
          ) : selectedHasAnyPrice ? (
            <>
              {' '}
              · <b>{formatMoney(selectedTotal, { currency })}</b> total
              {selectedUnpricedCount > 0 && ` · ${selectedUnpricedCount} without a price yet`}
            </>
          ) : (
            ' · no prices yet'
          )}
        </span>
        <div className="cube-shop-actions">
          <Button variant="link" onClick={handleToggleAll}>
            {allVisibleSelected ? 'Clear selection' : 'Select all'}
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0 || sending || !pricesReady}
            onClick={() => setListOpen(true)}
          >
            Add {selected.size} to a want list
          </Button>
        </div>
      </div>
      <ul className="cube-rows" aria-busy={!pricesReady}>
        {visibleRows.map(({ row, price }) => {
          const sc = priceByName.get(row.card.name);
          const img = sc?.image_uris?.small ?? sc?.card_faces?.[0]?.image_uris?.small;
          const checked = selected.has(row.card.oracleId);
          return (
            <li key={row.card.oracleId} className="cube-row">
              <label className="cube-row-select">
                <input
                  type="checkbox"
                  className="cube-row-select-input"
                  checked={checked}
                  onChange={() => handleToggleRow(row.card.oracleId)}
                  aria-label={`Select ${row.card.name} to add to a want list`}
                />
                {img ? (
                  <img src={img} alt="" loading="lazy" className="cube-row-thumb" />
                ) : (
                  <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden="true" />
                )}
                <span className="cube-row-body">
                  <span className="cube-row-title">
                    <span className="cube-row-name">{row.card.name}</span>
                    {!pricesReady ? (
                      <span className="cube-row-price cube-row-price-pending" aria-hidden="true">
                        …
                      </span>
                    ) : price == null ? (
                      <span className="cube-row-price cube-row-price-unpriced">No price yet</span>
                    ) : (
                      <span className="cube-row-price">{formatMoney(price, { currency })}</span>
                    )}
                  </span>
                  <span className="cube-row-reason">
                    Replaces <b>{row.replaces.card.name}</b>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {visible < priced.length && (
        <div className="cube-shop-more">
          <Button onClick={handleShowMore}>Show more ({priced.length - visible} left)</Button>
        </div>
      )}
      {listOpen && (
        <SaveToListDialog
          cardCount={selected.size}
          lists={wantLists}
          onSubmit={handleSendToList}
          onCancel={() => setListOpen(false)}
        />
      )}
    </div>
  );
}
