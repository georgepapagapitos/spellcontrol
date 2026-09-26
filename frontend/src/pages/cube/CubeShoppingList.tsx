import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyStateMark } from '../../components/shared/EmptyStateMark';
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
import { loadCubeSignal, rankedCubeSignalNames } from '../../lib/cube/signal';
import { fetchCubeOracle } from '../../lib/cube/oracle';
import { namesToCubePool } from '../../lib/cube/pool';
import { formatExclusion } from '../../lib/cube/play-format';
import { ensureCardTags, getCardTags } from '@/lib/card-tags';

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

/** One ranked row plus its resolved market price (`null` = not priced yet). */
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
      try {
        // The candidate walk below reads `getCardTags`/`rankedCubeSignalNames`
        // SYNCHRONOUSLY — both are empty until their snapshot has loaded, so
        // both loaders are awaited explicitly here rather than assumed as a
        // side effect of `loadPool` (whose own contract is only "returns a
        // pool"; relying on its internals loading these too is what let a
        // Commander-only / group-hug candidate through silently before this
        // fix, and would break again the moment `loadPool` is backed by
        // anything else — a mock, a future refactor of useOwnedCubePool).
        const [builtPool] = await Promise.all([loadPool(), ensureCardTags(), loadCubeSignal()]);
        if (cancelled) return;
        if (!builtPool) throw new Error("Couldn't load your collection's cards. Try again.");

        const format = target.cube.format ?? 'limited';
        const ownedNames = new Set(collectionCards.map((c) => c.name));
        const inCubeNames = new Set(target.cube.picks.map((p) => p.card.name));
        const names: string[] = [];
        for (const name of rankedCubeSignalNames()) {
          if (names.length >= CANDIDATE_LIMIT) break;
          if (ownedNames.has(name) || inCubeNames.has(name)) continue;
          if (formatExclusion(format, getCardTags(name))) continue;
          names.push(name);
        }

        const enriched = await fetchCubeOracle(names, collectionCards);
        if (cancelled) return;
        const candidates = namesToCubePool(names, collectionCards, enriched);
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
        setSelected(new Set(built.map((r) => r.card.oracleId)));
        setVisible(PAGE_SIZE);
        setStatus('ready');

        const priceNames = [...new Set(built.map((r) => r.card.name))];
        const priced = priceNames.length > 0 ? await getCardsByNames(priceNames) : new Map();
        if (!cancelled) setPriceByName(priced);
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
  const total = useMemo(() => priced.reduce((sum, p) => sum + (p.price ?? 0), 0), [priced]);
  const unpricedCount = useMemo(() => priced.filter((p) => p.price == null).length, [priced]);
  const visibleRows = priced.slice(0, visible);
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const handleRetry = useCallback(() => setRetryToken((t) => t + 1), []);
  const handleToggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.card.oracleId)));
  };
  const handleToggleRow = (oracleId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(oracleId)) next.delete(oracleId);
      else next.add(oracleId);
      return next;
    });
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
        const selectedRows = rows.filter((r) => selected.has(r.card.oracleId));
        const cards: { card: EnrichedCard; quantity: number }[] = [];
        let unresolved = 0;
        for (const r of selectedRows) {
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
      <div className="empty-state">
        <EmptyStateMark />
        <p className="empty-state-tagline">Nothing you could buy beats what's in the cube.</p>
        <p className="empty-state-hint">
          Every eligible card in your collection already outranks what's on the market for its slot.
          Check back after your collection or the cube signal changes.
        </p>
      </div>
    );
  }

  return (
    <div className="cube-shop">
      <div className="cube-shop-toolbar">
        <span className="cube-shop-summary">
          <b>{rows.length}</b> {rows.length === 1 ? 'card' : 'cards'} to consider ·{' '}
          <b>{formatMoney(total, { currency })}</b> total
          {unpricedCount > 0 && ` · ${unpricedCount} without a price yet`}
        </span>
        <div className="cube-shop-actions">
          <Button variant="link" onClick={handleToggleAll}>
            {allSelected ? 'Clear selection' : 'Select all'}
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0 || sending}
            onClick={() => setListOpen(true)}
          >
            Add selected ({selected.size}) to a want list
          </Button>
        </div>
      </div>
      <ul className="cube-rows">
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
                    <span
                      className={`cube-row-price${price == null ? ' cube-row-price-unpriced' : ''}`}
                    >
                      {price == null ? 'No price yet' : formatMoney(price, { currency })}
                    </span>
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
          <Button onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Show more ({priced.length - visible} left)
          </Button>
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
