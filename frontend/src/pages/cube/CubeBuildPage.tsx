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
import { useAuth } from '../../store/auth';
import { DEFAULT_POOL_FILTERS, type PoolFilters } from '../../lib/cube/pool-filters';
import { SelectMenu } from '../../components/SelectMenu';
import { InfoTip } from '../../components/InfoTip';
import { formatMoney } from '../../lib/format-money';
import { useCurrency, type Currency } from '../../lib/currency';
import { Link } from 'react-router-dom';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { useOwnedCubePool } from '../../lib/cube/use-owned-pool';
import { fetchCubeOracle } from '../../lib/cube/oracle';
import { formatExclusion } from '../../lib/cube/play-format';
import { synergyTags } from '../../lib/cube/synergy-tags';
import { getCardTags } from '../../lib/card-tags';
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
import {
  mergePools,
  filterFriendCards,
  fetchFriendCollection,
  type FriendCard,
} from '../../lib/cube/pool';
import { listFriends, type Friend } from '../../lib/friends-client';
import { CubeResult } from './CubeResult';

import { userMessage } from '@/lib/user-error';
import { Button } from '../../components/shared/Button';

const PRICE_CEILINGS: (number | null)[] = [null, 1, 2, 5, 10];
const MAX_FRIENDS = 3;
type FriendIssue = { username: string; reason: 'private' | 'failed' };

