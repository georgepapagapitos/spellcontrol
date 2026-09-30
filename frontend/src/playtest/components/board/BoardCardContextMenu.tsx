import type { PlaytestAction, PlaytestState, Zone } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { haptics } from '@/lib/util/haptics';
import type { ShortcutId } from '../../lib/shortcuts';
import type { OnlineTable } from '../../hooks/use-online-table';
import { printedBase } from '../../lib/power-toughness';
import { CardContextMenu } from '../CardContextMenu';
import type { MadeToken } from '../menu-entries';
import type { ContextState } from '../../lib/board-support';

interface BoardCardContextMenuProps {
  /** Which permanent's menu is open, and where. */
  ctx: NonNullable<ContextState>;
  battlefield: PlaytestState['battlefield'];
  libraryCount: number;
  cardLookup: Map<string, ScryfallCard> | undefined;
  selected: ReadonlySet<string>;
  onlineTable: OnlineTable | null;
  dispatch: (action: PlaytestAction) => void;
  keyFor: (id: ShortcutId) => string | undefined;
  tokensMadeBy: (name: string) => MadeToken[];
  createToken: (token: MadeToken & { imageUrl?: string }) => void;
  tapSelection: () => void;
  moveSelection: (to: Zone, toIndex?: number) => void;
  cloneCards: (sourceIds: readonly string[]) => unknown;
  beginArrow: (cardIds: ReadonlySet<string>) => unknown;
  copyOntoStack: (cardIds: readonly string[]) => unknown;
  putOnStack: (cardIds: readonly string[]) => unknown;
  adjustAllCounters: (
    cardIds: readonly string[],
    op: 'inc' | 'dec' | 'double' | 'clear'
  ) => unknown;
  onPreview: (cardId: string) => void;
  onOpenCustomCounters: (cardId: string) => void;
  onClose: () => void;
}

/** The right-click / long-press menu on a permanent, wired to the board's
 *  actions. Every action reads the selection the same way the copy does. */
export function BoardCardContextMenu({
  ctx,
  battlefield,
  libraryCount,
  cardLookup,
  selected,
  onlineTable,
  dispatch,
  keyFor,
  tokensMadeBy,
  createToken,
  tapSelection,
  moveSelection,
  cloneCards,
  beginArrow,
  copyOntoStack,
  putOnStack,
  adjustAllCounters,
  onPreview,
  onOpenCustomCounters,
  onClose,
}: BoardCardContextMenuProps) {
  const ctxCard = ctx ? battlefield.find((b) => b.card.id === ctx.cardId) : null;
  // The printed body as numbers, for "Set power / toughness". A `*` has no
  // number to set from, so that card gets no such row.
  const ctxPower = ctxCard ? printedBase(ctxCard.card.power) : null;
  const ctxToughness = ctxCard ? printedBase(ctxCard.card.toughness) : null;
  // Candidate hosts exclude the card itself and its current host (re-attaching
  // to where it already is would be a no-op menu entry).
  const attachTargets = ctxCard
    ? battlefield
        .filter((b) => b.card.id !== ctxCard.card.id && b.card.id !== ctxCard.attachedTo)
        .map((b) => ({ id: b.card.id, name: b.card.name }))
    : [];
  const attachedHostName = ctxCard?.attachedTo
    ? battlefield.find((b) => b.card.id === ctxCard.attachedTo)?.card.name
    : undefined;

  if (!ctxCard) return null;
  return (
    <CardContextMenu
      x={ctx.x}
      y={ctx.y}
      libraryCount={libraryCount}
      cardName={ctxCard.card.name}
      stickers={ctxCard.stickers}
      counters={ctxCard.counters}
      // Every other permanent is a candidate host; the reducer additionally
      // rejects anything that would close an attachment cycle.
      attachTargets={attachTargets}
      attachedToName={attachedHostName}
      onAttach={(targetId) => {
        dispatch({ type: 'ATTACH', cardId: ctx.cardId, targetId });
        onClose();
      }}
      printedPt={
        ctxPower !== null && ctxToughness !== null
          ? { power: ctxPower, toughness: ctxToughness }
          : undefined
      }
      onPreview={
        cardLookup?.has(ctxCard.card.id)
          ? () => {
              onPreview(ctxCard.card.id);
              onClose();
            }
          : undefined
      }
      canTransform={Boolean(ctxCard.card.backImageUrl)}
      tapped={ctxCard.tapped}
      faceDown={ctxCard.faceDown}
      phased={ctxCard.phased ?? false}
      keyFor={keyFor}
      onClose={onClose}
      // Every action here reads the selection the same way the copy does:
      // open the menu on a card that is part of it and the menu is the
      // selection's menu, which is what the "N cards selected" heading
      // says. Open it on a card outside the selection and it is that
      // card's menu alone.
      onTap={() => {
        if (selected.has(ctx.cardId) && selected.size > 1) tapSelection();
        else dispatch({ type: 'TAP', cardId: ctx.cardId });
        onClose();
      }}
      onFlip={() => {
        dispatch({ type: 'FLIP_FACE', cardId: ctx.cardId });
        onClose();
      }}
      onTransform={() => {
        dispatch({ type: 'TRANSFORM', cardId: ctx.cardId });
        onClose();
      }}
      onTogglePhased={() => {
        haptics.tap();
        dispatch({ type: 'TOGGLE_PHASED', cardId: ctx.cardId });
        onClose();
      }}
      // Acting on a card that's part of the live selection copies the
      // whole selection — otherwise just the card you opened the menu on.
      selectionSize={selected.has(ctx.cardId) ? selected.size : 1}
      tokens={tokensMadeBy(ctxCard.card.name)}
      onCreateToken={createToken}
      onDuplicate={() => {
        cloneCards(selected.has(ctx.cardId) ? [...selected] : [ctx.cardId]);
        onClose();
      }}
      pt={ctxCard.pt}
      onAdjustPT={(power, toughness) =>
        dispatch({ type: 'ADJUST_PT', cardId: ctx.cardId, power, toughness })
      }
      onDrawArrow={
        onlineTable
          ? () => {
              beginArrow(new Set([ctx.cardId]));
              onClose();
            }
          : undefined
      }
      onPutOnStack={(copy) => {
        const ids = selected.has(ctx.cardId) ? [...selected] : [ctx.cardId];
        if (copy) copyOntoStack(ids);
        else putOnStack(ids);
        onClose();
      }}
      onAddCounter={(k) =>
        dispatch({ type: 'SET_COUNTER', cardId: ctx.cardId, counter: k, delta: 1 })
      }
      onAdjustAllCounters={(op) => adjustAllCounters([ctx.cardId], op)}
      onOpenCustomCounters={() => {
        onOpenCustomCounters(ctx.cardId);
        onClose();
      }}
      onAddSticker={(text) => dispatch({ type: 'ADD_STICKER', cardId: ctx.cardId, text })}
      onRemoveSticker={(index) => dispatch({ type: 'REMOVE_STICKER', cardId: ctx.cardId, index })}
      onMoveTo={(zone, toIndex) => {
        if (selected.has(ctx.cardId) && selected.size > 1) moveSelection(zone, toIndex);
        else dispatch({ type: 'MOVE_TO_ZONE', cardId: ctx.cardId, to: zone, toIndex });
        onClose();
      }}
    />
  );
}
