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
 * The Edit menu's "Add the rest of the box": fetches the product and adds the
 * physical extras (display commanders, a Secret Lair's bonus card, not tokens)
 * that In the box doesn't hold yet, each claiming a free copy of its own
 * printing and finish, as one undoable edit. It tops up rather than fills, so
 * a deck built before a bonus card was known still gets it.
 *
 * Undefined, so the action is absent, unless the deck came from a product.
 */
export function useAddBoxExtras(deck: Deck): (() => void) | undefined {
  const bulkAddCards = useDecksStore((s) => s.bulkAddCards);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  const pushToast = useToastsStore((s) => s.push);
  const [busy, setBusy] = useState(false);

  const product = deck.sourceProduct;
  if (!product) return undefined;

  const add = async () => {
    setBusy(true);
    try {
      const resp = await fetchProduct(product.fileName);
      const all = productBoxExtras(resp.physicalCards);
      if (all.length === 0) {
        pushToast({ message: `${product.name} has no other cards in the box.`, tone: 'info' });
        return;
      }
      const extras = missingFromBox(all, deck.extras ?? []);
      if (extras.length === 0) {
        pushToast({
          message: `The box already holds everything from ${product.name}.`,
          tone: 'info',
        });
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

/** The product's extras minus what the box already holds, matched by printing
 *  and counted, so a box with one of two display copies gets the other. */
function missingFromBox<T extends { card: { id: string } }>(
  extras: T[],
  box: ReadonlyArray<{ card: { id: string } }>
): T[] {
  const held = new Map<string, number>();
  for (const slot of box) held.set(slot.card.id, (held.get(slot.card.id) ?? 0) + 1);
  return extras.filter((e) => {
    const n = held.get(e.card.id) ?? 0;
    if (n > 0) held.set(e.card.id, n - 1);
    return n === 0;
  });
}
