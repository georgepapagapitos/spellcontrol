import { useState } from 'react';
import { Boxes, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import './cube/cube.css';
import { DecksHubTabs } from '../components/DecksHubTabs';
import { PageHeader } from '../components/PageHeader';
import { BackLink } from '../components/BackLink';
import { OverflowMenu } from '../components/OverflowMenu';
import { NameInputDialog } from '../components/NameInputDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShareDialog } from '../components/ShareDialog';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { VerdictBadge } from '../components/deck/VerdictBadge';
import { useCubeStore, SavedCube } from '../store/cube';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { bindCubeCopies } from '../lib/bind-cube-copies';
import { useAwaitingFirstPull } from '../lib/use-awaiting-first-pull';
import { SavedCubeMeta } from './cube/CubeResult';

/**
 * `/decks/cube` — the cube list, a first-class index shaped like the deck
 * list: hairline rows under a section rule, one meta line per row, opening
 * the cube's own page. Replaces the old "My cubes" strip that used to sit
 * buried under the Build tab's controls.
 */
export function CubeIndexPage() {
  const cubeStore = useCubeStore();
  const saved = cubeStore.saved;
  const awaitingFirstPull = useAwaitingFirstPull();

  const [renameTarget, setRenameTarget] = useState<SavedCube | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedCube | null>(null);
  const [shareTarget, setShareTarget] = useState<SavedCube | null>(null);
  const [physicalTarget, setPhysicalTarget] = useState<SavedCube | null>(null);

  const handleRename = (name: string) => {
    if (renameTarget) cubeStore.renameSaved(renameTarget.id, name);
    setRenameTarget(null);
  };
  const handleDelete = () => {
    if (deleteTarget) cubeStore.removeSaved(deleteTarget.id);
    setDeleteTarget(null);
  };
  const handleTogglePhysical = (sc: SavedCube) => {
    if (sc.isPhysical) {
      cubeStore.setPhysical(sc.id, false, []);
    } else {
      setPhysicalTarget(sc);
    }
  };
  const confirmPhysical = () => {
    if (!physicalTarget) return;
    // Read live store state at confirm-time so binding never claims a copy
    // reallocated after the dialog opened (the project's standard for every
    // allocation mutation).
    const liveCollection = useCollectionStore.getState().cards;
    const liveDecks = useDecksStore.getState().decks;
    const others = useCubeStore
      .getState()
      .saved.filter((c) => c.isPhysical && c.id !== physicalTarget.id);
    const picks = bindCubeCopies(physicalTarget.cube.picks, liveCollection, liveDecks, others);
    cubeStore.setPhysical(physicalTarget.id, true, picks);
    setPhysicalTarget(null);
  };

  const physicalCount = saved.filter((c) => c.isPhysical).length;

  return (
    <div className="cube-page">
      <BackLink to="/decks" label="All decks" />
      <PageHeader
        title="Cubes"
        meta={
          saved.length > 0
            ? `${saved.length.toLocaleString()} ${saved.length === 1 ? 'cube' : 'cubes'}${
                physicalCount > 0 ? ` · ${physicalCount} physical` : ''
              }`
            : undefined
        }
        actions={[{ label: 'New cube', icon: Plus, primary: true, to: '/decks/cube/new' }]}
      />
      <DecksHubTabs />

      {saved.length === 0 && awaitingFirstPull ? (
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">Loading your cubes…</span>
        </div>
      ) : saved.length === 0 ? (
        <div className="empty-state">
          <EmptyStateMark />
          <p className="empty-state-tagline">Build your first cube.</p>
          <p className="empty-state-hint">
            A cube is a draft-sized pool pulled from your collection: best cards, an
            archetype-leaning build, or a mix.
          </p>
          <div className="empty-state-actions">
            <Link to="/decks/cube/new" className="btn btn-primary empty-state-action">
              <Plus width={14} height={14} strokeWidth={2} aria-hidden />
              New cube
            </Link>
          </div>
        </div>
      ) : (
        <section className="cube-index-section" aria-label="My cubes">
          <div className="section-head-rule">
            <h4>My cubes</h4>
          </div>
          <ul className="cube-index-list">
            {saved.map((sc) => (
              <li key={sc.id} className="cube-index-row">
                <Link to={`/decks/cube/${sc.id}`} className="cube-index-row-link">
                  <span className="cube-index-row-body">
                    <span className="cube-index-row-title">
                      <span className="cube-index-row-name">{sc.name}</span>
                      {sc.isPhysical && <VerdictBadge tone="accent" label="Physical" />}
                    </span>
                    <span className="cube-index-row-meta">
                      <SavedCubeMeta sc={sc} />
                    </span>
                  </span>
                </Link>
                <OverflowMenu
                  ariaLabel={`Actions for ${sc.name}`}
                  items={[
                    { label: 'Share', icon: Share2, onClick: () => setShareTarget(sc) },
                    { label: 'Rename', icon: Pencil, onClick: () => setRenameTarget(sc) },
                    {
                      label: sc.isPhysical ? 'Unmark physical' : 'Mark physical',
                      icon: Boxes,
                      onClick: () => handleTogglePhysical(sc),
                    },
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
          body={`"${deleteTarget.name}" will be removed. This can't be undone.`}
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
          body={`"${physicalTarget.name}" will reserve one of your copies for each card it can. Those copies stop showing as available for decks and binders, like sleeving the cards into the cube. You can unmark it any time to free them.`}
          confirmLabel="Mark physical"
          onConfirm={confirmPhysical}
          onCancel={() => setPhysicalTarget(null)}
        />
      )}
    </div>
  );
}
