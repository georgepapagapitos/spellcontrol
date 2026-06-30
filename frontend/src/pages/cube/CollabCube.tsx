import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StackedBar } from '../../components/shared/MeterBar';
import { CardPreview } from '../../components/CardPreview';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useToastsStore } from '../../store/toasts';
import { useCubeStore } from '../../store/cube';
import { useAuth } from '../../store/auth';
import { buildAvailableCollection } from '../../lib/collection-availability';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { loadTaggerData } from '../../deck-builder/services/tagger/client';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { CubeSize } from '../../lib/cube/targets';
import { generateCube, GeneratedCube } from '../../lib/cube/generate';
import { synergyTags } from '../../lib/cube/synergy-tags';
import { toCubeCobraList } from '../../lib/cube/format';
import { listFriends, Friend } from '../../lib/friends-client';
import { fetchFriendCollection, mergePools } from '../../lib/cube/pool';
import {
  BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_COLOR,
  useOwnershipFor,
  OwnRowBadge,
  SynergySlider,
  CubeArchetypes,
  CubeEmptyState,
  CubeSizePicker,
  AvailableToggle,
  CubeLoadingBlock,
  CubeErrorBlock,
  namesToCubePool,
  pickToPreviewCard,
  groupPicksByBucket,
  cubeRowKeyDown,
} from './shared';

const MAX_FRIENDS = 3;

