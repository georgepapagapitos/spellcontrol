import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { useDecksStore } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import { DeckDisplay, type DeckDisplayCard } from '../components/deck/DeckDisplay';
import { CardSearchPanel, type CardSearchPanelHandle } from '../components/deck/CardSearchPanel';
import {
  buildAllocationMap,
  pickCollectionCopy,
  useCollectionByScryfallId,
} from '../lib/allocations';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToastsStore } from '../store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';

export function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === id) ?? null);
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const renameDeck = useDecksStore((s) => s.renameDeck);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);
  const duplicateDeck = useDecksStore((s) => s.duplicateDeck);
  const collectionCards = useCollectionStore((s) => s.cards);
  const pushToast = useToastsStore((s) => s.push);

  const collectionById = useCollectionByScryfallId();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const searchPanelRef = useRef<CardSearchPanelHandle>(null);

  // Counts already in this deck — fed to the search panel so it can mark
  // duplicates with a live "in deck × N" hint and let users add basics
  // multiple times.
  const existingCardCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!deck) return m;
    for (const c of deck.cards) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
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
      onAction: () => addCard(deck.id, slot.card, slot.allocatedScryfallId),
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
        const claim = pickCollectionCopy(card.name, collectionCards, allocations);
        const allocatedId = claim?.scryfallId ?? null;
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
        for (const slot of dropping) addCard(deck.id, slot.card, slot.allocatedScryfallId);
      },
    });
  };

  const displayCards: DeckDisplayCard[] = deck.cards.map((c) => ({
    slotId: c.slotId,
    card: c.card,
    allocatedScryfallId: c.allocatedScryfallId,
  }));

  return (
    <div className="deck-editor-page">
      <header className="deck-editor-header">
        <div className="deck-editor-titlebar">
          <Link to="/decks" className="btn-link">
            ← All decks
          </Link>
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
              className="deck-editor-name"
              onClick={handleStartRename}
              title="Rename deck"
            >
              {deck.name}
            </button>
          )}
        </div>
        <div className="deck-editor-actions">
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
      </header>

      <div className={`deck-editor-layout${showAddPanel ? ' with-panel' : ''}`}>
        <main className="deck-editor-main">
          <DeckDisplay
            title={deck.name}
            deckId={deck.id}
            commander={deck.commander}
            partnerCommander={deck.partnerCommander}
            cards={displayCards}
            onRemoveCard={handleRemoveCard}
            onSetQty={handleSetQty}
            collectionByScryfallId={collectionById}
            roleCounts={deck.roleCounts}
            rampSubtypeCounts={deck.rampSubtypeCounts}
            removalSubtypeCounts={deck.removalSubtypeCounts}
            boardwipeSubtypeCounts={deck.boardwipeSubtypeCounts}
            cardDrawSubtypeCounts={deck.cardDrawSubtypeCounts}
            bracketEstimation={deck.bracketEstimation}
            deckGrade={deck.deckGrade}
          />
        </main>

        {showAddPanel && deck.commander && (
          <aside className="deck-editor-aside">
            <CardSearchPanel
              ref={searchPanelRef}
              deckId={deck.id}
              commanderColorIdentity={commanderColorIdentity}
              existingCardCounts={existingCardCounts}
              onAdd={({ card, allocatedScryfallId }) => {
                addCard(deck.id, card, allocatedScryfallId);
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

      {/* Suppress unused-import lint */}
      <span hidden>{updateDeck.name}</span>
    </div>
  );
}
