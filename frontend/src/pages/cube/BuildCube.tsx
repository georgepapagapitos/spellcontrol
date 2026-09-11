import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, ChevronDown, LayoutGrid, LayoutList, Pencil, Share2, Trash2 } from 'lucide-react';
import { OverflowMenu } from '../../components/OverflowMenu';
import { ShareDialog } from '../../components/ShareDialog';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { useStoredView } from '../../lib/use-stored-view';
import { StackedBar } from '../../components/shared/MeterBar';
import { CardGridCell } from '../../components/shared/CardGridCell';
import { DeckBadge } from '../../components/DeckBadge';
import { CardPreview } from '../../components/CardPreview';
import { NameInputDialog } from '../../components/NameInputDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useToastsStore } from '../../store/toasts';
import { useCubeStore, SavedCube } from '../../store/cube';
import { formatRelativeTime } from '../../lib/format-time';
import { buildAvailableCollection } from '../../lib/collection-availability';
import { filterPool, DEFAULT_POOL_FILTERS, type PoolFilters } from '../../lib/cube/pool-filters';
import { SelectMenu } from '../../components/SelectMenu';
import { InfoTip } from '../../components/InfoTip';
import { formatMoney } from '../../lib/format-money';
import { useCurrency } from '../../lib/currency';
import { Link } from 'react-router-dom';
import { bindCubeCopies } from '../../lib/bind-cube-copies';
import type { AllocationInfo } from '../../lib/allocations';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { fetchCubeOracle } from '../../lib/cube/oracle';
import { loadTaggerData } from '../../deck-builder/services/tagger/client';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { CubeSize, SIZE_INFO, ColorBucket, provenance } from '../../lib/cube/targets';
import { generateCube, GeneratedCube } from '../../lib/cube/generate';
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
  CubeEmptyState,
  CubeSizePicker,
  CubeLoadingBlock,
  CubeErrorBlock,
  pickToPreviewCard,
  groupPicksByBucket,
} from './shared';
import { namesToCubePool } from '../../lib/cube/pool';

