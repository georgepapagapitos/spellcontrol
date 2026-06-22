import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, ChevronDown, LayoutGrid, LayoutList, Pencil, Share2, Trash2 } from 'lucide-react';
import { ShareDialog } from '../../components/ShareDialog';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { useStoredView } from '../../lib/use-stored-view';
import { MeterBar, StackedBar } from '../../components/shared/MeterBar';
import { CardPreview } from '../../components/CardPreview';
import { NameInputDialog } from '../../components/NameInputDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useToastsStore } from '../../store/toasts';
import { useCubeStore, SavedCube } from '../../store/cube';
import { formatRelativeTime } from '../../lib/format-time';
import { buildAvailableCollection } from '../../lib/collection-availability';
import { bindCubeCopies } from '../../lib/bind-cube-copies';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { loadTaggerData, cubeRole } from '../../deck-builder/services/tagger/client';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { CUBE_SIZES, CubeSize, SIZE_INFO, ColorBucket, provenance } from '../../lib/cube/targets';
import { generateCube, GeneratedCube, CubeCard } from '../../lib/cube/generate';
import { synergyTags } from '../../lib/cube/synergy-tags';
import { toCubeCobraList } from '../../lib/cube/format';
import { Ownership } from '../../lib/cube/import';
import {
  BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_COLOR,
  useOwnershipFor,
  OwnRowBadge,
  SynergySlider,
  CubeArchetypes,
} from './shared';