function poolFiltersSummary(
  filters: PoolFilters,
  currency: Currency,
  friendNames: string[]
): string {
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
  const base = `${source} · ${price} · ${rarity}`;
  return friendNames.length > 0 ? `${base} · with ${friendNames.join(', ')}` : base;
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
  friends,
  friendsStatus,
  selectedFriendIds,
  onToggleFriend,
}: {
  filters: PoolFilters;
  onChange: (next: PoolFilters) => void;
  friends: Friend[];
  friendsStatus: 'loading' | 'done' | 'error';
  selectedFriendIds: string[];
  onToggleFriend: (id: string) => void;
}) {
  const currency = useCurrency();
  const price = (v: number | null) =>
    v === null ? 'Any price' : `Up to ${formatMoney(v, { currency, wholeDollars: true })}`;
  const friendNames = selectedFriendIds
    .map((id) => friends.find((f) => f.id === id)?.username)
    .filter((n): n is string => Boolean(n));
  return (
    <Disclosure title="Draw from" summary={poolFiltersSummary(filters, currency, friendNames)}>
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

      <div className="cube-friend-picker">
        <div className="form-field-label">Friends' collections</div>
        {friendsStatus === 'loading' && (
          <p className="cube-collab-friends-loading">Loading friends…</p>
        )}
        {friendsStatus === 'error' && (
          <p className="cube-collab-friends-error">Couldn't load your friends list.</p>
        )}
        {friendsStatus === 'done' && friends.length === 0 && (
          <p className="cube-collab-friends-error">
            You don't have any friends yet. <Link to="/friends">Add friends</Link> to build with
            them.
          </p>
        )}
        {friendsStatus === 'done' && friends.length > 0 && (
          <fieldset
            className="cube-collab-fieldset"
            aria-describedby={
              selectedFriendIds.length >= MAX_FRIENDS ? 'build-max-friends' : undefined
            }
          >
            <legend className="cube-collab-legend">
              Build with friends{' '}
              <span className="cube-collab-legend-hint" aria-live="polite">
                ({selectedFriendIds.length}/{MAX_FRIENDS} selected)
              </span>
            </legend>
            <div className="cube-collab-friend-grid">
              {friends.map((f) => {
                const checked = selectedFriendIds.includes(f.id);
                const disabled = !checked && selectedFriendIds.length >= MAX_FRIENDS;
                return (
                  <label
                    key={f.id}
                    className={`cube-collab-friend-row${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggleFriend(f.id)}
                      aria-label={`Build with ${f.username}`}
                    />
                    <span className="cube-collab-friend-name">{f.username}</span>
                    <span className="cube-collab-friend-count">
                      {f.cardCount.toLocaleString()} {f.cardCount === 1 ? 'card' : 'cards'}
                    </span>
                  </label>
                );
              })}
            </div>
            {selectedFriendIds.length >= MAX_FRIENDS && (
              <p className="cube-collab-max-note" id="build-max-friends" aria-live="polite">
                Maximum {MAX_FRIENDS} friends selected. Uncheck one to pick a different friend.
              </p>
            )}
          </fieldset>
        )}
        <p className="cube-friend-picker-note">
          Their cards always count, regardless of Cards above. The rarity cap still applies to what
          they own; there is no price data for a friend's cards, so the price ceiling never filters
          them.
        </p>
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
  const authUser = useAuth((s) => s.user);
  const myUsername = authUser?.username ?? '';

  // Friends as a "Draw from" pool source. The list itself is ambient/cheap
  // (already fetched elsewhere in the app); a friend's actual cards are only
  // fetched at build time, same moment a private collection or a failed fetch
  // is discovered today in the collaborative flow this replaces.
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsStatus, setFriendsStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [friendIssues, setFriendIssues] = useState<FriendIssue[]>([]);
  const [supplierMap, setSupplierMap] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    listFriends()
      .then((list) => {
        if (!cancelled) {
          setFriends(list);
          setFriendsStatus('done');
        }
      })
      .catch(() => {
        if (!cancelled) setFriendsStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFriend = useCallback((id: string) => {
    setSelectedFriendIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_FRIENDS) return prev;
      return [...prev, id];
    });
  }, []);

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
    setFriendIssues([]);
    cubeStore.clear();
    try {
      const myPool = await loadPool((fetched, total) => setFetchProgress({ fetched, total }));
      setFetchProgress(null);
      if (!myPool) throw new Error("Couldn't load your collection's cards. Try again.");

      // Fetch the selected friends' collections concurrently; one friend's
      // private collection or a failed fetch doesn't block the others.
      const selectedFriends = friends.filter((f) => selectedFriendIds.includes(f.id));
      const results = selectedFriends.length
        ? await Promise.allSettled(selectedFriends.map((f) => fetchFriendCollection(f.id)))
        : [];
      const issues: FriendIssue[] = [];
      const friendCollections: Array<{ username: string; cards: FriendCard[] }> = [];
      results.forEach((r, i) => {
        const username = selectedFriends[i].username;
        if (r.status === 'rejected') {
          issues.push({ username, reason: 'failed' });
          return;
        }
        if (r.value.collectionPrivate) {
          issues.push({ username, reason: 'private' });
          return;
        }
        friendCollections.push({ username, cards: r.value.cards });
      });
      setFriendIssues(issues);

      // Same play-format eligibility owned cards already went through
      // (ensureCardTags() above guarantees the otag snapshot is loaded); the
      // rarity cap applies too, the price ceiling deliberately does not (see
      // filterFriendCards — a friend's cards carry no price at all).
      const eligible = (name: string) =>
        formatExclusion(filters.format, getCardTags(name)) === null;
      const eligibleFriendCollections = friendCollections.map(({ username, cards }) => ({
        username,
        cards: filterFriendCards(cards, filters.rarity, eligible),
      }));

      let pool = myPool;
      let sm = new Map<string, string[]>();
      if (eligibleFriendCollections.length > 0) {
        // Oracle facts for the friends' cards only; your own came with loadPool.
        const friendNames = new Set<string>();
        for (const { cards } of eligibleFriendCollections)
          for (const fc of cards) if (fc.name) friendNames.add(fc.name);
        const enriched = await fetchCubeOracle(
          [...friendNames],
          collectionCards,
          (fetched, total) => setFetchProgress({ fetched, total })
        );
        setFetchProgress(null);
        const enrichedFriendCollections = eligibleFriendCollections.map(({ username, cards }) => ({
          username,
          cards: cards.map((fc) => {
            const s = enriched.get(fc.name);
            return {
              ...fc,
              oracleId: s?.oracle_id ?? fc.oracleId,
              colors: s?.colors ?? fc.colors,
              cmc: s?.cmc ?? fc.cmc,
              typeLine: s?.type_line ?? fc.typeLine,
              edhrecRank: s?.edhrec_rank ?? fc.edhrecRank,
              ...synergyTags(s ?? { name: fc.name }),
            };
          }),
        }));
        const merged = mergePools(myPool, myUsername, enrichedFriendCollections);
        pool = merged.pool;
        sm = merged.supplierMap;
      }
      setSupplierMap(sm);

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
  }, [
    loadPool,
    filters,
    size,
    priority,
    cubeStore,
    friends,
    selectedFriendIds,
    myUsername,
    collectionCards,
  ]);

  const copyList = useCallback(async () => {
    if (!cube) return;
    await navigator.clipboard.writeText(toCubeCobraList(cube.picks));
    pushToast({
      message: `Copied ${cube.picks.length} cards. Paste into CubeCobra's Add Cards.`,
      tone: 'success',
    });
  }, [cube, pushToast]);

  const handleSave = (name: string) => {
    const suppliers = supplierMap.size > 0 ? Object.fromEntries(supplierMap) : undefined;
    const id = cubeStore.saveCurrent(
      name,
      false,
      [],
      { synergyLevel: priority, filters },
      suppliers
    );
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
            <PoolFilterRow
              filters={filters}
              onChange={setFilters}
              friends={friends}
              friendsStatus={friendsStatus}
              selectedFriendIds={selectedFriendIds}
              onToggleFriend={toggleFriend}
            />
          </div>

          {friendIssues.length > 0 && (
            <div className="cube-collab-warn-banner" role="alert">
              {friendIssues.map((issue) => (
                <p key={issue.username} className="cube-collab-warn-line">
                  {issue.reason === 'private'
                    ? `${issue.username}'s collection is private. Their cards were excluded.`
                    : `Couldn't load ${issue.username}'s collection. Their cards were excluded.`}
                </p>
              ))}
            </div>
          )}

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
                supplierMap={supplierMap}
                myUsername={myUsername}
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
