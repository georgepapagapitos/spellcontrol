import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { useDecksStore } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import { DeckDisplay, type DeckDisplayCard } from '../components/deck/DeckDisplay';
import { CardSearchPanel, type CardSearchPanelHandle } from '../components/deck/CardSearchPanel';
import { CardEditDialog, type PrintingSelection } from '../components/CardEditDialog';
import { buildAllocationMap, pickCollectionCopy, useCollectionByCopyId } from '../lib/allocations';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BackLink } from '../components/BackLink';
import { ColorPicker } from '../components/ColorPicker';
import { Modal } from '../components/Modal';
import { isValidCommander } from '../lib/commanders';
import { useToastsStore } from '../store/toasts';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import type { ScryfallCard } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

export function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === id) ?? null);
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const renameDeck = useDecksStore((s) => s.renameDeck);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);
  const addSideboardCard = useDecksStore((s) => s.addSideboardCard);
  const removeSideboardCard = useDecksStore((s) => s.removeSideboardCard);
  const moveBetweenZones = useDecksStore((s) => s.moveBetweenZones);
  const setCommander = useDecksStore((s) => s.setCommander);
  const duplicateDeck = useDecksStore((s) => s.duplicateDeck);
  const collectionCards = useCollectionStore((s) => s.cards);
  const updateCardPrinting = useDecksStore((s) => s.updateCardPrinting);
  const pushToast = useToastsStore((s) => s.push);

  const collectionById = useCollectionByCopyId();
  const [editingSlot, setEditingSlot] = useState<{ slotId: string; card: ScryfallCard } | null>(
    null
  );
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const [makeCommanderTarget, setMakeCommanderTarget] = useState<{
    slotId: string;
    card: ScryfallCard;
    zone: 'main' | 'side';
    allocatedCopyId: string | null;
  } | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Hoisted so the mobile action sheet can open Export without rendering
  // a duplicate button. Passed to DeckDisplay as a controlled prop pair.
  const [exportOpen, setExportOpen] = useState(false);
  const [addZone, setAddZone] = useState<'main' | 'side'>('main');
  const searchPanelRef = useRef<CardSearchPanelHandle>(null);

  // Counts already in this deck — fed to the search panel so it can mark
  // duplicates with a live "in deck × N" hint and let users add basics
  // multiple times.
  const formatConfig = deck ? DECK_FORMAT_CONFIGS[deck.format] : null;

  const existingCardCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!deck) return m;
    for (const c of deck.cards) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
    for (const c of deck.sideboard) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
    return m;
  }, [deck]);

  const commanderColorIdentity = useMemo(() => {
    if (!deck) return [];
    const ci = new Set<string>();
    for (const c of deck.commander?.color_identity ?? []) ci.add(c);
    for (const c of deck.partnerCommander?.color_identity ?? []) ci.add(c);
    return [...ci];
  }, [deck]);

  // `/` shortcut → open the panel and focus the search input. Skipped while
  // the user is typing into another input/textarea (so `/` still types
  // literally inside a deck name rename, search box, etc.).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      e.preventDefault();
      setShowAddPanel(true);
      // Wait a tick so the panel mounts before focusing.
      window.requestAnimationFrame(() => searchPanelRef.current?.focusInput());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!colorPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColorPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [colorPickerOpen]);

  if (!id) return <Navigate to="/decks" replace />;
  if (!deck) {
    return (
      <div className="deck-editor-missing">
        <p>That deck no longer exists.</p>
        <Link to="/decks" className="btn btn-primary">
          Back to decks
        </Link>
      </div>
    );
  }

  const handleStartRename = () => {
    setDraftName(deck.name);
    setRenaming(true);
  };
  const handleCommitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== deck.name) renameDeck(deck.id, trimmed);
    setRenaming(false);
  };
  const handleConfirmDelete = () => {
    deleteDeck(deck.id);
    navigate('/decks');
  };
  const handleDuplicate = () => {
    const newId = duplicateDeck(deck.id);
    if (newId) navigate(`/decks/${newId}`);
  };

  // Capture the slot before removing so Undo can re-add the same card with
  // the same allocated printing. (`addCard` mints a fresh slotId, but the
  // collection allocation is what actually matters to the user.)
  const handleRemoveCard = (slotId: string) => {
    const slot = deck.cards.find((c) => c.slotId === slotId);
    if (!slot) return;
    removeCard(deck.id, slotId);
    pushToast({
      message: `Removed ${slot.card.name}`,
      tone: 'info',
      actionLabel: 'Undo',
      onAction: () => addCard(deck.id, slot.card, slot.allocatedCopyId),
    });
  };

  const handleRemoveSideboardCard = (slotId: string) => {
    const slot = deck.sideboard.find((c) => c.slotId === slotId);
    if (!slot) return;
    removeSideboardCard(deck.id, slotId);
    pushToast({
      message: `Removed ${slot.card.name} from sideboard`,
      tone: 'info',
      actionLabel: 'Undo',
      onAction: () => addSideboardCard(deck.id, slot.card, slot.allocatedCopyId),
    });
  };

  const handleMoveToSideboard = (slotId: string) => {
    moveBetweenZones(deck.id, slotId, 'main');
  };

  const handleMoveToMainboard = (slotId: string) => {
    moveBetweenZones(deck.id, slotId, 'side');
  };

  const handleMakeCommanderClick = (slotId: string, card: ScryfallCard) => {
    const mainSlot = deck.cards.find((c) => c.slotId === slotId);
    const sideSlot = mainSlot ? null : deck.sideboard.find((c) => c.slotId === slotId);
    const slot = mainSlot ?? sideSlot;
    if (!slot) return;
    const target = {
      slotId,
      card,
      zone: (mainSlot ? 'main' : 'side') as 'main' | 'side',
      allocatedCopyId: slot.allocatedCopyId,
    };
    // No current commander → just set it directly, no dialog needed.
    if (!deck.commander) {
      if (target.zone === 'main') removeCard(deck.id, slotId);
      else removeSideboardCard(deck.id, slotId);
      setCommander(deck.id, card, target.allocatedCopyId);
      pushToast({ message: `${card.name} is now the commander`, tone: 'success' });
      return;
    }
    setMakeCommanderTarget(target);
  };

  const handleConfirmMakeCommander = (keepOldInDeck: boolean) => {
    const target = makeCommanderTarget;
    if (!target) return;
    const oldCommander = deck.commander;
    const oldAllocated = deck.commanderAllocatedCopyId;
    setMakeCommanderTarget(null);

    if (target.zone === 'main') removeCard(deck.id, target.slotId);
    else removeSideboardCard(deck.id, target.slotId);

    if (keepOldInDeck && oldCommander) {
      addCard(deck.id, oldCommander, oldAllocated);
    }
    setCommander(deck.id, target.card, target.allocatedCopyId);
    pushToast({
      message: `${target.card.name} is now the commander${
        keepOldInDeck && oldCommander ? ` · ${oldCommander.name} moved to the deck` : ''
      }`,
      tone: 'success',
    });
  };

  // Click-to-edit qty handler: diffs the desired count against the live
  // count and adds or removes slots in bulk. Bulk removes show ONE toast
  // for the whole batch with an Undo that restores every original
  // allocation — important for basics where the user might drop 8 copies
  // in a single edit.
  const handleSetQty = (card: ScryfallCard, qty: number) => {
    const current = deck.cards.filter((c) => c.card.name === card.name);
    const delta = qty - current.length;
    if (delta === 0) return;
    if (delta > 0) {
      // Reuse the live allocations between iterations so two adds don't
      // try to claim the same collection copy.
      const allocations = buildAllocationMap(useDecksStore.getState().decks);
      for (let i = 0; i < delta; i++) {
        const claim = pickCollectionCopy(card.name, collectionCards, allocations, card.id);
        const allocatedId = claim?.copyId ?? null;
        if (allocatedId) {
          allocations.set(allocatedId, {
            deckId: deck.id,
            deckName: deck.name,
            cardName: card.name,
          });
        }
        addCard(deck.id, card, allocatedId);
      }
      return;
    }
    // delta < 0 → drop the most-recent N slots; remember them so undo can
    // recreate the same allocations in one go.
    const dropping = current.slice(delta); // last |delta| items
    for (const slot of [...dropping].reverse()) removeCard(deck.id, slot.slotId);
    pushToast({
      message:
        dropping.length === 1
          ? `Removed ${card.name}`
          : `Removed ${dropping.length} × ${card.name}`,
      tone: 'info',
      actionLabel: 'Undo',
      onAction: () => {
        for (const slot of dropping) addCard(deck.id, slot.card, slot.allocatedCopyId);
      },
    });
  };

  const handleEditCard = (slotId: string, card: ScryfallCard) => {
    setEditingSlot({ slotId, card });
  };

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingSlot || !deck) return;
    const newCard = selection.card;
    const slotsForName = deck.cards.filter((c) => c.card.name === editingSlot.card.name);
    for (const slot of slotsForName) {
      updateCardPrinting(deck.id, slot.slotId, newCard);
    }
    setEditingSlot(null);
    pushToast({ message: `Updated printing for ${newCard.name}`, tone: 'info' });
  };

  const displayCards: DeckDisplayCard[] = deck.cards.map((c) => ({
    slotId: c.slotId,
    card: c.card,
    allocatedCopyId: c.allocatedCopyId,
  }));

  const displaySideboard: DeckDisplayCard[] = deck.sideboard.map((c) => ({
    slotId: c.slotId,
    card: c.card,
    allocatedCopyId: c.allocatedCopyId,
  }));

  return (
    <div className="deck-editor-page">
      <BackLink to="/decks" label="All decks" />
      <header className="deck-editor-header">
        <div className="deck-editor-hero" style={{ borderLeftColor: deck.color }}>
          {renaming ? (
            <input
              autoFocus
              type="text"
              className="deck-editor-name-input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={handleCommitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="deck-editor-name binder-hero-name"
              onClick={handleStartRename}
              title="Rename deck"
            >
              {deck.name}
            </button>
          )}
          <p className="binder-hero-meta">
            {formatConfig && <span className="deck-format-badge">{formatConfig.label}</span>}
            {deck.commander && (
              <>
                {formatConfig ? ' · ' : ''}
                {deck.commander.name}
              </>
            )}
          </p>
        </div>
        <div className="deck-editor-actions">
          <div className="deck-editor-color" ref={colorPickerRef}>
            <button
              type="button"
              className="btn deck-editor-color-btn"
              onClick={() => setColorPickerOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={colorPickerOpen}
              title="Deck color"
            >
              <span
                className="deck-editor-color-dot"
                style={{ background: deck.color }}
                aria-hidden
              />
              Color
            </button>
            {colorPickerOpen && (
              <div className="deck-editor-color-popover" role="dialog" aria-label="Deck color">
                <ColorPicker
                  value={deck.color}
                  onChange={(hex) => updateDeck(deck.id, { color: hex })}
                  ariaLabel="Deck color"
                />
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const next = !showAddPanel;
              setShowAddPanel(next);
              if (next) {
                window.requestAnimationFrame(() => searchPanelRef.current?.focusInput());
              }
            }}
            aria-expanded={showAddPanel}
            title="Add cards (press / to focus search)"
          >
            {showAddPanel ? 'Hide cards panel' : 'Add cards'}
          </button>
          <button type="button" className="btn" onClick={handleDuplicate}>
            Duplicate
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
        <DeckEditorOverflowMenu
          isAddPanelOpen={showAddPanel}
          onToggleAddPanel={() => {
            const next = !showAddPanel;
            setShowAddPanel(next);
            if (next) {
              window.requestAnimationFrame(() => searchPanelRef.current?.focusInput());
            }
          }}
          onDuplicate={handleDuplicate}
          onDelete={() => setConfirmDelete(true)}
          onExport={() => setExportOpen(true)}
          color={deck.color}
          onColorChange={(hex) => updateDeck(deck.id, { color: hex })}
        />
      </header>

      <div className={`deck-editor-layout${showAddPanel ? ' with-panel' : ''}`}>
        <main className="deck-editor-main">
          <DeckDisplay
            title={deck.name}
            deckId={deck.id}
            format={deck.format}
            commander={deck.commander}
            partnerCommander={deck.partnerCommander}
            commanderAllocatedCopyId={deck.commanderAllocatedCopyId}
            partnerCommanderAllocatedCopyId={deck.partnerCommanderAllocatedCopyId}
            cards={displayCards}
            sideboard={displaySideboard}
            onRemoveCard={handleRemoveCard}
            onRemoveSideboardCard={handleRemoveSideboardCard}
            onMoveToSideboard={handleMoveToSideboard}
            onMoveToMainboard={handleMoveToMainboard}
            onSetQty={handleSetQty}
            onEditCard={handleEditCard}
            onMakeCommander={formatConfig?.hasCommander ? handleMakeCommanderClick : undefined}
            canMakeCommander={formatConfig?.hasCommander ? isValidCommander : undefined}
            collectionByCopyId={collectionById}
            roleCounts={deck.roleCounts}
            rampSubtypeCounts={deck.rampSubtypeCounts}
            removalSubtypeCounts={deck.removalSubtypeCounts}
            boardwipeSubtypeCounts={deck.boardwipeSubtypeCounts}
            cardDrawSubtypeCounts={deck.cardDrawSubtypeCounts}
            bracketEstimation={deck.bracketEstimation}
            deckGrade={deck.deckGrade}
            exportOpen={exportOpen}
            onExportOpenChange={setExportOpen}
          />
        </main>

        {showAddPanel && (formatConfig?.hasCommander ? deck.commander : true) && (
          <aside className="deck-editor-aside">
            {formatConfig && formatConfig.sideboardSize > 0 && (
              <div className="deck-editor-zone-toggle">
                <button
                  type="button"
                  className={`btn btn-sm${addZone === 'main' ? ' btn-primary' : ''}`}
                  onClick={() => setAddZone('main')}
                >
                  Mainboard
                </button>
                <button
                  type="button"
                  className={`btn btn-sm${addZone === 'side' ? ' btn-primary' : ''}`}
                  onClick={() => setAddZone('side')}
                >
                  Sideboard
                </button>
              </div>
            )}
            <CardSearchPanel
              ref={searchPanelRef}
              deckId={deck.id}
              commanderColorIdentity={commanderColorIdentity}
              existingCardCounts={existingCardCounts}
              onAdd={({ card, allocatedCopyId }) => {
                if (addZone === 'side') {
                  addSideboardCard(deck.id, card, allocatedCopyId);
                } else {
                  addCard(deck.id, card, allocatedCopyId);
                }
              }}
              onClose={() => setShowAddPanel(false)}
            />
          </aside>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete deck"
          body={`Delete "${deck.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {editingSlot && (
        <CardEditDialog
          cardName={editingSlot.card.name}
          currentScryfallId={editingSlot.card.id}
          currentFinish="nonfoil"
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingSlot(null)}
        />
      )}

      {makeCommanderTarget && deck.commander && (
        <Modal onClose={() => setMakeCommanderTarget(null)} labelledBy="make-commander-title">
          <h2 id="make-commander-title" className="choice-dialog-title">
            Make {makeCommanderTarget.card.name} the commander?
          </h2>
          <p className="choice-dialog-body">
            <strong>{deck.commander.name}</strong> is currently the commander. What should happen to
            it?
          </p>
          <div className="choice-dialog-actions">
            <button type="button" className="btn" onClick={() => setMakeCommanderTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => handleConfirmMakeCommander(false)}>
              Remove from deck
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleConfirmMakeCommander(true)}
              autoFocus
            >
              Keep in deck
            </button>
          </div>
        </Modal>
      )}

      {/* Suppress unused-import lint */}
      <span hidden>{updateDeck.name}</span>
    </div>
  );
}

function DeckEditorOverflowMenu({
  isAddPanelOpen,
  onToggleAddPanel,
  onDuplicate,
  onDelete,
  onExport,
  color,
  onColorChange,
}: {
  isAddPanelOpen: boolean;
  onToggleAddPanel: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  color: string;
  onColorChange: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'color'>('menu');
  const wrapperRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);

  // Closing the sheet resets the sub-view so reopening lands on the action
  // list. Done as a render-phase reset to keep setState out of useEffect
  // (cascading-render lint).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open && view !== 'menu') setView('menu');
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'color') setView('menu');
        else setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, view]);

  return (
    <div className="deck-editor-overflow" ref={wrapperRef}>
      <button
        type="button"
        className="deck-editor-overflow-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Deck actions"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && (
        <>
          <div
            className="deck-editor-overflow-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="deck-editor-overflow-panel" role="menu">
            <div className="deck-editor-overflow-handle" aria-hidden />
            {view === 'menu' && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="deck-editor-overflow-item"
                  onClick={() => {
                    setOpen(false);
                    onToggleAddPanel();
                  }}
                >
                  {isAddPanelOpen ? 'Hide cards panel' : 'Add cards'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="deck-editor-overflow-item"
                  onClick={() => setView('color')}
                >
                  <span
                    className="deck-editor-overflow-color-dot"
                    style={{ background: color }}
                    aria-hidden
                  />
                  Color
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="deck-editor-overflow-item"
                  onClick={() => {
                    setOpen(false);
                    onDuplicate();
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="deck-editor-overflow-item"
                  onClick={() => {
                    setOpen(false);
                    onExport();
                  }}
                >
                  Export
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="deck-editor-overflow-item deck-editor-overflow-item--danger"
                  onClick={() => {
                    setOpen(false);
                    onDelete();
                  }}
                >
                  Delete
                </button>
              </>
            )}
            {view === 'color' && (
              <div className="deck-editor-overflow-subview">
                <div className="deck-editor-overflow-subview-header">
                  <button
                    type="button"
                    className="deck-editor-overflow-back"
                    onClick={() => setView('menu')}
                    aria-label="Back"
                  >
                    ‹
                  </button>
                  <span className="deck-editor-overflow-subview-title">Deck color</span>
                </div>
                <ColorPicker value={color} onChange={onColorChange} ariaLabel="Deck color" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
