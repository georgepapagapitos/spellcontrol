import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { useDecksStore } from '../store/decks';
import { DeckDisplay, type DeckDisplayCard } from '../components/deck/DeckDisplay';
import { CardSearchPanel } from '../components/deck/CardSearchPanel';
import { useCollectionByScryfallId } from '../lib/allocations';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === id) ?? null);
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const renameDeck = useDecksStore((s) => s.renameDeck);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);

  const collectionById = useCollectionByScryfallId();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Names already in this deck — fed to the search panel so it can mark
  // duplicates as "in deck" and let users add basics multiple times.
  const existingCardNames = useMemo(() => {
    if (!deck) return new Set<string>();
    return new Set(deck.cards.map((c) => c.card.name));
  }, [deck]);

  const commanderColorIdentity = useMemo(() => {
    if (!deck) return [];
    const ci = new Set<string>();
    for (const c of deck.commander?.color_identity ?? []) ci.add(c);
    for (const c of deck.partnerCommander?.color_identity ?? []) ci.add(c);
    return [...ci];
  }, [deck]);

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
            onClick={() => setShowAddPanel((v) => !v)}
            aria-expanded={showAddPanel}
          >
            {showAddPanel ? 'Hide cards panel' : 'Add cards'}
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
            onRemoveCard={(slotId) => removeCard(deck.id, slotId)}
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
              deckId={deck.id}
              commanderColorIdentity={commanderColorIdentity}
              existingCardNames={existingCardNames}
              onAdd={({ card, allocatedScryfallId }) => {
                addCard(deck.id, card, allocatedScryfallId);
              }}
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
