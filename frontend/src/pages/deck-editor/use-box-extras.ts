import { useState } from 'react';
import { fetchProduct } from '@/lib/api';
import { buildAllocationMap } from '@/lib/collection/allocations';
import { allocateBoxExtras } from '@/lib/import-export/build-deck-from-import';
import { productBoxExtras } from '@/lib/import-export/product-import';
import { userMessage } from '@/lib/util/user-error';
import { useCollectionStore } from '@/store/collection';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useDecksStore, type Deck } from '@/store/decks';
import { useToastsStore } from '@/store/toasts';

/**
 * The Edit menu's "Add the rest of the box" for a deck built from a product
 * before In the box existed: fetches the product and adds its physical extras
 * (display commanders and the like, not tokens) to In the box, each claiming
 * a free copy of its own printing and finish, as one undoable edit.
 *
 * Undefined, so the action is absent, unless the deck came from a product and
 * its In the box is still empty.
 */
export function useAddBoxExtras(deck: Deck): (() => void) | undefined {
  const bulkAddCards = useDecksStore((s) => s.bulkAddCards);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  const pushToast = useToastsStore((s) => s.push);
  const [busy, setBusy] = useState(false);

  const product = deck.sourceProduct;
  if (!product || (deck.extras?.length ?? 0) > 0) return undefined;

  const add = async () => {
    setBusy(true);
    try {
      const resp = await fetchProduct(product.fileName);
      const extras = productBoxExtras(resp.physicalCards);
      if (extras.length === 0) {
        pushToast({ message: `${product.name} has no other cards in the box.`, tone: 'info' });
        return;
      }
      // Fresh at call time: the fetch can outlast an import or another edit.
      const claim = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      const slots = allocateBoxExtras(extras, useCollectionStore.getState().cards, claim);
      recordEdit(deck.id, 'add the rest of the box', () =>
        bulkAddCards(
          deck.id,
          'extras',
          slots.map((s) => ({ card: s.card, allocatedCopyId: s.allocatedCopyId }))
        )
      );
      const unowned = slots.filter((s) => !s.allocatedCopyId).length;
      const added =
        slots.length === 1
          ? `Added ${slots[0].card.name} to the box.`
          : `Added ${slots.length} cards to the box.`;
      const note =
        unowned === 0
          ? ''
          : slots.length === 1
            ? ' It has no free copy in your collection.'
            : unowned === slots.length
              ? ' None of them have a free copy in your collection.'
              : ` ${unowned} of them have no free copy in your collection.`;
      pushToast({
        message: added + note,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: () => undoEdit(deck.id),
      });
    } catch (e) {
      pushToast({
        message: userMessage(e, "Couldn't load the box's contents. Try again."),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return () => {
    if (!busy) void add();
  };
}
