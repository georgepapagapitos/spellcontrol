import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Ban, Boxes, Copy, Pencil, Plus, Share2, Trash2, X } from 'lucide-react';
import './cube.css';
import { BackLink } from '../../components/BackLink';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { NameInputDialog } from '../../components/NameInputDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ShareDialog } from '../../components/ShareDialog';
import { Modal } from '../../components/Modal';
import { EmptyStateMark } from '../../components/shared/EmptyStateMark';
import { useCubeStore } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useToastsStore } from '../../store/toasts';
import { bindCubeCopies } from '../../lib/bind-cube-copies';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { toCubeCobraList } from '../../lib/cube/format';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import { useOwnedCubePool } from '../../lib/cube/use-owned-pool';
import { DEFAULT_POOL_FILTERS } from '../../lib/cube/pool-filters';
import { swapCandidates } from '../../lib/cube/swap';
import { byQuality } from '../../lib/cube/generate';
import { targetsForSize } from '../../lib/cube/targets';
import { scoreCube, computePowerBasis } from '../../lib/cube/objective';
import { generateCubeAsync, type CubeProgress } from '../../lib/cube/generate-async';
import type { CubeCard } from '../../lib/cube/core';
import type { ScryfallCard } from '@/deck-builder/types';
import { userMessage } from '@/lib/user-error';
import { useOwnershipFor, CubeLoadingBlock, CubeErrorBlock } from './shared';
import { CubeResult, SavedCubeMeta, type CubeEditHandlers } from './CubeResult';
import { CubeCardPickerSheet } from './CubeCardPickerSheet';
import { Button, IconButton } from '../../components/shared/Button';

type DetailTab = 'cards' | 'shopping' | 'pull';

/** `/decks/cube/:id` — the cube's own page. Same header anatomy as a deck's:
 *  back link · title · one meta line · actions · tabs. Cards tab reuses
 *  `CubeResult`'s sections (color balance, archetype support, gaps, sample
 *  pack, the cards) plus row editing (lock / swap / remove / ban); Shopping
 *  list and Pull list by binder are designed empty states that reserve their
 *  tab slot without pretending to be built. */
