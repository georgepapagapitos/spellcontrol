import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Boxes, ChevronDown, LayoutGrid, LayoutList, Pencil, Share2, Trash2 } from 'lucide-react';
import './CubePage.css';
import { ShareDialog } from '../components/ShareDialog';
import { Tabs } from '../components/Tabs';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useStoredView } from '../lib/use-stored-view';
import { MeterBar, StackedBar } from '../components/shared/MeterBar';
import { OwnershipBadge } from '../components/deck/OwnershipBadge';
import { VerdictBadge } from '../components/deck/VerdictBadge';
import { CardPreview } from '../components/CardPreview';
import { NameInputDialog } from '../components/NameInputDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useToastsStore } from '../store/toasts';
import { useCubeStore, SavedCube } from '../store/cube';
import { useAuth } from '../store/auth';
import { formatRelativeTime } from '../lib/format-time';
import { buildAllocationMap } from '../lib/allocations';
import { buildAvailableCollection } from '../lib/collection-availability';
import { bindCubeCopies } from '../lib/bind-cube-copies';
import { getCardsByNames } from '../deck-builder/services/scryfall/client';
import { loadTaggerData, getCardRole } from '../deck-builder/services/tagger/client';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';
import { CUBE_SIZES, CubeSize, SIZE_INFO, ColorBucket, provenance } from '../lib/cube/targets';
import { generateCube, GeneratedCube, CubeCard } from '../lib/cube/generate';
import { synergyTags } from '../lib/cube/synergy-tags';
import { toCubeCobraList } from '../lib/cube/format';
import {
  fetchCubeCobraCube,
  overlayOwnership,
  ImportedCube,
  OwnershipOverlay,
  Ownership,
  CubeImportError,
} from '../lib/cube/import';
import { listFriends, Friend } from '../lib/friends-client';
import { fetchFriendCollection, mergePools } from '../lib/cube/pool';

// Bucket display order, names, and segment colors for the balance bars.
const BUCKET_ORDER: ColorBucket[] = ['W', 'U', 'B', 'R', 'G', 'multicolor', 'colorless', 'land'];
const BUCKET_LABEL: Record<ColorBucket, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  multicolor: 'Multicolor',
  colorless: 'Colorless',
  land: 'Lands',
};
// Fills point at the shared mana-identity tokens (styles/tokens.css) so the cube
// bars and the deck mana-base chart show one palette for five colors.
const BUCKET_COLOR: Record<ColorBucket, string> = {
  W: 'var(--mtg-w)',
  U: 'var(--mtg-u)',
  B: 'var(--mtg-b)',
  R: 'var(--mtg-r)',
  G: 'var(--mtg-g)',
  multicolor: 'var(--mtg-multicolor)',
  colorless: 'var(--mtg-colorless)',
  land: 'var(--mtg-land)',
};

/**
 * Build an `ownershipFor(name)` from the live collection + deck AND physical-cube
 * allocations: 'owned' (a free copy exists), 'in-other-deck' / 'in-cube' (every
 * copy is committed — distinguished so the badge names the right place), or
 * 'unowned'. Deck wins the label when copies are split across both.
 */
function useOwnershipFor() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  return useMemo(() => {
    const allocations = buildAllocationMap(decks, savedCubes);
    const byName = new Map<string, { free: number; deck: number; cube: number }>();
    for (const copy of collectionCards) {
      if (!copy.name) continue;
      const key = copy.name.toLowerCase();
      const e = byName.get(key) ?? { free: 0, deck: 0, cube: 0 };
      const claim = allocations.get(copy.copyId);
      if (!claim) e.free += 1;
      else if (claim.ownerKind === 'cube') e.cube += 1;
      else e.deck += 1;
      byName.set(key, e);
    }
    const ownershipFor = (name: string): Ownership => {
      const e = byName.get(name.toLowerCase());
      if (!e) return 'unowned';
      if (e.free > 0) return 'owned';
      if (e.deck > 0) return 'in-other-deck';
      if (e.cube > 0) return 'in-cube';
      return 'unowned';
    };
    return ownershipFor;
  }, [collectionCards, decks, savedCubes]);
}

/** Ownership chip for a cube row — names where a committed copy actually lives. */
function OwnRowBadge({ own }: { own: Ownership }) {
  if (own === 'in-other-deck') {
    return (
      <VerdictBadge
        tone="neutral"
        label="In a deck"
        title="You own this, but it’s currently in a deck"
      />
    );
  }
  if (own === 'in-cube') {
    return (
      <VerdictBadge
        tone="neutral"
        label="In a cube"
        title="You own this, but it’s reserved by a physical cube"
      />
    );
  }
  return <OwnershipBadge owned={own === 'owned'} />;
}

