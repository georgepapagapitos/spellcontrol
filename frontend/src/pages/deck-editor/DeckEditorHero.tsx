import { Play, Plus, Redo2, Undo2, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { ColorPicker } from '@/components/binder/ColorPicker';
import { DeckFormatLink } from '../../components/deck/DeckFormatLink';
import { DeckHero } from '../../components/deck/DeckHero';
import { DeckVisibilityChip } from '../../components/deck/DeckVisibilityChip';
import { ForkedFromBadge } from '../../components/deck/ForkedFromBadge';
import { Button, IconButton } from '@/components/shared/Button';
import { InlineRename } from '@/components/shared/InlineRename';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { formatMoney } from '@/lib/collection/format-money';
import { DECK_NAME_MAX } from '@/lib/deck/deck-name';
import type { heroBracketReadout } from '@/lib/deck-analysis/format-bracket-label';
import { BackLink } from '@/components/app-shell/BackLink';
import { useDecksStore, type Deck } from '../../store/decks';
import { useDeckHistoryStore } from '../../store/deck-history';

interface DeckEditorHeroProps {
  deck: Deck;
  art: ComponentProps<typeof DeckHero>['art'];
  formatConfig: (typeof DECK_FORMAT_CONFIGS)[Deck['format']] | null;
  heroTotals: { count: number; value: number; sideboard: number; considering: number };
  bracketValue: number | undefined;
  heroBracket: ReturnType<typeof heroBracketReadout> | undefined;
  commanderColorIdentity: ComponentProps<typeof DeckVisibilityChip>['colorIdentity'];
  renaming: boolean;
  setRenaming: (editing: boolean) => void;
  onCommitRename: ComponentProps<typeof InlineRename>['onCommit'];
  updateDeck: ReturnType<typeof useDecksStore.getState>['updateDeck'];
  isDesktop: boolean;
  isPhone: boolean;
  undoEdit: ReturnType<typeof useDeckHistoryStore.getState>['undo'];
  redoEdit: ReturnType<typeof useDeckHistoryStore.getState>['redo'];
  canUndoEdit: boolean;
  canRedoEdit: boolean;
  undoEditLabel: string | null;
  redoEditLabel: string | null;
  showAddPanel: boolean;
  onToggleAddPanel: () => void;
  /** The kebab menu, built by the page because every action it triggers is page state. */
  overflowMenu: ReactNode;
}

/** The editor's hero: identity (name + color), totals and bracket meta line, and the action row. */
export function DeckEditorHero({
  deck,
  art,
  formatConfig,
  heroTotals,
  bracketValue,
  heroBracket,
  commanderColorIdentity,
  renaming,
  setRenaming,
  onCommitRename,
  updateDeck,
  isDesktop,
  isPhone,
  undoEdit,
  redoEdit,
  canUndoEdit,
  canRedoEdit,
  undoEditLabel,
  redoEditLabel,
  showAddPanel,
  onToggleAddPanel,
  overflowMenu,
}: DeckEditorHeroProps) {
  return (
    <DeckHero
      art={art}
      color={deck.color}
      colors={commanderColorIdentity}
      back={<BackLink to="/decks" label="All decks" />}
      title={
        // Identity is the header (STYLE_GUIDE § Config surfaces): name and
        // color are a color dot and an inline name field together, one
        // editing surface — so the explicit Done stays (unlike a plain
        // rename, blur can't close this: picking a color swatch keeps
        // focus put on purpose, InlineRename's own mousedown guard).
        <h1 className="deck-editor-title">
          {/* renameLabel carries the deck's own name (not a bare "Rename
              deck") so a screen-reader user tabbing straight to this
              button hears which deck, not just the verb. */}
          <InlineRename
            value={deck.name}
            onCommit={onCommitRename}
            editing={renaming}
            onEditingChange={setRenaming}
            label="Deck name"
            renameLabel={`Rename ${deck.name}`}
            maxLength={DECK_NAME_MAX}
            className="deck-editor-name binder-hero-name"
            inputClassName="deck-editor-name-input"
            editClassName="deck-editor-hero-edit"
            doneLabel="Done"
          >
            <div className="deck-editor-hero-edit-color">
              <span className="deck-editor-hero-edit-label">Color</span>
              <ColorPicker
                value={deck.color}
                onChange={(hex) => updateDeck(deck.id, { color: hex })}
                ariaLabel="Deck color"
              />
            </div>
          </InlineRename>
        </h1>
      }
      meta={
        <>
          {/* The format is a link to its own sheet, like sharing at the
                  line's end: a value here that can change opens where it
                  changes (E465). */}
          {formatConfig && <DeckFormatLink deck={deck} />}
          {/* The deck's totals. The sideboard and considering counts are
                  also the way INTO those zones: each links to the out-zone at
                  the foot of the deck body, which is why the toolbar no longer
                  carries a separate "Not in deck" jump. One fact in one place,
                  with the affordance on the fact rather than beside it. */}
          <span className="deck-hero-totals">
            {formatConfig ? '\u00A0· ' : ''}
            {heroTotals.count}
            {'\u00A0'}
            {heroTotals.count === 1 ? 'card' : 'cards'}
            {'\u00A0· '}
            {formatMoney(heroTotals.value)}
            {heroTotals.sideboard > 0 && (
              <>
                {'\u00A0· '}
                <a
                  href="#deck-outzone"
                  className="deck-hero-outzone-link"
                  aria-label={`${heroTotals.sideboard} in the sideboard. Jump to the cards not in the deck.`}
                >
                  {`+${heroTotals.sideboard}\u00A0sideboard`}
                </a>
              </>
            )}
            {heroTotals.considering > 0 && (
              <>
                {'\u00A0· '}
                <a
                  href="#deck-outzone"
                  className="deck-hero-outzone-link"
                  aria-label={`${heroTotals.considering} being considered. Jump to the cards not in the deck.`}
                >
                  {`+${heroTotals.considering}\u00A0considering`}
                </a>
              </>
            )}
          </span>
          {/* Bracket — glanceable on every view (it left the feature strip).
                  The hero is the one place the Deck tab states it, so a stated
                  bracket the Estimate disagrees with carries the Estimate here
                  ("Bracket 2 · est. 4", § Bracket: the owner's word); the deck
                  stats under the list no longer repeat either. On a phone the
                  Power tab's badge, straight under the header, already shows
                  it, so the one-line meta leaves it out rather than say it
                  twice on one screen. */}
          {bracketValue != null && !isPhone && (
            <span
              className="deck-hero-bracket"
              aria-label={heroBracket?.aria}
              role={heroBracket?.aria ? 'img' : undefined}
            >
              {`\u00A0· ${heroBracket?.text.replace(/ /g, '\u00A0')}`}
            </span>
          )}
          {/* Sharing is a fact about the deck, so it is the meta line's last
              segment; the status itself opens ShareDialog. On a phone it is a
              header action instead: in a 358px line it wrapped the meta onto
              extra 44px touch rows (STYLE_GUIDE § Page hero art, deck header). */}
          {!isPhone && (
            <>
              {' · '}
              <DeckVisibilityChip
                deckId={deck.id}
                deckName={deck.name}
                colorIdentity={commanderColorIdentity}
              />
            </>
          )}
        </>
      }
      actions={
        <>
          {isDesktop && (
            <>
              <IconButton
                variant="secondary"
                className="deck-editor-action-btn deck-editor-icon-btn"
                onClick={() => undoEdit(deck.id)}
                disabled={!canUndoEdit}
                title={canUndoEdit ? `Undo: ${undoEditLabel} (Ctrl/Cmd+Z)` : 'Nothing to undo'}
                label={canUndoEdit ? `Undo ${undoEditLabel}` : 'Nothing to undo'}
                icon={<Undo2 width={14} height={14} strokeWidth={1.8} />}
              />
              <IconButton
                variant="secondary"
                className="deck-editor-action-btn deck-editor-icon-btn"
                onClick={() => redoEdit(deck.id)}
                disabled={!canRedoEdit}
                title={
                  canRedoEdit ? `Redo: ${redoEditLabel} (Ctrl/Cmd+Shift+Z)` : 'Nothing to redo'
                }
                label={canRedoEdit ? `Redo ${redoEditLabel}` : 'Nothing to redo'}
                icon={<Redo2 width={14} height={14} strokeWidth={1.8} />}
              />
            </>
          )}
          {!isPhone && (
            <Button
              to={`/decks/${deck.id}/playtest`}
              className="deck-editor-action-btn"
              icon={<Play width={14} height={14} strokeWidth={1.8} />}
            >
              Playtest
            </Button>
          )}
          <Button
            variant="primary"
            onClick={onToggleAddPanel}
            aria-expanded={showAddPanel}
            title="Add cards (press / to focus search)"
            className="deck-editor-action-btn deck-editor-add-btn"
            icon={
              showAddPanel ? (
                <X width={14} height={14} strokeWidth={1.8} />
              ) : (
                <Plus width={14} height={14} strokeWidth={1.8} />
              )
            }
          >
            {showAddPanel ? 'Hide cards panel' : 'Add cards'}
          </Button>
          {isPhone && (
            <DeckVisibilityChip
              variant="button"
              deckId={deck.id}
              deckName={deck.name}
              colorIdentity={commanderColorIdentity}
            />
          )}
          {/* Tokens, Pull list, Duplicate and Delete (UX-316: destructive
              actions live here, never inline) are all in the ⋮. */}
          {overflowMenu}
        </>
      }
    >
      {deck.forkedFrom && <ForkedFromBadge forkedFrom={deck.forkedFrom} />}
    </DeckHero>
  );
}