export function CubeDetailPage() {
  const { id } = useParams();
  const cubeStore = useCubeStore();
  const saved = cubeStore.saved;
  const awaitingFirstPull = useAwaitingFirstPull();
  const pushToast = useToastsStore((s) => s.push);
  const collectionCards = useCollectionStore((s) => s.cards);
  const target = saved.find((c) => c.id === id) ?? null;

  const [tab, setTab] = useState<DetailTab>('cards');
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [physicalConfirmOpen, setPhysicalConfirmOpen] = useState(false);
  const [bannedOpen, setBannedOpen] = useState(false);
  const [banTarget, setBanTarget] = useState<{ pickIndex: number; name: string } | null>(null);
  const [swapTarget, setSwapTarget] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [rebuildError, setRebuildError] = useState('');
  const [rebuildFetchProgress, setRebuildFetchProgress] = useState<{
    fetched: number;
    total: number;
  } | null>(null);
  const [rebuildRefineProgress, setRebuildRefineProgress] = useState<CubeProgress | null>(null);
  const rebuildAbort = useRef<AbortController | null>(null);
  useEffect(() => () => rebuildAbort.current?.abort(), []);
  const [enrichedMap, setEnrichedMap] = useState<Map<string, ScryfallCard>>(new Map());

  const { ownershipFor, committedFor } = useOwnershipFor(target?.id ?? null);
  const filters = target?.settings?.filters ?? DEFAULT_POOL_FILTERS;
  const {
    pool,
    loading: poolLoading,
    error: poolError,
    load: loadPool,
  } = useOwnedCubePool(filters);

  const lockedIds = useMemo(() => target?.locked ?? [], [target?.locked]);
  const lockedSet = useMemo(() => new Set(lockedIds), [lockedIds]);
  const bannedIds = useMemo(() => target?.banned ?? [], [target?.banned]);
  const bannedSet = useMemo(() => new Set(bannedIds), [bannedIds]);
  const nameByOracle = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of collectionCards)
      if (c.oracleId && !m.has(c.oracleId)) m.set(c.oracleId, c.name);
    return m;
  }, [collectionCards]);
  const swapList = useMemo(
    () =>
      swapTarget !== null && pool && target
        ? swapCandidates(target.cube, swapTarget, pool, { banned: bannedIds })
        : [],
    [swapTarget, pool, target, bannedIds]
  );
  const inCubeIds = useMemo(
    () => new Set((target?.cube.picks ?? []).map((p) => p.card.oracleId)),
    [target]
  );
  const addCandidates = useMemo(() => {
    if (!pool) return [];
    const q = addQuery.trim().toLowerCase();
    return pool
      .filter(
        (c) =>
          !inCubeIds.has(c.oracleId) &&
          !bannedSet.has(c.oracleId) &&
          (q === '' || c.name.toLowerCase().includes(q))
      )
      .sort(byQuality)
      .slice(0, 40)
      .map((card) => ({ card }));
  }, [pool, addQuery, inCubeIds, bannedSet]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const names = [...new Set(target.cube.picks.map((p) => p.card.name))];
    getCardsByNames(names).then((enriched) => {
      // A different cube's art (or none) may still be showing while this
      // fetch is in flight — replace it only once the new one lands, rather
      // than clearing synchronously on every id change.
      if (!cancelled) setEnrichedMap(enriched);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch only when the viewed cube changes, not on every store tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  // Recompute the objective score after an edit changes the cube's picks —
  // only when the pool is already loaded (Swap/Add/Rebuild has been opened
  // once this view) and the cube had engaged the synergy slider to begin
  // with. A Power cube (synergyLevel 0) never carried a score and the
  // archetype panel already hides for it; an edit before the pool loads
  // leaves the score cleared and the panel quietly hidden rather than
  // showing a number that no longer describes the cube.
  const rescoreIfPossible = (cubeId: string, builtPool: CubeCard[] | null) => {
    if (!builtPool) return;
    const latest = useCubeStore.getState().saved.find((c) => c.id === cubeId);
    if (!latest) return;
    const synergyLevel = latest.settings?.synergyLevel ?? 0;
    if (synergyLevel <= 0) return;
    const format = latest.cube.format ?? 'limited';
    const band = targetsForSize(latest.size, format);
    const score = scoreCube(
      latest.cube.picks,
      builtPool,
      band,
      latest.size,
      computePowerBasis(builtPool),
      synergyLevel
    );
    cubeStore.updateSaved(cubeId, { cube: { ...latest.cube, score } });
  };

  if (!target && awaitingFirstPull) {
    return (
      <div className="cube-page">
        <BackLink to="/decks/cube" label="Cubes" />
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">Loading your cube…</span>
        </div>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="cube-page">
        <BackLink to="/decks/cube" label="Cubes" />
        <PageHeader title="Cube not found" />
        <div className="empty-state">
          <EmptyStateMark />
          <p className="empty-state-tagline">
            This cube doesn't exist, or you don't have access to it.
          </p>
          <div className="empty-state-actions">
            <Button to="/decks/cube" variant="primary" className="empty-state-action">
              Back to cubes
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const copyList = async () => {
    await navigator.clipboard.writeText(toCubeCobraList(target.cube.picks));
    pushToast({
      message: `Copied ${target.cube.picks.length} cards. Paste into CubeCobra's Add Cards.`,
      tone: 'success',
    });
  };

  const handleRename = (name: string) => {
    cubeStore.renameSaved(target.id, name);
    setRenameOpen(false);
  };
  const handleDelete = () => {
    cubeStore.removeSaved(target.id);
    setDeleteOpen(false);
  };
  const handleTogglePhysical = () => {
    if (target.isPhysical) {
      cubeStore.setPhysical(target.id, false, []);
      pushToast({
        message: `"${target.name}" is no longer physical. Its copies are free again.`,
        tone: 'success',
      });
    } else {
      setPhysicalConfirmOpen(true);
    }
  };
  const confirmPhysical = () => {
    const liveCollection = useCollectionStore.getState().cards;
    const liveDecks = useDecksStore.getState().decks;
    const others = useCubeStore.getState().saved.filter((c) => c.isPhysical && c.id !== target.id);
    const picks = bindCubeCopies(target.cube.picks, liveCollection, liveDecks, others);
    const reserved = picks.filter((p) => p.allocatedCopyId).length;
    cubeStore.setPhysical(target.id, true, picks);
    pushToast({
      message: `"${target.name}" marked physical. Reserved ${reserved} of your copies.`,
      tone: 'success',
    });
    setPhysicalConfirmOpen(false);
  };

  const handleToggleLock = (oracleId: string) => {
    cubeStore.toggleLock(target.id, oracleId);
  };

  const handleSwapOpen = (pickIndex: number) => {
    setSwapTarget(pickIndex);
    void loadPool();
  };
  const applySwap = (card: CubeCard) => {
    if (swapTarget === null) return;
    const liveCollection = useCollectionStore.getState().cards;
    const liveDecks = useDecksStore.getState().decks;
    cubeStore.swapPick(target.id, swapTarget, card, liveCollection, liveDecks);
    setSwapTarget(null);
    rescoreIfPossible(target.id, pool);
  };
  const swapCardName = swapTarget !== null ? (target.cube.picks[swapTarget]?.card.name ?? '') : '';

  const handleRemove = (pickIndex: number) => {
    const p = target.cube.picks[pickIndex];
    if (!p) return;
    cubeStore.removePick(target.id, pickIndex);
    rescoreIfPossible(target.id, pool);
    pushToast({
      message: `Removed ${p.card.name}`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => {
        const liveCollection = useCollectionStore.getState().cards;
        const liveDecks = useDecksStore.getState().decks;
        cubeStore.addPick(target.id, p.card, liveCollection, liveDecks);
        rescoreIfPossible(target.id, pool);
      },
    });
  };

  const handleBanOpen = (pickIndex: number) => {
    const p = target.cube.picks[pickIndex];
    if (p) setBanTarget({ pickIndex, name: p.card.name });
  };
  const confirmBan = () => {
    if (!banTarget) return;
    const p = target.cube.picks[banTarget.pickIndex];
    if (p) {
      cubeStore.banCard(target.id, p.card.oracleId);
      rescoreIfPossible(target.id, pool);
    }
    setBanTarget(null);
  };

  const handleAddOpen = () => {
    setAddOpen(true);
    setAddQuery('');
    void loadPool();
  };
  const applyAdd = (card: CubeCard) => {
    const liveCollection = useCollectionStore.getState().cards;
    const liveDecks = useDecksStore.getState().decks;
    cubeStore.addPick(target.id, card, liveCollection, liveDecks);
    rescoreIfPossible(target.id, pool);
  };
  const lockedInCube = target.cube.picks.filter((p) => lockedSet.has(p.card.oracleId));
  const unlockedCount = target.cube.picks.length - lockedInCube.length;

  const runRebuild = async () => {
    setRebuildConfirmOpen(false);
    setRebuildStatus('working');
    setRebuildError('');
    setRebuildFetchProgress(null);
    setRebuildRefineProgress(null);
    const controller = new AbortController();
    rebuildAbort.current = controller;
    try {
      const builtPool = await loadPool((fetched, total) =>
        setRebuildFetchProgress({ fetched, total })
      );
      setRebuildFetchProgress(null);
      if (!builtPool) throw new Error("Couldn't load your collection's cards. Try again.");
      const newCube = await generateCubeAsync(
        builtPool,
        target.size,
        {
          synergyLevel: target.settings?.synergyLevel ?? 0,
          format: target.cube.format ?? filters.format,
          locked: lockedInCube.map((p) => p.card),
          banned: bannedIds,
        },
        { onProgress: setRebuildRefineProgress, signal: controller.signal }
      );
      const liveCollection = useCollectionStore.getState().cards;
      const liveDecks = useDecksStore.getState().decks;
      cubeStore.replaceCube(target.id, newCube, liveCollection, liveDecks);
      pushToast({
        message:
          lockedInCube.length > 0
            ? `Rebuilt "${target.name}". Your ${lockedInCube.length} locked cards stayed.`
            : `Rebuilt "${target.name}".`,
        tone: 'success',
      });
      setRebuildStatus('idle');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setRebuildError(userMessage(e, "Couldn't rebuild the cube. Try again."));
      setRebuildStatus('error');
    }
  };

  const editHandlers: CubeEditHandlers = {
    locked: lockedSet,
    onToggleLock: handleToggleLock,
    onSwap: handleSwapOpen,
    onRemove: handleRemove,
    onBan: handleBanOpen,
  };

  return (
    <div className="cube-page">
      <BackLink to="/decks/cube" label="Cubes" />
      <PageHeader
        title={target.name}
        meta={<SavedCubeMeta sc={target} />}
        actions={[
          {
            label: 'Rebuild the rest',
            icon: Boxes,
            primary: true,
            disabled: rebuildStatus === 'working' || target.cube.picks.length === 0,
            title: "Regenerate with this cube's settings, keeping locked cards.",
            onClick: () => setRebuildConfirmOpen(true),
          },
          { label: 'Share', icon: Share2, opensDialog: true, onClick: () => setShareOpen(true) },
          { label: 'Copy cube list', icon: Copy, onClick: copyList },
          {
            label: target.isPhysical ? 'Unmark physical' : 'Mark physical',
            icon: Boxes,
            onClick: handleTogglePhysical,
          },
          { label: 'Rename', icon: Pencil, opensDialog: true, onClick: () => setRenameOpen(true) },
          ...(bannedIds.length > 0
            ? [
                {
                  label: `Banned cards (${bannedIds.length})`,
                  icon: Ban,
                  menuOnly: true,
                  onClick: () => setBannedOpen(true),
                },
              ]
            : []),
          {
            label: 'Delete',
            icon: Trash2,
            danger: true,
            menuOnly: true,
            onClick: () => setDeleteOpen(true),
          },
        ]}
      />
      <Tabs
        ariaLabel="Cube views"
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'cards', label: 'Cards', controls: 'cube-detail-panel' },
          { id: 'shopping', label: 'Shopping list', controls: 'cube-detail-panel' },
          { id: 'pull', label: 'Pull list by binder', controls: 'cube-detail-panel' },
        ]}
      />
      <div
        id="cube-detail-panel"
        role="tabpanel"
        aria-labelledby={`sc-tab-${tab}`}
        className="cube-panel"
      >
        {tab === 'cards' && rebuildStatus === 'working' && (
          <div aria-live="polite" aria-atomic="true">
            <CubeLoadingBlock
              fetchProgress={rebuildFetchProgress}
              refineProgress={rebuildRefineProgress}
              lookupLabel="Looking up your cards"
              finalizingLabel="Rebuilding the cube…"
            />
          </div>
        )}
        {tab === 'cards' && rebuildStatus === 'error' && (
          <CubeErrorBlock error={rebuildError} onRetry={runRebuild} />
        )}
        {tab === 'cards' && rebuildStatus === 'idle' && (
          <CubeResult
            cube={target.cube}
            onCopy={copyList}
            onSave={() => {}}
            loaded={target}
            ownershipFor={ownershipFor}
            committedFor={committedFor}
            enrichedMap={enrichedMap}
            hideTitle
            hideCopyAction
            edit={editHandlers}
          />
        )}
        {tab === 'cards' && rebuildStatus === 'idle' && (
          <div className="cube-add-from-collection">
            <Button icon={<Plus width={14} height={14} strokeWidth={2} />} onClick={handleAddOpen}>
              Add from collection
            </Button>
          </div>
        )}
        {tab === 'shopping' && (
          <div className="empty-state">
            <EmptyStateMark />
            <p className="empty-state-tagline">Not tracked yet.</p>
            <p className="empty-state-hint">
              The cards that would raise this cube's draftability most, ranked by price, so you know
              what to buy next.
            </p>
          </div>
        )}
        {tab === 'pull' && target.isPhysical && (
          <div className="empty-state">
            <EmptyStateMark />
            <p className="empty-state-tagline">Not built yet.</p>
            <p className="empty-state-hint">
              Where each of this cube's {target.size.toLocaleString()} cards sits in your binders,
              grouped by binder and page, so pulling it for a game is one pass through the shelf.
            </p>
          </div>
        )}
        {tab === 'pull' && !target.isPhysical && (
          <div className="empty-state">
            <EmptyStateMark />
            <p className="empty-state-tagline">Mark this cube physical first.</p>
            <p className="empty-state-hint">
              A pull list only makes sense once a cube's cards are reserved from your binders.
            </p>
            <div className="empty-state-actions">
              <Button variant="primary" onClick={handleTogglePhysical}>
                Mark physical
              </Button>
            </div>
          </div>
        )}
      </div>

      {renameOpen && (
        <NameInputDialog
          title="Rename cube"
          label="Cube name"
          initialValue={target.name}
          confirmLabel="Rename"
          onSubmit={handleRename}
          onCancel={() => setRenameOpen(false)}
        />
      )}
      {deleteOpen && (
        <ConfirmDialog
          title="Delete cube?"
          body={`"${target.name}" will be removed. This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
      {shareOpen && (
        <ShareDialog
          kind="cube"
          resourceId={target.id}
          resourceLabel={target.name}
          onClose={() => setShareOpen(false)}
        />
      )}
      {physicalConfirmOpen && (
        <ConfirmDialog
          title="Mark as a physical cube?"
          body={`"${target.name}" will reserve one of your copies for each card it can. Those copies stop showing as available for decks and binders, like sleeving the cards into the cube. You can unmark it any time to free them.`}
          confirmLabel="Mark physical"
          onConfirm={confirmPhysical}
          onCancel={() => setPhysicalConfirmOpen(false)}
        />
      )}
      {rebuildConfirmOpen && (
        <ConfirmDialog
          title="Rebuild the rest?"
          body={
            lockedInCube.length > 0
              ? `Rebuild ${unlockedCount.toLocaleString()} unlocked cards? Your ${lockedInCube.length.toLocaleString()} locked cards stay.`
              : `Rebuild all ${unlockedCount.toLocaleString()} cards in "${target.name}"?`
          }
          confirmLabel="Rebuild"
          onConfirm={runRebuild}
          onCancel={() => setRebuildConfirmOpen(false)}
        />
      )}
      {banTarget && (
        <ConfirmDialog
          title={`Ban ${banTarget.name}?`}
          body="Removed now, and never picked again on this cube's future rebuilds. Unban it later from the cube's overflow menu."
          confirmLabel="Ban card"
          danger
          onConfirm={confirmBan}
          onCancel={() => setBanTarget(null)}
        />
      )}
      {swapTarget !== null && (
        <CubeCardPickerSheet
          title={`Swap ${swapCardName}`}
          candidates={swapList}
          loading={poolLoading}
          error={poolError}
          onRetry={() => void loadPool()}
          emptyMessage="Nothing in your collection fits this slot."
          pickLabel="Use"
          onPick={applySwap}
          onClose={() => setSwapTarget(null)}
        />
      )}
      {addOpen && (
        <CubeCardPickerSheet
          title="Add from collection"
          candidates={addCandidates}
          loading={poolLoading}
          error={poolError}
          onRetry={() => void loadPool()}
          emptyMessage={
            addQuery
              ? 'No owned cards match that search.'
              : 'Every eligible card in your collection is already in this cube.'
          }
          pickLabel="Add"
          search={{ value: addQuery, onChange: setAddQuery, placeholder: 'Search your collection' }}
          onPick={applyAdd}
          onClose={() => setAddOpen(false)}
        />
      )}
      {bannedOpen && (
        <Modal
          onClose={() => setBannedOpen(false)}
          className="modal cube-picker-dialog"
          backdropClassName="modal-backdrop--sheet"
          labelledBy="cube-banned-title"
        >
          <div className="modal-header">
            <h2 id="cube-banned-title">Banned cards</h2>
            <IconButton
              className="modal-close"
              label="Close"
              icon={<X width={20} height={20} strokeWidth={1.8} />}
              onClick={() => setBannedOpen(false)}
            />
          </div>
          <div className="modal-body cube-picker-body">
            {bannedIds.length === 0 ? (
              <p className="cube-picker-empty">No cards banned.</p>
            ) : (
              <ul className="cube-picker-list">
                {bannedIds.map((oracleId) => (
                  <li key={oracleId} className="cube-picker-row">
                    <span className="cube-picker-row-body cube-picker-row-body--static">
                      <span className="cube-row-name">
                        {nameByOracle.get(oracleId) ?? 'Unknown card'}
                      </span>
                    </span>
                    <Button onClick={() => cubeStore.unbanCard(target.id, oracleId)}>Unban</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
