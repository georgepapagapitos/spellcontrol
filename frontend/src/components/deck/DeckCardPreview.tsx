import type { ReactNode } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { LegalityIssue } from '@/lib/deck/deck-validation';
import { CardPreview } from '@/components/card/CardPreview';
import { DeckCardPreviewMeta } from './DeckCardPreviewMeta';
import { resolveInclusionPct, type CrossDeckCtx } from './deck-display-rows';
import { buildFlatIndex, bindersForRow, allocationsForRow } from './deck-display-derive';
import { buildPreviewActions } from './deck-display-actions';
import type { DeckDisplayCard, DeckDisplayProps } from './deck-display-types';

interface Props {
  flat: ReturnType<typeof buildFlatIndex>;
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  title: string;
  deckId: string | undefined;
  commander: ScryfallCard | null;
  cards: DeckDisplayCard[];
  existingDeckTags: string[];
  synergyByName: Map<string, string[]> | undefined;
  cardInclusionMap: DeckDisplayProps['cardInclusionMap'];
  legalityBySlot: Map<string, LegalityIssue>;
  binderByCopyId: DeckDisplayProps['binderByCopyId'];
  crossDeck: CrossDeckCtx;
  onSetCardTags: DeckDisplayProps['onSetCardTags'];
  onEditCard: DeckDisplayProps['onEditCard'];
  onRemoveCard: DeckDisplayProps['onRemoveCard'];
  renderSwapSuggestions: DeckDisplayProps['renderSwapSuggestions'];
  renderSimilarCards: DeckDisplayProps['renderSimilarCards'];
}

/** The deck's card carousel, with its per-card meta, actions and swap panels. */
export function DeckCardPreview({
  flat,
  index,
  onIndexChange,
  onClose,
  title,
  deckId,
  commander,
  cards,
  existingDeckTags,
  synergyByName,
  cardInclusionMap,
  legalityBySlot,
  binderByCopyId,
  crossDeck,
  onSetCardTags,
  onEditCard,
  onRemoveCard,
  renderSwapSuggestions,
  renderSimilarCards,
}: Props): ReactNode {
  return (
    <CardPreview
      source="deck"
      cards={flat.cards}
      sectionLabels={flat.labels}
      pageNumbers={flat.cards.map(() => 0)}
      totalPages={1}
      binderName={title}
      currentDeckId={deckId}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      renderPanelMeta={(i) => {
        const r = flat.rows[i];
        if (!r) return null;
        // Commander/partner rows have no deck slot (r.slotIds is empty) —
        // nothing to tag, so the editor stays off; existing tags (there
        // never are any) still display via `tags` if that ever changes.
        const canEditTags = !!onSetCardTags && r.slotIds.length > 0;
        return (
          <DeckCardPreviewMeta
            card={r.card}
            isPartner={r.isPartner}
            isCommander={!r.isPartner && commander?.name === r.name}
            synergies={synergyByName?.get(r.name)}
            inclusionPct={resolveInclusionPct(cardInclusionMap, r)}
            legality={
              (r.legalitySlotKey ?? r.slotIds[0])
                ? legalityBySlot.get(r.legalitySlotKey ?? r.slotIds[0])
                : undefined
            }
            status={r.status}
            tags={r.tags}
            deckCards={cards}
            existingDeckTags={existingDeckTags}
            onSetTags={
              canEditTags ? (tags) => onSetCardTags!(flat.zones[i], r.slotIds, tags) : undefined
            }
          />
        );
      }}
      // The 99, where the deck's own commander is settled; the commander's
      // own "who else plays this?" stays open.
      playedInStartsClosed={(i) => !!flat.rows[i]?.slotIds.length}
      renderPanelExtra={(i) => {
        // In-context "Swap this card" + "Similar cards": offered only for a
        // real in-deck card (commander/partner rows carry no slotId, so
        // they're excluded).
        const r = flat.rows[i];
        if (!r) return null;
        const slotId = r.slotIds[r.slotIds.length - 1];
        if (!slotId) return null;
        return (
          <>
            {renderSwapSuggestions?.(r.card, slotId, onClose)}
            {renderSimilarCards?.(r.card, slotId, onClose)}
          </>
        );
      }}
      getStackBinders={(i) => {
        const r = flat.rows[i];
        return r ? bindersForRow(r, binderByCopyId) : [];
      }}
      getStackAllocations={(i) => {
        const r = flat.rows[i];
        return r ? allocationsForRow(r, crossDeck.otherDeckAllocations) : [];
      }}
      getActions={(i) =>
        buildPreviewActions({
          row: flat.rows[i],
          onEditCard,
          onRemoveCard,
          closePreview: onClose,
        })
      }
    />
  );
}