import { userMessage } from '@/lib/user-error';
export function BuildCube({ highlightId }: { highlightId?: string }) {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const pushToast = useToastsStore((s) => s.push);
  // What the cube may draw from. Default = available copies only: a physical
  // cube is built from cards you can actually pull, so copies committed to a
  // deck or another physical cube are excluded. See lib/cube/pool-filters.
  const [filters, setFilters] = useState<PoolFilters>(DEFAULT_POOL_FILTERS);

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
  // The saved cube the working result IS (null = a fresh, unsaved build).
  const loaded = useMemo(
    () => (cubeStore.loadedId ? (saved.find((c) => c.id === cubeStore.loadedId) ?? null) : null),
    [cubeStore.loadedId, saved]
  );
  const { ownershipFor, committedFor } = useOwnershipFor(loaded?.id ?? null);

  // Save / rename / delete dialog targets.
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedCube | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedCube | null>(null);
  const [shareTarget, setShareTarget] = useState<SavedCube | null>(null);
  // Cube the user is about to mark "physical" (claims copies) — confirmed first.
  const [physicalTarget, setPhysicalTarget] = useState<SavedCube | null>(null);

  // Cache the enriched Scryfall map so CubeResult can build EnrichedCards for preview.
  const [enrichedMap, setEnrichedMap] = useState<Map<string, ScryfallCard>>(new Map());

  // Names with at least one free (unallocated) copy — the `source: 'available'`
  // basis, and what "committed" means in the pool note.
  const availableNames = useMemo(
    () => buildAvailableCollection(collectionCards, decks, saved).names,
    [collectionCards, decks, saved]
  );
  const { names: uniqueNames, hidden } = useMemo(
    () => filterPool(collectionCards, availableNames, filters),
    [collectionCards, availableNames, filters]
  );

  const generate = useCallback(async () => {
    setStatus('working');
    setError('');
    setFetchProgress(null);
    // Drop the previous run's preview art so the picks effect refires for the
    // NEW picks — it's gated on an empty map.
    setEnrichedMap(new Map());
    cubeStore.clear();
    try {
      await loadTaggerData(); // ensures cubeRole is populated; cached/deduped
      // Pool ranking reads oracle facts for the WHOLE collection — a bulk-data
      // workload Scryfall doesn't want walked card-by-card from a browser, so
      // it comes from our own cache-backed endpoint. Card previews are filled
      // in separately by the effect below, for the picks only.
      const enriched = await fetchCubeOracle(uniqueNames, collectionCards, (fetched, total) => {
        setFetchProgress({ fetched, total });
      });
      // Fetch phase complete — clear progress so we show the "finalizing" skeleton.
      setFetchProgress(null);
      const pool = namesToCubePool(uniqueNames, collectionCards, enriched);
      const newCube = generateCube(pool, size, { synergyLevel });
      cubeStore.setResult(size, newCube);
      setStatus('done');
    } catch (e) {
      setError(userMessage(e, "Couldn't build the cube. Try again."));
      setStatus('error');
    }
  }, [uniqueNames, collectionCards, size, synergyLevel, cubeStore]);

  // Card art/printing details for the picks. This is the ONLY Scryfall call the
  // cube flow makes — a few hundred names, well inside the batch endpoint's
  // comfort zone — and it also covers the case where the store has a persisted
  // result but enrichedMap is empty (a tab-switch or page reload). We fetch the cube's
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
      message: `Copied ${cube.picks.length} cards. Paste into CubeCobra's Add Cards.`,
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

  // Deep-link (`/decks/cube/:id`): once the saved list has hydrated, load
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
        message: `“${sc.name}” is no longer physical. Its copies are free again.`,
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
      message: `“${physicalTarget.name}” marked physical. Reserved ${reserved} of your copies.`,
      tone: 'success',
    });
    setPhysicalTarget(null);
  };

  if (collectionCards.length === 0) {
    return (
      <CubeEmptyState
        message="You haven't imported a collection yet."
        ctaHref="/collection"
        ctaLabel="Import your collection"
        hint="A cube is built from the cards you own. Bring them in first."
      />
    );
  }

  return (
    <div className="cube-build">
      <div className="cube-controls">
        <CubeSizePicker size={size} onSize={setSize} />
        <SynergySlider value={synergyLevel} onChange={setSynergyLevel} />
        <PoolFilterRow filters={filters} onChange={setFilters} />
        <button
          type="button"
          className="btn btn-primary"
          onClick={generate}
          disabled={status === 'working'}
        >
          {status === 'working'
            ? 'Building…'
            : loaded
              ? 'Build new cube'
              : cube
                ? 'Rebuild cube'
                : 'Build cube'}
        </button>
        <p className="cube-pool-note">
          {uniqueNames.length.toLocaleString()} cards to draw from
          {[
            hidden.committed > 0 &&
              `${hidden.committed.toLocaleString()} committed to a deck or cube`,
            hidden.singles > 0 && `${hidden.singles.toLocaleString()} single copies`,
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
                <button
                  type="button"
                  className="cube-saved-load"
                  title={sc.name}
                  onClick={() => handleLoad(sc)}
                >
                  <span className="cube-saved-name">{sc.name}</span>
                  <span className="cube-saved-meta">
                    <SavedCubeMeta sc={sc} />
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
                      ? 'Reserves your copies. Click to unmark.'
                      : "Reserves your copies so decks can't use them."
                  }
                >
                  <Boxes width={15} height={15} aria-hidden />
                </button>
                <OverflowMenu
                  className="cube-saved-menu"
                  triggerClassName="cube-saved-action"
                  ariaLabel={`Actions for ${sc.name}`}
                  items={[
                    { label: 'Share', icon: Share2, onClick: () => setShareTarget(sc) },
                    { label: 'Rename', icon: Pencil, onClick: () => setRenameTarget(sc) },
                    {
                      label: 'Delete',
                      icon: Trash2,
                      danger: true,
                      onClick: () => setDeleteTarget(sc),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* aria-live region: always in DOM so screen readers catch transitions */}
      <div aria-live="polite" aria-atomic="true">
        {status === 'working' && (
          <CubeLoadingBlock
            fetchProgress={fetchProgress}
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
            loaded={loaded}
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
          body={`“${deleteTarget.name}” will be removed. This can't be undone.`}
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
          body={`“${physicalTarget.name}” will reserve one of your copies for each card it can. Those copies stop showing as available for decks and binders, like sleeving the cards into the cube. You can unmark it any time to free them.`}
          confirmLabel="Mark physical"
          onConfirm={confirmPhysical}
          onCancel={() => setPhysicalTarget(null)}
        />
      )}
    </div>
  );
}

const PRICE_CEILINGS: (number | null)[] = [null, 1, 2, 5, 10];

/**
 * "Draw from": which owned cards the generator may use. Three toolbar pickers
 * (STYLE_GUIDE § Toolbars: compact pickers are the `SelectMenu` pill family) —
 * source, price ceiling, rarity cap — with one InfoTip for the mechanism. A
 * peasant or bulk cube is a pool decision, not a ranking one, so the filters
 * sit in front of the generator and the count line shows what they hid.
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
    <div className="cube-pool-filters" role="group" aria-label="Draw from">
      <span className="cube-pool-filters-title">
        Draw from
        <InfoTip
          label="Draw from"
          text="Available cards are the copies no deck or physical cube has claimed, so what you build is what you can pull. Spares only also needs two or more copies, so your singles stay in their binders. A price ceiling reads the cheapest copy you own at today's market price; the rarity cap reads the printing you own."
        />
      </span>
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
  );
}

/** "180 cards · 4 players · saved 1h ago · Physical · 180 reserved" — the one
 *  line that identifies a saved cube, on its row AND over the result it's loaded into. */
function SavedCubeMeta({ sc }: { sc: SavedCube }) {
  return (
    <>
      {sc.size} cards · {SIZE_INFO[sc.size].players} players · saved{' '}
      {formatRelativeTime(sc.savedAt)}
      {sc.isPhysical && (
        <span className="cube-saved-physical-tag">
          {' · '}
          <Boxes width={10} height={10} aria-hidden /> Physical ·{' '}
          {sc.picks.filter((p) => p.allocatedCopyId).length} reserved
        </span>
      )}
    </>
  );
}

function CubeResult({
  cube,
  onCopy,
  onSave,
  loaded,
  ownershipFor,
  committedFor,
  enrichedMap,
}: {
  cube: GeneratedCube;
  onCopy: () => void;
  onSave: () => void;
  /** The saved cube this result is, or null for a fresh unsaved build. */
  loaded: SavedCube | null;
  ownershipFor: (name: string) => Ownership;
  committedFor: (name: string) => AllocationInfo[];
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
  const previewCards = useMemo<EnrichedCard[]>(
    () => allPicks.map((p) => pickToPreviewCard(p.card, enrichedMap)),
    [allPicks, enrichedMap]
  );

  const groups = useMemo(() => groupPicksByBucket(allPicks), [allPicks]);

  return (
    <section className="cube-result" aria-label="Generated cube">
      <div className="cube-result-head">
        <div>
          <h2>
            {loaded ? loaded.name : `${built}-card cube`}
            {built < cube.size && (
              <span className="cube-short-tag"> ({cube.size - built} short)</span>
            )}
          </h2>
          <p className="cube-result-sub">
            {loaded ? (
              <SavedCubeMeta sc={loaded} />
            ) : (
              <>Drawn from {cube.poolSize.toLocaleString()} eligible singles you own.</>
            )}
          </p>
        </div>
        <div className="cube-result-actions">
          {/* A loaded cube is already saved — offering "Save cube" again only
              minted duplicates. Rename / physical / delete live on its row. */}
          {!loaded && (
            <button type="button" className="btn btn-primary" onClick={onSave}>
              Save cube
            </button>
          )}
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
                  <div className="cube-gallery">
                    {items.map(({ pick: p, flatIndex }) => (
                      <CardGridCell
                        key={p.card.oracleId || p.card.name}
                        card={previewCards[flatIndex]}
                        qty={1}
                        size="1x"
                        onActivate={() => setPreviewIndex(flatIndex)}
                        badges={<DeckBadge allocations={committedFor(p.card.name)} />}
                      />
                    ))}
                  </div>
                ) : (
                  <ul className="cube-rows">
                    {items.map(({ pick: p, flatIndex }) => {
                      const own = ownershipFor(p.card.name);
                      const s = enrichedMap.get(p.card.name);
                      const img = s?.image_uris?.small ?? s?.card_faces?.[0]?.image_uris?.small;
                      return (
                        <li key={p.card.oracleId || p.card.name} className="cube-row">
                          <button
                            type="button"
                            className="cube-row-interactive"
                            aria-label={`Open preview for ${p.card.name}`}
                            onClick={() => setPreviewIndex(flatIndex)}
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
                          </button>
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