/** Readable label for a synergy-slider value. */
function synergyLabel(v: number): string {
  if (v <= 0) return 'Best cards';
  if (v >= 1) return 'Max synergy';
  return `${Math.round(v * 100)}% synergy`;
}

/**
 * Trades raw card power (goodstuff) against archetype synergy when generating a
 * cube. 0 keeps today's pure best-cards selection; higher values prioritise
 * cards that deepen the archetypes your collection can actually support.
 */
function SynergySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="cube-synergy">
      <div className="cube-synergy-head">
        <span className="cube-synergy-title">Card priority</span>
        <span className="cube-synergy-val">{synergyLabel(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cube-synergy-range"
        aria-label="Card priority — from best cards to most archetype synergy"
        aria-valuetext={synergyLabel(value)}
      />
      <div className="cube-synergy-ends" aria-hidden="true">
        <span>Best cards</span>
        <span>Synergy</span>
      </div>
    </div>
  );
}

export function CubePage() {
  // `/collection/cube/:id` deep-links a specific saved cube — it lives in the
  // build tab's "My cubes" list, so a deep-link always lands on build mode.
  const { id: deepLinkId } = useParams();
  const [mode, setMode] = useState<'build' | 'import' | 'collaborate'>('build');
  return (
    <div className="cube-page">
      <header className="cube-page-head">
        <h1>Cube workshop</h1>
        <p className="cube-page-sub">
          Build a draftable singleton cube from your collection, or import one from CubeCobra to see
          how much of it you own.
        </p>
      </header>
      <Tabs
        ariaLabel="Cube tools"
        variant="underline"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'build', label: 'Build from my collection', controls: 'cube-panel' },
          { id: 'import', label: 'Import a cube', controls: 'cube-panel' },
          { id: 'collaborate', label: 'Build with friends', controls: 'cube-panel' },
        ]}
      />
      <div
        id="cube-panel"
        role="tabpanel"
        aria-labelledby={`sc-tab-${mode}`}
        className="cube-panel"
      >
        {mode === 'build' ? (
          <BuildCube highlightId={deepLinkId} />
        ) : mode === 'import' ? (
          <ImportCube />
        ) : (
          <CollabCube />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build mode
// ---------------------------------------------------------------------------

function BuildCube({ highlightId }: { highlightId?: string }) {
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
      await loadTaggerData(); // ensures getCardRole is populated; cached/deduped
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
          role: getCardRole(name),
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

/**
 * Explainable archetype-support panel: the objective's per-axis breakdown plus
 * the overall draftability score. Rendered only when the cube actually fields
 * archetypes (synergy slider engaged → refiner ran).
 */
function CubeArchetypes({ score }: { score: GeneratedCube['score'] }) {
  if (!score || score.axes.length === 0) return null;
  return (
    <div className="cube-archetypes">
      <div className="cube-archetypes-head">
        <h3>Archetype support</h3>
        <span className="cube-draftability" title="Overall objective score, 0–100">
          <strong>{Math.round(score.total * 100)}</strong>
          <span>draftability</span>
        </span>
      </div>
      <p className="cube-archetypes-sub">
        How deeply a drafter can commit to each strategy your collection supports — balanced
        enablers and payoffs, concentrated in their colors.
      </p>
      <ul className="cube-archetype-list">
        {score.axes.slice(0, 8).map((a) => (
          <li key={a.axis} className="cube-archetype">
            <div className="cube-archetype-row">
              <span className="cube-archetype-name">{a.label}</span>
              <span className="cube-archetype-counts">
                {a.enablers} enabler{a.enablers === 1 ? '' : 's'} · {a.payoffs} payoff
                {a.payoffs === 1 ? '' : 's'}
              </span>
            </div>
            <MeterBar
              value={a.score}
              max={1}
              size="sm"
              role="meter"
              label={`${a.label} draftability`}
            />
          </li>
        ))}
      </ul>
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

// ---------------------------------------------------------------------------
// Collaborate mode
// ---------------------------------------------------------------------------

const MAX_FRIENDS = 3;

function CollabCube() {
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
        cards: import('../lib/cube/pool').FriendCard[];
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

      // Build my pool (CubeCard[]) from my collection.
      const ownedByName = new Map<string, (typeof collectionCards)[number]>();
      for (const c of collectionCards)
        if (c.name && !ownedByName.has(c.name)) ownedByName.set(c.name, c);

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

      // Build my CubeCard pool.
      const myPool: CubeCard[] = myUniqueNames.map((name) => {
        const card = ownedByName.get(name);
        const s = enriched.get(name);
        return {
          name,
          oracleId: s?.oracle_id ?? card?.oracleId ?? name.toLowerCase(),
          colors: s?.colors ?? card?.colors ?? [],
          cmc: s?.cmc ?? card?.cmc ?? 0,
          typeLine: s?.type_line ?? card?.typeLine ?? '',
          role: getCardRole(name),
          rank: s?.edhrec_rank ?? card?.edhrecRank,
          ...synergyTags(s ?? { name }),
        };
      });

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
    () =>
      allPicks.map((p) => {
        const s = enrichedMap.get(p.card.name);
        if (s) return scryfallToEnrichedCard(s);
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
      }),
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

  const groups = useMemo(() => {
    if (!cube) return [];
    const m = new Map<ColorBucket, { pick: (typeof allPicks)[number]; flatIndex: number }[]>();
    for (const b of BUCKET_ORDER) m.set(b, []);
    allPicks.forEach((p, flatIndex) => {
      m.get(p.bucket)!.push({ pick: p, flatIndex });
    });
    return BUCKET_ORDER.map((b) => ({ bucket: b, items: m.get(b)! })).filter(
      (g) => g.items.length > 0
    );
  }, [cube, allPicks]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPreviewIndex(idx);
    }
  };

  // Empty state: no friends (rendered after all hooks).
  if (friendsStatus === 'done' && friends.length === 0) {
    return (
      <div className="cube-empty">
        <p>You don&apos;t have any friends added yet.</p>
        <Link to="/friends" className="btn btn-primary">
          Add friends first
        </Link>
        <p className="cube-empty-hint">
          Once you&apos;ve added friends, you can pool your collections to build a cube together.
        </p>
      </div>
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
          <p className="cube-collab-friends-error">Could not load your friends list.</p>
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
          title="When on, your cards whose only copies are committed to a deck or physical cube are left out. Friends' cards are always included."
        >
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
          />
          My available cards only
        </label>
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
              Could not load {name}&apos;s collection — their cards were excluded.
            </p>
          ))}
        </div>
      )}

      {/* aria-live region */}
      <div aria-live="polite" aria-atomic="true">
        {status === 'working' && (
          <div className="cube-loading" role="status" aria-busy="true">
            {fetchProgress !== null ? (
              <div className="cube-progress">
                <MeterBar
                  value={fetchProgress.fetched}
                  max={fetchProgress.total}
                  size="md"
                  role="progressbar"
                  label="Looking up cards"
                />
                <p className="cube-loading-text">
                  Looking up cards… {fetchProgress.fetched.toLocaleString()} /{' '}
                  {fetchProgress.total.toLocaleString()}
                </p>
              </div>
            ) : (
              <div className="cube-skeleton">
                <div className="deck-analysis-skeleton-bar is-headline" />
                <div className="deck-analysis-skeleton-bar is-body" />
                <div className="deck-analysis-skeleton-bar is-body is-short" />
              </div>
            )}
            {fetchProgress === null && (
              <p className="cube-loading-text">Pooling collections and balancing the cube…</p>
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

// ---------------------------------------------------------------------------
// Import mode
// ---------------------------------------------------------------------------

type OwnFilter = 'all' | 'owned' | 'in-other-deck' | 'unowned';

function ImportCube() {
  const ownershipFor = useOwnershipFor();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ cube: ImportedCube; overlay: OwnershipOverlay } | null>(
    null
  );
  const [filter, setFilter] = useState<OwnFilter>('all');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const run = useCallback(async () => {
    if (!url.trim()) return;
    setStatus('working');
    setError('');
    try {
      const cube = await fetchCubeCobraCube(url);
      const overlay = overlayOwnership(cube.cards, ownershipFor);
      setResult({ cube, overlay });
      setStatus('done');
    } catch (e) {
      setError(e instanceof CubeImportError ? e.message : 'Could not import that cube.');
      setStatus('error');
    }
  }, [url, ownershipFor]);

  const rows = useMemo(() => {
    if (!result) return [];
    if (filter === 'all') return result.overlay.rows;
    // The "In a deck" tab is the committed-elsewhere bucket — its count includes
    // cube-reserved copies, so the filter must match those too.
    if (filter === 'in-other-deck') {
      return result.overlay.rows.filter(
        (r) => r.ownership === 'in-other-deck' || r.ownership === 'in-cube'
      );
    }
    return result.overlay.rows.filter((r) => r.ownership === filter);
  }, [result, filter]);

  // Build EnrichedCard[] from import rows for CardPreview (minimal shape — no Scryfall fetch).
  const previewCards = useMemo<EnrichedCard[]>(() => {
    return rows.map((r) => ({
      copyId: r.card.oracleId || r.card.name.toLowerCase(),
      name: r.card.name,
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
      oracleId: r.card.oracleId,
      cmc: r.card.cmc,
      typeLine: r.card.typeLine,
      colorIdentity: r.card.colors,
      colors: r.card.colors,
      imageSmall: r.card.image,
    }));
  }, [rows]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPreviewIndex(idx);
    }
  };

  return (
    <div className="cube-import">
      <form
        className="cube-import-form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          type="url"
          inputMode="url"
          className="cube-input"
          placeholder="https://cubecobra.com/cube/overview/…"
          aria-label="CubeCobra cube link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={status === 'working' || !url.trim()}
        >
          {status === 'working' ? 'Importing…' : 'Import'}
        </button>
      </form>

      {status === 'idle' && !result && (
        <p className="cube-import-hint">
          Paste a link to any public cube on CubeCobra. We&apos;ll match it against your collection
          so you can see exactly what you own and what you&apos;d need.
        </p>
      )}

      {/* aria-live region: always in DOM so screen readers catch transitions */}
      <div aria-live="polite" aria-atomic="true">
        {status === 'working' && (
          <div className="cube-loading" role="status" aria-busy="true">
            <div className="cube-skeleton">
              <div className="deck-analysis-skeleton-bar is-headline" />
              <div className="deck-analysis-skeleton-bar is-body" />
              <div className="deck-analysis-skeleton-bar is-body is-short" />
            </div>
            <p className="cube-loading-text">Fetching the cube and matching your collection…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="cube-error" role="alert">
            {error}
            <button type="button" className="btn-link" onClick={run}>
              Try again
            </button>
          </div>
        )}
      </div>

      {status === 'done' && result && (
        <section className="cube-result" aria-label="Imported cube ownership">
          <div className="cube-result-head">
            <div>
              <h2>{result.cube.name}</h2>
              <p className="cube-result-sub">
                {result.cube.cardCount} cards · {result.cube.likeCount.toLocaleString()} likes on
                CubeCobra
              </p>
            </div>
            <div className="cube-pct">
              <strong>{Math.round(result.overlay.pctComplete * 100)}%</strong>
              <span>you can build now</span>
            </div>
          </div>

          <div className="cube-balance">
            <StackedBar
              size="md"
              max={result.cube.cards.length}
              segments={[
                {
                  key: 'owned',
                  value: result.overlay.owned,
                  color: 'var(--success)',
                  title: `Owned: ${result.overlay.owned}`,
                },
                {
                  key: 'deck',
                  value: result.overlay.inDeck,
                  color: 'var(--warn-text)',
                  title: `In a deck: ${result.overlay.inDeck}`,
                },
                {
                  key: 'missing',
                  value: result.overlay.missing,
                  color: 'var(--text-muted)',
                  title: `Missing: ${result.overlay.missing}`,
                },
              ]}
            />
            <ul className="cube-legend">
              <li>
                <span
                  className="cube-swatch"
                  style={{ background: 'var(--success)' }}
                  aria-hidden
                />
                Owned <strong>{result.overlay.owned}</strong>
              </li>
              <li>
                <span
                  className="cube-swatch"
                  style={{ background: 'var(--warn-text)' }}
                  aria-hidden
                />
                In a deck <strong>{result.overlay.inDeck}</strong>
              </li>
              <li>
                <span
                  className="cube-swatch"
                  style={{ background: 'var(--text-muted)' }}
                  aria-hidden
                />
                Missing <strong>{result.overlay.missing}</strong>
              </li>
            </ul>
          </div>

          <Tabs
            ariaLabel="Filter cards by ownership"
            variant="fitted"
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setPreviewIndex(null);
            }}
            tabs={[
              { id: 'all', label: 'All', count: result.overlay.rows.length },
              { id: 'owned', label: 'Owned', count: result.overlay.owned },
              { id: 'in-other-deck', label: 'In a deck', count: result.overlay.inDeck },
              { id: 'unowned', label: 'Missing', count: result.overlay.missing },
            ]}
          />
          <ul className="cube-rows cube-import-rows">
            {rows.map((r, idx) => (
              <li
                key={r.card.oracleId || r.card.name}
                className="cube-row cube-row-interactive"
                role="button"
                tabIndex={0}
                aria-label={`${r.card.name} — open preview`}
                onClick={() => setPreviewIndex(idx)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
              >
                {r.card.image ? (
                  <img src={r.card.image} alt="" loading="lazy" className="cube-row-thumb" />
                ) : (
                  <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                )}
                <div className="cube-row-body">
                  <span className="cube-row-title">
                    <span className="cube-row-name">{r.card.name}</span>
                    {r.ownership === 'in-other-deck' ? (
                      <VerdictBadge
                        tone="neutral"
                        label="In a deck"
                        title="You own this, but it’s currently in a deck"
                      />
                    ) : r.ownership === 'in-cube' ? (
                      <VerdictBadge
                        tone="neutral"
                        label="In a cube"
                        title="You own this, but it’s reserved by a physical cube"
                      />
                    ) : (
                      <OwnershipBadge owned={r.ownership === 'owned'} showUnowned />
                    )}
                  </span>
                  <span className="cube-row-reason">{r.card.typeLine}</span>
                </div>
              </li>
            ))}
          </ul>

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
      )}
    </div>
  );
}