export function BuildCube({ highlightId }: { highlightId?: string }) {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const pushToast = useToastsStore((s) => s.push);
  const ownershipFor = useOwnershipFor();

  // Default ON: a physical cube is built from cards you can actually pull, so
  // copies already committed elsewhere (today: decks) are excluded. Toggle off
  // to draw from everything you own by name.
  const [availableOnly, setAvailableOnly] = useState(true);

  const cubeStore = useCubeStore();
  const [size, setSize] = useState<CubeSize>(cubeStore.size);
  // 0 = best cards (today's goodstuff); higher leans into supportable archetypes.
  const [synergyLevel, setSynergyLevel] = useState(0);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>(
    cubeStore.result ? 'done' : 'idle'
  );
  const [error, setError] = useState('');
  // Determinate progress state for the Scryfall batch fetch phase.
  // null = not yet started (or fetch complete); once the first batch resolves
  // these hold cumulative fetched vs total so the MeterBar can be honest.
  const [fetchProgress, setFetchProgress] = useState<{ fetched: number; total: number } | null>(
    null
  );
  const cube = cubeStore.result;
  const saved = cubeStore.saved;

  // Save / rename / delete dialog targets.
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedCube | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedCube | null>(null);
  const [shareTarget, setShareTarget] = useState<SavedCube | null>(null);
  // Cube the user is about to mark "physical" (claims copies) — confirmed first.
  const [physicalTarget, setPhysicalTarget] = useState<SavedCube | null>(null);

  // Cache the enriched Scryfall map so CubeResult can build EnrichedCards for preview.
  const [enrichedMap, setEnrichedMap] = useState<Map<string, ScryfallCard>>(new Map());

  // Names with at least one free (unallocated) copy vs every owned name. The
  // gap between them is how many cards are fully committed elsewhere and hidden
  // when "Available cards only" is on.
  const { availableNames, committedCount } = useMemo(() => {
    const avail = buildAvailableCollection(collectionCards, decks, saved);
    const owned = new Set<string>();
    for (const c of collectionCards) if (c.name) owned.add(c.name);
    return { availableNames: avail.names, committedCount: owned.size - avail.names.size };
  }, [collectionCards, decks, saved]);

  const uniqueNames = useMemo(() => {
    if (availableOnly) return [...availableNames];
    const set = new Set<string>();
    for (const c of collectionCards) if (c.name) set.add(c.name);
    return [...set];
  }, [availableOnly, availableNames, collectionCards]);

  const generate = useCallback(async () => {
    setStatus('working');
    setError('');
    setFetchProgress(null);
    cubeStore.clear();
    try {
      await loadTaggerData(); // ensures cubeRole is populated; cached/deduped
      const enriched = await getCardsByNames(uniqueNames, (fetched, total) => {
        setFetchProgress({ fetched, total });
      });
      // Fetch phase complete — clear progress so we show the "finalizing" skeleton.
      setFetchProgress(null);
      setEnrichedMap(enriched);
      const ownedByName = new Map<string, (typeof collectionCards)[number]>();
      for (const c of collectionCards)
        if (c.name && !ownedByName.has(c.name)) ownedByName.set(c.name, c);
      const pool: CubeCard[] = uniqueNames.map((name) => {
        const card = ownedByName.get(name);
        const s = enriched.get(name);
        return {
          name,
          oracleId: s?.oracle_id ?? card?.oracleId ?? name.toLowerCase(),
          colors: s?.colors ?? card?.colors ?? [],
          cmc: s?.cmc ?? card?.cmc ?? 0,
          typeLine: s?.type_line ?? card?.typeLine ?? '',
          role: cubeRole(name),
          rank: s?.edhrec_rank ?? card?.edhrecRank,
          ...synergyTags(s ?? { name }),
        };
      });
      const newCube = generateCube(pool, size, { synergyLevel });
      cubeStore.setResult(size, newCube);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong building the cube.');
      setStatus('error');
    }
  }, [uniqueNames, collectionCards, size, synergyLevel, cubeStore]);

  // When the store has a persisted result but enrichedMap is empty (e.g. after
  // a tab-switch or page reload), re-fetch Scryfall data for the cube's own
  // cards so the row thumbnails and CardPreview have images. We fetch the cube's
  // PICK names (always present in the persisted result) — not the collection's
  // `uniqueNames`, which hydrates from IDB asynchronously and, under "available
  // only", excludes the very cards already committed to this cube.
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

  const copyList = useCallback(async () => {
    if (!cube) return;
    await navigator.clipboard.writeText(toCubeCobraList(cube.picks));
    pushToast({
      message: `Copied ${cube.picks.length} cards — paste into CubeCobra's Add Cards`,
      tone: 'success',
    });
  }, [cube, pushToast]);

  const handleSave = (name: string) => {
    cubeStore.saveCurrent(name);
    setSaveOpen(false);
    pushToast({ message: `Saved “${name}”`, tone: 'success' });
  };
  const handleLoad = (sc: SavedCube) => {
    cubeStore.loadSaved(sc.id);
    setSize(sc.size);
    setStatus('done');
  };

  // Deep-link (`/collection/cube/:id`): once the saved list has hydrated, load
  // the matching cube and scroll its row into view. Handled once per id (a ref
  // gate) so an unrelated `saved` change doesn't re-load or yank scroll; we wait
  // for `saved` to populate because sync hydrates it asynchronously after mount.
  const deepLinkHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId || deepLinkHandled.current === highlightId) return;
    const target = saved.find((c) => c.id === highlightId);
    if (!target) return; // not hydrated yet — re-runs when `saved` populates
    deepLinkHandled.current = highlightId;
    // Load + scroll on the next frame (off the effect's synchronous path): load
    // the cube into the working view, then bring its row into focus.
    requestAnimationFrame(() => {
      handleLoad(target);
      document
        .getElementById(`cube-saved-${target.id}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    // Key only on the id + the hydrated list so a content edit elsewhere doesn't
    // retrigger; handleLoad is recreated each render but the ref gate guards it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, saved]);
  const handleRename = (name: string) => {
    if (renameTarget) cubeStore.renameSaved(renameTarget.id, name);
    setRenameTarget(null);
  };
  const handleDelete = () => {
    if (deleteTarget) cubeStore.removeSaved(deleteTarget.id);
    setDeleteTarget(null);
  };
  // Marking a cube physical reserves a real collection copy for each pick (so
  // decks/binders see them as unavailable); unmarking frees them. Turning ON is
  // confirmed first because it consciously commits copies.
  const handleTogglePhysical = (sc: SavedCube) => {
    if (sc.isPhysical) {
      cubeStore.setPhysical(sc.id, false, []);
      pushToast({
        message: `“${sc.name}” is no longer physical — its copies are free again`,
        tone: 'success',
      });
    } else {
      setPhysicalTarget(sc);
    }
  };
  const confirmPhysical = () => {
    if (!physicalTarget) return;
    // Read live store state at confirm-time (the dialog can sit open while a
    // background sync mutates the collection/decks) so binding never claims a
    // copy that was reallocated after the dialog opened — the project's
    // standard for every allocation mutation.
    const liveCollection = useCollectionStore.getState().cards;
    const liveDecks = useDecksStore.getState().decks;
    const others = useCubeStore
      .getState()
      .saved.filter((c) => c.isPhysical && c.id !== physicalTarget.id);
    const picks = bindCubeCopies(physicalTarget.cube.picks, liveCollection, liveDecks, others);
    const reserved = picks.filter((p) => p.allocatedCopyId).length;
    cubeStore.setPhysical(physicalTarget.id, true, picks);
    pushToast({
      message: `“${physicalTarget.name}” marked physical — reserved ${reserved} of your copies`,
      tone: 'success',
    });
    setPhysicalTarget(null);
  };

  if (collectionCards.length === 0) {
    return (
      <div className="cube-empty">
        <p>You haven&apos;t imported a collection yet.</p>
        <Link to="/collection" className="btn btn-primary">
          Import your collection
        </Link>
        <p className="cube-empty-hint">
          A cube is built from the cards you own — bring them in first.
        </p>
      </div>
    );
  }

  return (
    <div className="cube-build">
      <div className="cube-controls">
        <div className="cube-size-picker" role="group" aria-label="Cube size">
          {CUBE_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={`cube-size-opt${s === size ? ' active' : ''}`}
              aria-pressed={s === size}
              onClick={() => setSize(s)}
            >
              <span className="cube-size-n">{s}</span>
              <span className="cube-size-sub">{SIZE_INFO[s].players} players</span>
            </button>
          ))}
        </div>
        <p className="cube-size-note">{SIZE_INFO[size].note}</p>
        <SynergySlider value={synergyLevel} onChange={setSynergyLevel} />
        <label
          className="field-checkbox cube-available-toggle"
          title="When on, cards whose only copies are already committed to a deck or another physical cube are left out — a cube you can physically pull. Turn off to draw from everything you own."
        >
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
          />
          Available cards only
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={generate}
          disabled={status === 'working'}
        >
          {status === 'working' ? 'Building…' : cube ? 'Rebuild cube' : 'Build cube'}
        </button>
        <p className="cube-pool-note">
          {availableOnly ? (
            <>
              {uniqueNames.length.toLocaleString()} available cards
              {committedCount > 0 && (
                <> · {committedCount.toLocaleString()} committed to a deck or cube (hidden)</>
              )}
            </>
          ) : (
            <>{uniqueNames.length.toLocaleString()} unique cards in your collection</>
          )}
        </p>
      </div>

      {saved.length > 0 && (
        <section className="cube-saved" aria-label="Saved cubes">
          <h3 className="cube-saved-head">My cubes</h3>
          <ul className="cube-saved-list">
            {saved.map((sc) => (
              <li
                key={sc.id}
                id={`cube-saved-${sc.id}`}
                className={`cube-saved-row${sc.id === highlightId ? ' cube-saved-row--target' : ''}`}
                aria-current={sc.id === highlightId ? 'true' : undefined}
              >
                <button type="button" className="cube-saved-load" onClick={() => handleLoad(sc)}>
                  <span className="cube-saved-name">{sc.name}</span>
                  <span className="cube-saved-meta">
                    {sc.size} cards · {SIZE_INFO[sc.size].players} players · saved{' '}
                    {formatRelativeTime(sc.savedAt)}
                    {sc.isPhysical && (
                      <span className="cube-saved-physical-tag">
                        {' · '}
                        <Boxes width={10} height={10} aria-hidden /> Physical ·{' '}
                        {sc.picks.filter((p) => p.allocatedCopyId).length} reserved
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`cube-saved-action${sc.isPhysical ? ' is-physical' : ''}`}
                  onClick={() => handleTogglePhysical(sc)}
                  aria-pressed={sc.isPhysical}
                  aria-label={
                    sc.isPhysical
                      ? `Unmark ${sc.name} as physical`
                      : `Mark ${sc.name} as physically built`
                  }
                  title={
                    sc.isPhysical
                      ? 'Physical cube — reserves your copies. Click to unmark.'
                      : 'Mark as physically built (reserves your copies so decks can’t use them)'
                  }
                >
                  <Boxes width={15} height={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className="cube-saved-action"
                  onClick={() => setShareTarget(sc)}
                  aria-label={`Share ${sc.name}`}
                  title="Share"
                >
                  <Share2 width={15} height={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className="cube-saved-action"
                  onClick={() => setRenameTarget(sc)}
                  aria-label={`Rename ${sc.name}`}
                  title="Rename"
                >
                  <Pencil width={15} height={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className="cube-saved-action cube-saved-delete"
                  onClick={() => setDeleteTarget(sc)}
                  aria-label={`Delete ${sc.name}`}
                  title="Delete"
                >
                  <Trash2 width={15} height={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* aria-live region: always in DOM so screen readers catch transitions */}
      <div aria-live="polite" aria-atomic="true">
        {status === 'working' && (
          <div className="cube-loading" role="status" aria-busy="true">
            {fetchProgress !== null ? (
              /* Determinate phase: batch-fetching card data from Scryfall */
              <div className="cube-progress">
                <MeterBar
                  value={fetchProgress.fetched}
                  max={fetchProgress.total}
                  size="md"
                  role="progressbar"
                  label="Looking up your cards"
                />
                <p className="cube-loading-text">
                  Looking up your cards… {fetchProgress.fetched.toLocaleString()} /{' '}
                  {fetchProgress.total.toLocaleString()}
                </p>
              </div>
            ) : (
              /* Indeterminate phase: tagger load + synchronous generate step */
              <div className="cube-skeleton">
                <div className="deck-analysis-skeleton-bar is-headline" />
                <div className="deck-analysis-skeleton-bar is-body" />
                <div className="deck-analysis-skeleton-bar is-body is-short" />
              </div>
            )}
            {fetchProgress === null && (
              <p className="cube-loading-text">Selecting your best cards and balancing the cube…</p>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="cube-error" role="alert">
            {error}
            <button type="button" className="btn-link" onClick={generate}>
              Try again
            </button>
          </div>
        )}

        {status === 'done' && cube && (
          <CubeResult
            cube={cube}
            onCopy={copyList}
            onSave={() => setSaveOpen(true)}
            ownershipFor={ownershipFor}
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
      {renameTarget && (
        <NameInputDialog
          title="Rename cube"
          label="Cube name"
          initialValue={renameTarget.name}
          confirmLabel="Rename"
          onSubmit={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete cube?"
          body={`“${deleteTarget.name}” will be removed. This can’t be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {shareTarget && (
        <ShareDialog
          kind="cube"
          resourceId={shareTarget.id}
          resourceLabel={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}
      {physicalTarget && (
        <ConfirmDialog
          title="Mark as a physical cube?"
          body={`“${physicalTarget.name}” will reserve one of your copies for each card it can. Those copies stop showing as available for decks and binders — like sleeving the cards into the cube. You can unmark it any time to free them.`}
          confirmLabel="Mark physical"
          onConfirm={confirmPhysical}
          onCancel={() => setPhysicalTarget(null)}
        />
      )}
    </div>
  );
}

function CubeResult({
  cube,
  onCopy,
  onSave,
  ownershipFor,
  enrichedMap,
}: {
  cube: GeneratedCube;
  onCopy: () => void;
  onSave: () => void;
  ownershipFor: (name: string) => Ownership;
  enrichedMap: Map<string, ScryfallCard>;
}) {
  const built = cube.picks.length;
  const segments = BUCKET_ORDER.filter((b) => cube.byBucket[b] > 0).map((b) => ({
    key: b,
    value: cube.byBucket[b],
    color: BUCKET_COLOR[b],
    title: `${BUCKET_LABEL[b]}: ${cube.byBucket[b]}`,
  }));
  const shorts = cube.gaps.filter((g) => g.severity === 'short');
  const notes = cube.gaps.filter((g) => g.severity === 'note');

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Gallery (image grid) vs list (rows + reasons). Gallery scans a 360–720-card
  // cube in a fraction of the scroll; list keeps the per-card "why".
  const [view, setView] = useStoredView<'gallery' | 'list'>(
    'cube-result-view',
    ['gallery', 'list'],
    'gallery'
  );
  // Color sections you've collapsed (ephemeral — a navigation aid, not a setting).
  const [collapsed, setCollapsed] = useState<Set<ColorBucket>>(new Set());
  const toggleBucket = (b: ColorBucket) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  // Flat list of all picks (for preview carousel index mapping).
  const allPicks = cube.picks;

  // Build EnrichedCard[] parallel to allPicks for CardPreview.
  const previewCards = useMemo<EnrichedCard[]>(() => {
    return allPicks.map((p) => {
      const s = enrichedMap.get(p.card.name);
      if (s) return scryfallToEnrichedCard(s);
      // Minimal fallback if Scryfall data not in cache (e.g. restored from localStorage).
      return {
        copyId: p.card.oracleId || p.card.name.toLowerCase(),
        name: p.card.name,
        setCode: '',
        setName: '',
        collectorNumber: '',
        rarity: '',
        scryfallId: '',
        purchasePrice: 0,
        sourceCategory: '',
        sourceFormat: 'manual' as const,
        finish: 'nonfoil' as const,
        foil: false,
        oracleId: p.card.oracleId,
        cmc: p.card.cmc,
        typeLine: p.card.typeLine,
        colorIdentity: p.card.colors,
        colors: p.card.colors,
      };
    });
  }, [allPicks, enrichedMap]);

  const groups = useMemo(() => {
    const m = new Map<ColorBucket, { pick: (typeof allPicks)[number]; flatIndex: number }[]>();
    for (const b of BUCKET_ORDER) m.set(b, []);
    allPicks.forEach((p, flatIndex) => {
      m.get(p.bucket)!.push({ pick: p, flatIndex });
    });
    return BUCKET_ORDER.map((b) => ({ bucket: b, items: m.get(b)! })).filter(
      (g) => g.items.length > 0
    );
  }, [allPicks]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPreviewIndex(idx);
    }
  };

  return (
    <section className="cube-result" aria-label="Generated cube">
      <div className="cube-result-head">
        <div>
          <h2>
            {built}-card cube
            {built < cube.size && (
              <span className="cube-short-tag"> ({cube.size - built} short)</span>
            )}
          </h2>
          <p className="cube-result-sub">
            Drawn from {cube.poolSize.toLocaleString()} eligible singles you own.
          </p>
        </div>
        <div className="cube-result-actions">
          <button type="button" className="btn btn-primary" onClick={onSave}>
            Save cube
          </button>
          <button type="button" className="btn" onClick={onCopy}>
            Copy cube list
          </button>
        </div>
      </div>

      <div className="cube-balance">
        <h3>Color balance</h3>
        <StackedBar segments={segments} size="md" />
        <ul className="cube-legend">
          {BUCKET_ORDER.filter((b) => cube.byBucket[b] + cube.targetByBucket[b] > 0).map((b) => (
            <li key={b}>
              <span className="cube-swatch" style={{ background: BUCKET_COLOR[b] }} aria-hidden />
              {BUCKET_LABEL[b]}: <strong>{cube.byBucket[b]}</strong>
              <span className="cube-legend-target"> / {cube.targetByBucket[b]} target</span>
            </li>
          ))}
        </ul>
      </div>

      <CubeArchetypes score={cube.score} />

      <div className="cube-gaps">
        <h3>Where your collection lands</h3>
        {shorts.length === 0 && notes.length === 0 && (
          <p className="cube-gap cube-gap-note">
            This cube fits the template for its size cleanly.
          </p>
        )}
        {shorts.map((g, i) => (
          <p key={`s${i}`} className="cube-gap cube-gap-short">
            {g.text}
          </p>
        ))}
        {notes.map((g, i) => (
          <p key={`n${i}`} className="cube-gap cube-gap-note">
            {g.text}
          </p>
        ))}
        <p className="cube-provenance">
          Targets derived from {Object.values(provenance.bands).reduce((a, b) => a + b.n, 0)}{' '}
          popular CubeCobra cubes (updated {provenance.generatedAt.slice(0, 10)}).
        </p>
      </div>

      <div className="cube-list">
        <div className="cube-list-head">
          <h3>The cards</h3>
          <ViewModeToggle<'gallery' | 'list'>
            ariaLabel="Cube card view"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'gallery',
                label: 'Gallery view',
                icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'list',
                label: 'List view (with reasons)',
                icon: <LayoutList width={14} height={14} strokeWidth={2} aria-hidden />,
              },
            ]}
          />
        </div>
        {groups.map(({ bucket, items }, groupIndex) => {
          const isCollapsed = collapsed.has(bucket);
          return (
            <div
              key={bucket}
              className="cube-group"
              style={{ '--group-index': groupIndex } as React.CSSProperties}
            >
              <h4 className="cube-group-head">
                <button
                  type="button"
                  className="cube-group-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleBucket(bucket)}
                >
                  <ChevronDown className="cube-group-chevron" width={14} height={14} aria-hidden />
                  <span
                    className="cube-swatch"
                    style={{ background: BUCKET_COLOR[bucket] }}
                    aria-hidden
                  />
                  {BUCKET_LABEL[bucket]} <span className="cube-group-count">{items.length}</span>
                </button>
              </h4>
              {!isCollapsed &&
                (view === 'gallery' ? (
                  <ul className="cube-gallery">
                    {items.map(({ pick: p, flatIndex }) => {
                      const own = ownershipFor(p.card.name);
                      const s = enrichedMap.get(p.card.name);
                      const img = s?.image_uris?.small ?? s?.card_faces?.[0]?.image_uris?.small;
                      return (
                        <li key={p.card.oracleId || p.card.name} className="cube-tile">
                          <button
                            type="button"
                            className="cube-tile-btn"
                            aria-label={`${p.card.name} — open preview`}
                            title={p.card.name}
                            onClick={() => setPreviewIndex(flatIndex)}
                          >
                            {img ? (
                              <img src={img} alt="" loading="lazy" className="cube-tile-img" />
                            ) : (
                              <span className="cube-tile-ph">{p.card.name}</span>
                            )}
                            {own !== 'owned' && (
                              <span className="cube-tile-badge">
                                <OwnRowBadge own={own} />
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="cube-rows">
                    {items.map(({ pick: p, flatIndex }) => {
                      const own = ownershipFor(p.card.name);
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
                          onKeyDown={(e) => handleKeyDown(e, flatIndex)}
                        >
                          {img ? (
                            <img src={img} alt="" loading="lazy" className="cube-row-thumb" />
                          ) : (
                            <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                          )}
                          <div className="cube-row-body">
                            <span className="cube-row-title">
                              <span className="cube-row-name">{p.card.name}</span>
                              <OwnRowBadge own={own} />
                            </span>
                            {p.reason && <span className="cube-row-reason">{p.reason}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </div>
          );
        })}
      </div>

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="collection"
          cards={previewCards}
          index={previewIndex}
          binderName="Cube"
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </section>
  );
}
