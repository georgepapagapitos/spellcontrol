// The action lists DeckDisplay hands to its menus, card preview and bulk bar,
// built from the host's callbacks. Moved out verbatim (T176, W5); nothing here
// owns state, the component passes its setters in.
import { Pencil, Trash2 } from 'lucide-react';
import type { DeckZone } from '../../store/decks';
import type { CardPreviewAction } from '@/components/card/CardPreview';
import type { DeckBulkAction } from './DeckSelectionMenu';
import type { DeckCardActionCtx } from './deck-card-actions';
import type { Row } from './deck-display-rows';
import type { DeckDisplayProps } from './deck-display-types';

export type DeckSelection = { zone: DeckZone; keys: Set<string> };

/** The host callbacks a row's menu reads; zone-independent ones only. */
export type CardMenuHandlers = Pick<
  DeckDisplayProps,
  | 'onEditCard'
  | 'onRemoveCard'
  | 'onRemoveSideboardCard'
  | 'onRemoveConsideringCard'
  | 'onMoveToSideboard'
  | 'onMoveToMainboard'
  | 'onMoveToConsidering'
  | 'onMoveFromConsidering'
  | 'onUseOwnCopy'
  | 'onMoveToAnotherDeck'
  | 'onReleaseCopy'
  | 'onMakeCommander'
  | 'canMakeCommander'
  | 'onMakePartner'
  | 'canMakePartner'
  | 'onChangeCommander'
  | 'cover'
  | 'onSetCardTags'
>;

export function buildCardMenuCtx(args: {
  row: Row;
  zone: DeckZone;
  isSingleton: boolean;
  hasSideboard: boolean;
  onSetQty: DeckCardActionCtx['onSetQty'];
  handlers: CardMenuHandlers;
}): DeckCardActionCtx {
  const { row, zone, isSingleton, hasSideboard, onSetQty, handlers: h } = args;
  return {
    row,
    isSingleton,
    moveZone: zone === 'cards' ? (hasSideboard ? 'sideboard' : undefined) : 'mainboard',
    onEditCard: h.onEditCard,
    onSetQty,
    // Out-zone rows get their own remover and their own way back. Both were
    // `undefined` for anything but `cards` while the out-zone was list-only and
    // took these as CategorySection props; the stacks lens reaches them through
    // this menu instead, and a pile you cannot empty is a dead end.
    onRemoveCard:
      zone === 'cards'
        ? h.onRemoveCard
        : zone === 'sideboard'
          ? h.onRemoveSideboardCard
          : h.onRemoveConsideringCard,
    onMoveToZone:
      zone === 'cards'
        ? hasSideboard
          ? h.onMoveToSideboard
          : undefined
        : zone === 'sideboard'
          ? h.onMoveToMainboard
          : h.onMoveFromConsidering,
    onMoveToConsidering: zone === 'cards' ? h.onMoveToConsidering : undefined,
    onUseOwnCopy: h.onUseOwnCopy,
    onMoveToAnotherDeck: h.onMoveToAnotherDeck,
    onReleaseCopy: h.onReleaseCopy,
    onMakeCommander: h.onMakeCommander,
    canMakeCommander: h.canMakeCommander,
    onMakePartner: h.onMakePartner,
    canMakePartner: h.canMakePartner,
    onChangeCommander: zone === 'cards' ? h.onChangeCommander : undefined,
    cover: zone === 'cards' ? h.cover : undefined,
    onSetRowTags: h.onSetCardTags
      ? (slotIds, tags) => h.onSetCardTags!(zone, slotIds, tags)
      : undefined,
  };
}

/** The selection's moves and Remove: the bulk bar's buttons and the menu a
 *  right-click on a selected card opens, from one list (T162). */
export function buildBulkActions(args: {
  selection: DeckSelection | null;
  hasSideboard: boolean;
  onBulkMove: DeckDisplayProps['onBulkMove'];
  onBulkRemove: DeckDisplayProps['onBulkRemove'];
  setSelection: (next: DeckSelection | null) => void;
  setConfirmBulkRemove: (next: boolean) => void;
}): DeckBulkAction[] {
  const { selection, hasSideboard, onBulkMove, onBulkRemove, setSelection, setConfirmBulkRemove } =
    args;
  return selection
    ? [
        ...(onBulkMove && selection.zone === 'cards' && hasSideboard
          ? [
              {
                key: 'sideboard',
                label: 'Move to sideboard',
                run: () => {
                  onBulkMove([...selection.keys], 'cards', 'sideboard');
                  setSelection(null);
                },
              },
            ]
          : []),
        ...(onBulkMove && selection.zone === 'cards'
          ? [
              {
                key: 'considering',
                label: 'Move to considering',
                run: () => {
                  onBulkMove([...selection.keys], 'cards', 'considering');
                  setSelection(null);
                },
              },
            ]
          : []),
        ...(onBulkMove && selection.zone !== 'cards'
          ? [
              {
                key: 'mainboard',
                label: 'Move to mainboard',
                run: () => {
                  onBulkMove([...selection.keys], selection.zone, 'cards');
                  setSelection(null);
                },
              },
            ]
          : []),
        ...(onBulkRemove
          ? [
              {
                key: 'remove',
                label: 'Remove',
                danger: true,
                run: () => setConfirmBulkRemove(true),
              },
            ]
          : []),
      ]
    : [];
}

/** The card preview's Edit and Remove buttons for one flat-index row. */
export function buildPreviewActions(args: {
  row: Row | undefined;
  onEditCard: DeckDisplayProps['onEditCard'];
  onRemoveCard: DeckDisplayProps['onRemoveCard'];
  closePreview: () => void;
}): CardPreviewAction[] {
  const { row: r, onEditCard, onRemoveCard, closePreview } = args;
  if (!r) return [];
  const acts: CardPreviewAction[] = [];
  const slotId = r.slotIds[0];
  if (onEditCard && slotId) {
    acts.push({
      key: 'edit',
      label: 'Edit',
      icon: <Pencil width={18} height={18} strokeWidth={2} aria-hidden />,
      onClick: () => {
        closePreview();
        onEditCard(slotId, r.card);
      },
    });
  }
  if (onRemoveCard && r.slotIds.length > 0) {
    acts.push({
      key: 'delete',
      label: 'Remove from deck',
      danger: true,
      overflow: true,
      icon: <Trash2 width={18} height={18} strokeWidth={2} aria-hidden />,
      onClick: () => {
        closePreview();
        onRemoveCard(r.slotIds[r.slotIds.length - 1]);
      },
    });
  }
  return acts;
}