export function CollabCube() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const authUser = useAuth((s) => s.user);
  const myUsername = authUser?.username ?? '';
  const ownershipFor = useOwnershipFor();
  const cubeStore = useCubeStore();
  const pushToast = useToastsStore((s) => s.push);

  const [size, setSize] = useState<CubeSize>(cubeStore.size);
  const [synergyLevel, setSynergyLevel] = useState(0);
  // Mirror Build mode: only my cards are filtered for availability (friends'
  // cards arrive deduped without copy-level data, so they're always included).
  const [availableOnly, setAvailableOnly] = useState(true);

  // Friends list — start in loading so we don't flicker the empty-state.
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsStatus, setFriendsStatus] = useState<'loading' | 'done' | 'error'>('loading');

  // Selected friend IDs (max 3)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Generate flow
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [fetchProgress, setFetchProgress] = useState<{ fetched: number; total: number } | null>(
    null
  );
  const [cube, setCube] = useState<GeneratedCube | null>(null);
  const [enrichedMap, setEnrichedMap] = useState<Map<string, ScryfallCard>>(new Map());
  const [supplierMap, setSupplierMap] = useState<Map<string, string[]>>(new Map());

  // Warnings for failed friend fetches
  const [failedFriends, setFailedFriends] = useState<string[]>([]);

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Load friends on mount.
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

  const toggleFriend = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_FRIENDS) {
        next.add(id);
      }
      return next;
    });
  };

  const myUniqueNames = useMemo(() => {
    if (availableOnly) {
      return [...buildAvailableCollection(collectionCards, decks, cubeStore.saved).names];
    }
    const set = new Set<string>();
    for (const c of collectionCards) if (c.name) set.add(c.name);
    return [...set];
  }, [availableOnly, collectionCards, decks, cubeStore.saved]);

  const generate = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setStatus('working');
    setError('');
    setFetchProgress(null);
    setFailedFriends([]);
    setCube(null);

    try {
      // Fetch selected friends' collections concurrently; don't abort on one failure.
      const selectedFriends = friends.filter((f) => selectedIds.has(f.id));
      const results = await Promise.allSettled(
        selectedFriends.map(async (f) => {
          const res = await fetchFriendCollection(f.id);
          return { username: f.username, cards: res.cards };
        })
      );

      const friendCollections: Array<{
        username: string;
        cards: import('../../lib/cube/pool').FriendCard[];
      }> = [];
      const failed: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
          friendCollections.push(r.value);
        } else {
          failed.push(selectedFriends[i].username);
        }
      }
      setFailedFriends(failed);

      await loadTaggerData();

      // Collect all unique names across me + friends for Scryfall enrichment.
      const allNames = new Set<string>(myUniqueNames);
      for (const { cards } of friendCollections) {
        for (const fc of cards) if (fc.name) allNames.add(fc.name);
      }

      const enriched = await getCardsByNames([...allNames], (fetched, total) => {
        setFetchProgress({ fetched, total });
      });
      setFetchProgress(null);
      setEnrichedMap(enriched);

      // Build my CubeCard pool from my collection.
      const myPool = namesToCubePool(myUniqueNames, collectionCards, enriched);

      // Enrich friend cards with Scryfall data where available.
      const enrichedFriendCollections = friendCollections.map(({ username, cards }) => ({
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

      const { pool, supplierMap: sm } = mergePools(myPool, myUsername, enrichedFriendCollections);
      setSupplierMap(sm);

      const newCube = generateCube(pool, size, { synergyLevel });
      setCube(newCube);
      setStatus('done');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Something went wrong building the collaborative cube.'
      );
      setStatus('error');
    }
  }, [selectedIds, friends, collectionCards, myUniqueNames, myUsername, size, synergyLevel]);

  const copyList = useCallback(async () => {
    if (!cube) return;
    await navigator.clipboard.writeText(toCubeCobraList(cube.picks));
    pushToast({
      message: `Copied ${cube.picks.length} cards — paste into CubeCobra's Add Cards`,
      tone: 'success',
    });
  }, [cube, pushToast]);

  // Build the flat allPicks for the preview carousel. Must be before early return.
  const allPicks = useMemo(() => cube?.picks ?? [], [cube]);

  const previewCards = useMemo<EnrichedCard[]>(
    () => allPicks.map((p) => pickToPreviewCard(p.card, enrichedMap)),
    [allPicks, enrichedMap]
  );

  // Contributor summary: count how many picked cards each contributor supplies.
  // A card can be supplied by multiple people; each gets credit.
  const contributorSummary = useMemo(() => {
    if (!cube || supplierMap.size === 0) return [];
    const counts = new Map<string, number>();
    for (const p of cube.picks) {
      // supplierMap is keyed by oracleId only (mergePools skips blank-oracleId
      // cards), so look up by oracleId — no name fallback that would never match.
      if (!p.card.oracleId) continue;
      const suppliers = supplierMap.get(p.card.oracleId) ?? [];
      for (const s of suppliers) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const summary: Array<{ username: string; role: 'me' | 'friend'; supplies: number }> = [];
    // Me first.
    if (counts.has(myUsername)) {
      summary.push({ username: myUsername, role: 'me', supplies: counts.get(myUsername)! });
    }
    // Friends in selection order.
    for (const f of friends.filter((fr) => selectedIds.has(fr.id))) {
      if (counts.has(f.username)) {
        summary.push({ username: f.username, role: 'friend', supplies: counts.get(f.username)! });
      }
    }
    return summary;
  }, [cube, supplierMap, myUsername, friends, selectedIds]);

  const groups = useMemo(() => (cube ? groupPicksByBucket(allPicks) : []), [cube, allPicks]);

  // Empty state: no friends (rendered after all hooks).
  if (friendsStatus === 'done' && friends.length === 0) {
    return (
      <CubeEmptyState
        message="You don't have any friends added yet."
        ctaHref="/friends"
        ctaLabel="Add friends first"
        hint="Once you've added friends, you can pool your collections to build a cube together."
      />
    );
  }

  return (
    <div className="cube-build">
      {/* Friend picker */}
      <fieldset className="cube-collab-fieldset">
        <legend className="cube-collab-legend">
          Choose friends to build with{' '}
          <span className="cube-collab-legend-hint" aria-live="polite">
            ({selectedIds.size}/{MAX_FRIENDS} selected)
          </span>
        </legend>

        {friendsStatus === 'loading' && (
          <div className="cube-loading cube-collab-friends-loading" role="status" aria-busy="true">
            <p className="cube-loading-text">Loading friends…</p>
          </div>
        )}

        {friendsStatus === 'error' && (
          <p className="cube-collab-friends-error">Couldn't load your friends list.</p>
        )}

        {friendsStatus === 'done' && friends.length > 0 && (
          <div
            className="cube-collab-friend-grid"
            aria-describedby={selectedIds.size >= MAX_FRIENDS ? 'collab-max-note' : undefined}
          >
            {friends.map((f) => {
              const checked = selectedIds.has(f.id);
              const disabled = !checked && selectedIds.size >= MAX_FRIENDS;
              return (
                <label
                  key={f.id}
                  className={`cube-collab-friend-row${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleFriend(f.id)}
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
        )}

        {selectedIds.size >= MAX_FRIENDS && (
          <p className="cube-collab-max-note" id="collab-max-note" aria-live="polite">
            Maximum {MAX_FRIENDS} friends selected. Uncheck one to pick a different friend.
          </p>
        )}
      </fieldset>

      {/* Size picker (mirrors BuildCube) */}
      <div className="cube-controls">
        <CubeSizePicker size={size} onSize={setSize} />
        <SynergySlider value={synergyLevel} onChange={setSynergyLevel} />
        <AvailableToggle
          checked={availableOnly}
          onChange={setAvailableOnly}
          label="My available cards only"
          title="When on, your cards whose only copies are committed to a deck or physical cube are left out. Friends' cards are always included."
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={generate}
          disabled={status === 'working' || selectedIds.size === 0}
        >
          {status === 'working' ? 'Building…' : cube ? 'Rebuild cube' : 'Build collaborative cube'}
        </button>
        {selectedIds.size === 0 && (
          <p className="cube-pool-note">Select at least one friend above to get started.</p>
        )}
      </div>

      {/* Warnings for failed friend fetches */}
      {failedFriends.length > 0 && (
        <div className="cube-collab-warn-banner" role="alert">
          {failedFriends.map((name) => (
            <p key={name} className="cube-collab-warn-line">
              Couldn't load {name}&apos;s collection — their cards were excluded.
            </p>
          ))}
        </div>
      )}

      {/* aria-live region */}
      <div aria-live="polite" aria-atomic="true">
        {status === 'working' && (
          <CubeLoadingBlock
            fetchProgress={fetchProgress}
            lookupLabel="Looking up cards"
            finalizingLabel="Pooling collections and balancing the cube…"
          />
        )}

        {status === 'error' && <CubeErrorBlock error={error} onRetry={generate} />}
      </div>

      {status === 'done' && cube && (
        <section className="cube-result" aria-label="Generated collaborative cube">
          {/* Contributor summary */}
          {contributorSummary.length > 0 && (
            <div className="cube-collab-summary" aria-label="Contributor supply counts">
              {contributorSummary.map((c) => (
                <span
                  key={c.username}
                  className={`cube-collab-contributor-pill${c.role === 'me' ? ' is-me' : ''}`}
                  aria-label={`${c.username === myUsername ? 'You' : c.username}: supplies ${c.supplies} cards`}
                >
                  <span className="cube-collab-pill-name">
                    {c.role === 'me' ? 'You' : c.username}
                  </span>
                  <span className="cube-collab-pill-count">{c.supplies}</span>
                </span>
              ))}
            </div>
          )}

          <div className="cube-result-head">
            <div>
              <h2>
                {cube.picks.length}-card cube
                {cube.picks.length < cube.size && (
                  <span className="cube-short-tag"> ({cube.size - cube.picks.length} short)</span>
                )}
              </h2>
              <p className="cube-result-sub">
                Drawn from {cube.poolSize.toLocaleString()} eligible singles across your pooled
                collections.
              </p>
            </div>
            <div className="cube-result-actions">
              <button type="button" className="btn" onClick={copyList}>
                Copy cube list
              </button>
            </div>
          </div>
          {/* Note: saved cubes don't persist supplierMap — supplier info is available
              at generation time only. Regenerate to see updated supplier chips. */}

          <div className="cube-balance">
            <h3>Color balance</h3>
            <StackedBar
              segments={BUCKET_ORDER.filter((b) => cube.byBucket[b] > 0).map((b) => ({
                key: b,
                value: cube.byBucket[b],
                color: BUCKET_COLOR[b],
                title: `${BUCKET_LABEL[b]}: ${cube.byBucket[b]}`,
              }))}
              size="md"
            />
            <ul className="cube-legend">
              {BUCKET_ORDER.filter((b) => cube.byBucket[b] + cube.targetByBucket[b] > 0).map(
                (b) => (
                  <li key={b}>
                    <span
                      className="cube-swatch"
                      style={{ background: BUCKET_COLOR[b] }}
                      aria-hidden
                    />
                    {BUCKET_LABEL[b]}: <strong>{cube.byBucket[b]}</strong>
                    <span className="cube-legend-target"> / {cube.targetByBucket[b]} target</span>
                  </li>
                )
              )}
            </ul>
          </div>

          <CubeArchetypes score={cube.score} />

          <div className="cube-gaps">
            <h3>Where your pooled collection lands</h3>
            {cube.gaps.filter((g) => g.severity === 'short').length === 0 &&
              cube.gaps.filter((g) => g.severity === 'note').length === 0 && (
                <p className="cube-gap cube-gap-note">
                  This cube fits the template for its size cleanly.
                </p>
              )}
            {cube.gaps
              .filter((g) => g.severity === 'short')
              .map((g, i) => (
                <p key={`s${i}`} className="cube-gap cube-gap-short">
                  {g.text}
                </p>
              ))}
            {cube.gaps
              .filter((g) => g.severity === 'note')
              .map((g, i) => (
                <p key={`n${i}`} className="cube-gap cube-gap-note">
                  {g.text}
                </p>
              ))}
          </div>

          <div className="cube-list">
            <h3>The cards, and why</h3>
            {groups.map(({ bucket, items }, groupIndex) => (
              <div
                key={bucket}
                className="cube-group"
                style={{ '--group-index': groupIndex } as React.CSSProperties}
              >
                <h4 className="cube-group-head">
                  <span
                    className="cube-swatch"
                    style={{ background: BUCKET_COLOR[bucket] }}
                    aria-hidden
                  />
                  {BUCKET_LABEL[bucket]} <span className="cube-group-count">{items.length}</span>
                </h4>
                <ul className="cube-rows">
                  {items.map(({ pick: p, flatIndex }) => {
                    // supplierMap is keyed by oracleId only (mergePools skips
                    // blank-oracleId cards); no name fallback that would never match.
                    const suppliers = p.card.oracleId
                      ? (supplierMap.get(p.card.oracleId) ?? [])
                      : [];
                    const iSupply = suppliers.includes(myUsername);
                    const own = ownershipFor(p.card.name);
                    // Show friend supplier chip when I can't supply the card myself.
                    const friendSuppliers = suppliers.filter((s) => s !== myUsername);
                    const s = enrichedMap.get(p.card.name);
                    const img = s?.image_uris?.small ?? s?.card_faces?.[0]?.image_uris?.small;
                    return (
                      <li
                        key={p.card.oracleId || p.card.name}
                        className="cube-row cube-row-interactive"
                        role="button"
                        tabIndex={0}
                        aria-label={`${p.card.name} — open preview`}
                        onClick={() => setPreviewIndex(flatIndex)}
                        onKeyDown={(e) => cubeRowKeyDown(e, flatIndex, setPreviewIndex)}
                      >
                        {img ? (
                          <img src={img} alt="" loading="lazy" className="cube-row-thumb" />
                        ) : (
                          <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                        )}
                        <div className="cube-row-body">
                          <span className="cube-row-title">
                            <span className="cube-row-name">{p.card.name}</span>
                            {iSupply ? (
                              <OwnRowBadge own={own} />
                            ) : friendSuppliers.length > 0 ? (
                              <span
                                className="cube-collab-supplier-chip"
                                aria-label={`Supplied by ${friendSuppliers.join(', ')}`}
                              >
                                {friendSuppliers[0]}
                                {friendSuppliers.length > 1 && (
                                  <span aria-hidden> +{friendSuppliers.length - 1}</span>
                                )}
                              </span>
                            ) : null}
                          </span>
                          {p.reason && <span className="cube-row-reason">{p.reason}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {previewIndex !== null && previewCards[previewIndex] && (
            <CardPreview
              source="collection"
              cards={previewCards}
              index={previewIndex}
              binderName="Collaborative Cube"
              sectionLabels={[]}
              pageNumbers={[]}
              totalPages={0}
              onIndexChange={setPreviewIndex}
              onClose={() => setPreviewIndex(null)}
            />
          )}
        </section>
      )}
    </div>
  );
}
