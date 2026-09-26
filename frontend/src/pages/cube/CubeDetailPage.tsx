import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Boxes, Pencil, Share2, Trash2 } from 'lucide-react';
import './cube.css';
import { BackLink } from '../../components/BackLink';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { NameInputDialog } from '../../components/NameInputDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ShareDialog } from '../../components/ShareDialog';
import { EmptyStateMark } from '../../components/shared/EmptyStateMark';
import { useCubeStore } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useToastsStore } from '../../store/toasts';
import { bindCubeCopies } from '../../lib/bind-cube-copies';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { toCubeCobraList } from '../../lib/cube/format';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import type { ScryfallCard } from '@/deck-builder/types';
import { useOwnershipFor } from './shared';
import { CubeResult, SavedCubeMeta } from './CubeResult';
import { Button } from '../../components/shared/Button';

type DetailTab = 'cards' | 'shopping' | 'pull';

/** `/decks/cube/:id` — the cube's own page. Same header anatomy as a deck's:
 *  back link · title · one meta line · actions · tabs. Cards tab reuses
 *  `CubeResult`'s sections (color balance, archetype support, gaps, sample
 *  pack, the cards); Shopping list and Pull list by binder are designed
 *  empty states that reserve their tab slot without pretending to be built. */
export function CubeDetailPage() {
  const { id } = useParams();
  const cubeStore = useCubeStore();
  const saved = cubeStore.saved;
  const awaitingFirstPull = useAwaitingFirstPull();
  const pushToast = useToastsStore((s) => s.push);
  const target = saved.find((c) => c.id === id) ?? null;

  const [tab, setTab] = useState<DetailTab>('cards');
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [physicalConfirmOpen, setPhysicalConfirmOpen] = useState(false);
  const [enrichedMap, setEnrichedMap] = useState<Map<string, ScryfallCard>>(new Map());

  const { ownershipFor, committedFor } = useOwnershipFor(target?.id ?? null);

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
            disabled: true,
            title: 'Rebuilding a cube lands with card locking, banning and swapping.',
            onClick: () => {},
          },
          { label: 'Share', icon: Share2, opensDialog: true, onClick: () => setShareOpen(true) },
          {
            label: target.isPhysical ? 'Unmark physical' : 'Mark physical',
            icon: Boxes,
            onClick: handleTogglePhysical,
          },
          { label: 'Rename', icon: Pencil, opensDialog: true, onClick: () => setRenameOpen(true) },
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
        {tab === 'cards' && (
          <CubeResult
            cube={target.cube}
            onCopy={copyList}
            onSave={() => {}}
            loaded={target}
            ownershipFor={ownershipFor}
            committedFor={committedFor}
            enrichedMap={enrichedMap}
            hideTitle
          />
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
    </div>
  );
}
