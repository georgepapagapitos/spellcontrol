import { useDecksStore, type Deck, type DeckZone } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import {
  buildAllocationMap,
  pickCollectionCopy,
  makeDeckAllocationInfo,
} from '@/lib/collection/allocations';
import { planQtyChange } from '@/lib/deck/deck-qty';
import { getMaxCopies } from '@/lib/deck/deck-validation';
import { useToastsStore } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckFormatConfig } from '@/deck-builder/types';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { Dispatch, SetStateAction } from 'react';

export function useDeckZoneEdits({
  deck,
  formatConfig,
  collectionCards,
  setEditingSlot,
}: {
  deck: Deck;
  formatConfig: DeckFormatConfig | null;
  collectionCards: EnrichedCard[];
  setEditingSlot: Dispatch<SetStateAction<{ slotId: string; card: ScryfallCard } | null>>;
}) {
  const removeCard = useDecksStore((s) => s.removeCard);
  const removeSideboardCard = useDecksStore((s) => s.removeSideboardCard);
  const removeConsideringCard = useDecksStore((s) => s.removeConsideringCard);
  const setCardTags = useDecksStore((s) => s.setCardTags);
  const bulkEditTag = useDecksStore((s) => s.bulkEditTag);
  const renameDeckTag = useDecksStore((s) => s.renameDeckTag);
  const removeDeckTag = useDecksStore((s) => s.removeDeckTag);
  const bulkAddCards = useDecksStore((s) => s.bulkAddCards);
  const bulkRemoveCards = useDecksStore((s) => s.bulkRemoveCards);
  const bulkMoveZone = useDecksStore((s) => s.bulkMoveZone);
  const setCardSortIndex = useDecksStore((s) => s.setCardSortIndex);
  const pushToast = useToastsStore((s) => s.push);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);

  // Capture the slot before removing so Undo can re-add the same card with
  // the same allocated printing. (`addCard` mints a fresh slotId, but the
  // collection allocation is what actually matters to the user.)
  const handleRemoveCard = (slotId: string) => {
    const slot = deck.cards.find((c) => c.slotId === slotId);
    if (!slot) return;
    recordEdit(deck.id, `remove ${slot.card.name}`, () => removeCard(deck.id, slotId));
    pushToast({
      message: `Removed ${slot.card.name}`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  const handleRemoveSideboardCard = (slotId: string) => {
    const slot = deck.sideboard.find((c) => c.slotId === slotId);
    if (!slot) return;
    recordEdit(deck.id, `remove ${slot.card.name} from sideboard`, () =>
      removeSideboardCard(deck.id, slotId)
    );
    pushToast({
      message: `Removed ${slot.card.name} from sideboard`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  // Both zone moves take the row's slot ids — one copy, or its whole stack —
  // and commit as ONE bulkMoveZone write (E180) regardless of how many slots
  // move, inside a single recordEdit so "move all 4" is one undo entry too.
  const handleMoveToSideboard = (slotIds: string[]) => {
    const name = deck.cards.find((c) => c.slotId === slotIds[0])?.card.name ?? 'card';
    const label =
      slotIds.length === 1
        ? `move ${name} to sideboard`
        : `move ${slotIds.length} × ${name} to sideboard`;
    recordEdit(deck.id, label, () => bulkMoveZone(deck.id, slotIds, 'cards', 'sideboard'));
  };

  const handleMoveToMainboard = (slotIds: string[]) => {
    const name = deck.sideboard.find((c) => c.slotId === slotIds[0])?.card.name ?? 'card';
    const label =
      slotIds.length === 1
        ? `move ${name} to mainboard`
        : `move ${slotIds.length} × ${name} to mainboard`;
    recordEdit(deck.id, label, () => bulkMoveZone(deck.id, slotIds, 'sideboard', 'cards'));
  };

  // Considering (E122) — mirrors the sideboard zone-move pair above exactly:
  // one recordEdit per bulk move (so "move all 4" is one undo entry), no toast
  // (the undo/redo toolbar covers it, same as the sideboard moves).
  const handleRemoveConsideringCard = (slotId: string) => {
    const slot = deck.considering.find((c) => c.slotId === slotId);
    if (!slot) return;
    recordEdit(deck.id, `remove ${slot.card.name} from considering`, () =>
      removeConsideringCard(deck.id, slotId)
    );
    pushToast({
      message: `Removed ${slot.card.name} from considering`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  const handleMoveToConsidering = (slotIds: string[]) => {
    const name = deck.cards.find((c) => c.slotId === slotIds[0])?.card.name ?? 'card';
    const label =
      slotIds.length === 1
        ? `move ${name} to considering`
        : `move ${slotIds.length} × ${name} to considering`;
    recordEdit(deck.id, label, () => bulkMoveZone(deck.id, slotIds, 'cards', 'considering'));
  };

  const handleMoveFromConsidering = (slotIds: string[]) => {
    const name = deck.considering.find((c) => c.slotId === slotIds[0])?.card.name ?? 'card';
    const label =
      slotIds.length === 1
        ? `move ${name} to mainboard`
        : `move ${slotIds.length} × ${name} to mainboard`;
    recordEdit(deck.id, label, () => bulkMoveZone(deck.id, slotIds, 'considering', 'cards'));
  };

  // ── Multi-select bulk operations (E172) ────────────────────────────────
  // Each wraps ONE store write (bulkRemoveCards/bulkMoveZone/bulkEditTag are
  // single-`set()` primitives regardless of how many slots they touch) in
  // ONE recordEdit, so "remove/move/tag 12 selected rows" is one undo entry
  // AND one sync push — the crux constraint this whole slice exists for.
  const handleBulkRemove = (zone: DeckZone, slotIds: string[]) => {
    if (!deck || slotIds.length === 0) return;
    const zoneList = deck[zone] ?? [];
    const name = zoneList.find((c) => slotIds.includes(c.slotId))?.card.name ?? 'card';
    const label = slotIds.length === 1 ? `remove ${name}` : `remove ${slotIds.length} cards`;
    recordEdit(deck.id, label, () => bulkRemoveCards(deck.id, zone, slotIds));
    pushToast({
      message: slotIds.length === 1 ? `Removed ${name}` : `Removed ${slotIds.length} cards`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  const ZONE_LABEL: Record<DeckZone, string> = {
    cards: 'mainboard',
    sideboard: 'sideboard',
    considering: 'considering',
    extras: 'in the box',
  };

  const handleBulkMove = (slotIds: string[], from: DeckZone, to: DeckZone) => {
    if (!deck || slotIds.length === 0) return;
    const label = `move ${slotIds.length} ${slotIds.length === 1 ? 'card' : 'cards'} to ${ZONE_LABEL[to]}`;
    recordEdit(deck.id, label, () => bulkMoveZone(deck.id, slotIds, from, to));
  };

  const handleBulkEditTag = (zone: DeckZone, slotIds: string[], tag: string, add: boolean) => {
    if (!deck || slotIds.length === 0) return;
    const label = add
      ? `tag ${slotIds.length} cards "${tag}"`
      : `untag "${tag}" from ${slotIds.length} cards`;
    recordEdit(deck.id, label, () => bulkEditTag(deck.id, zone, slotIds, tag, add));
  };

  // Manual drag reorder (E172) — DeckDisplay computes the fractional
  // sortIndex itself (pure, no store access needed); this just wraps the
  // single-write commit in an undo entry, consistent with every other edit.
  const handleReorder = (zone: DeckZone, slotIds: string[], sortIndex: number) => {
    if (!deck || slotIds.length === 0) return;
    recordEdit(deck.id, 'reorder', () => setCardSortIndex(deck.id, zone, slotIds, sortIndex));
  };

  // Qty handler for both the click-to-type-exact-number path (absolute
  // target) and the +/− stepper (relative delta) — one function so both
  // routes share the same allocation logic and the same maxCopies ceiling
  // by construction (E168 slice 3). Zone-aware (E175): `zone` selects which
  // of the deck's three card arrays this edit targets — previously
  // hard-wired to `deck.cards`, which meant the mainboard stepper could
  // never be safely reused for sideboard/considering rows without risking a
  // silent cross-zone mutation. `planQtyChange` (lib/deck/deck-qty.ts) is the pure
  // diff; the add/remove itself is ONE store write via bulkAddCards/
  // bulkRemoveCards regardless of how many copies change (never loop
  // per-card store actions — each would fire its own sync push). Bulk
  // removes show ONE toast for the whole batch with an Undo that restores
  // every original allocation — important for basics where the user might
  // drop 8 copies in a single edit.
  const handleSetQty = (
    zone: DeckZone,
    card: ScryfallCard,
    qty: number,
    opts?: { relative?: boolean }
  ) => {
    const current = (deck[zone] ?? []).filter((c) => c.card.name === card.name);
    // Considering is a staging area and In the box holds what the box came
    // with, not real deck zones: no copy-limit ceiling on either (mirrors why
    // they're excluded from legality elsewhere).
    const maxCopies =
      zone === 'considering' || zone === 'extras'
        ? undefined
        : getMaxCopies(card, !!formatConfig?.isSingleton);
    const plan = planQtyChange(current, qty, opts, maxCopies);
    if (plan.addCount === 0 && plan.remove.length === 0) return;

    const zoneSuffix = zone === 'cards' ? '' : ` to ${ZONE_LABEL[zone]}`;

    if (plan.addCount > 0) {
      // Quantity increments bind free owned copies; any beyond what's free are
      // added unbound (listed as "In [deck]"/"unowned"). Never pulls copies from
      // other decks — that's a conscious choice elsewhere. One in-deck undo entry.
      const label =
        plan.addCount === 1
          ? `add ${card.name}${zoneSuffix}`
          : `add ${plan.addCount} × ${card.name}${zoneSuffix}`;
      recordEdit(deck.id, label, () => {
        // Reuse the live allocations between iterations so two adds don't try to
        // claim the same collection copy — this is a local computation only,
        // not a store write; the write itself happens once, below.
        const allocations = buildAllocationMap(
          useDecksStore.getState().decks,
          useCubeStore.getState().saved
        );
        const entries: Array<{ card: ScryfallCard; allocatedCopyId: string | null }> = [];
        for (let i = 0; i < plan.addCount; i++) {
          const claim = pickCollectionCopy(card.name, collectionCards, allocations, card.id);
          const allocatedId = claim?.copyId ?? null;
          if (allocatedId) {
            allocations.set(
              allocatedId,
              makeDeckAllocationInfo(deck.id, deck.name, deck.color, card.name)
            );
          }
          entries.push({ card, allocatedCopyId: allocatedId });
        }
        bulkAddCards(deck.id, zone, entries);
      });
      return;
    }
    // A decrement drops |delta| slots as one undo entry. Unallocated copies
    // go first so an owned copy stays bound to the row as long as possible
    // (see pickSlotsToRelease) — only spills into allocated slots once
    // there's no unallocated stock left to shed.
    const dropping = plan.remove;
    const dropLabel =
      dropping.length === 1
        ? `remove ${card.name}${zoneSuffix}`
        : `remove ${dropping.length} × ${card.name}${zoneSuffix}`;
    recordEdit(deck.id, dropLabel, () => {
      bulkRemoveCards(
        deck.id,
        zone,
        dropping.map((s) => s.slotId)
      );
    });
    pushToast({
      message:
        dropping.length === 1
          ? `Removed ${card.name}${zoneSuffix}`
          : `Removed ${dropping.length} × ${card.name}${zoneSuffix}`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  const handleEditCard = (slotId: string, card: ScryfallCard) => {
    setEditingSlot({ slotId, card });
  };

  // ── User tags (E171) ──────────────────────────────────────────────────
  const handleSetCardTags = (zone: DeckZone, slotIds: string[], tags: string[]) => {
    if (!deck) return;
    recordEdit(deck.id, 'edit tags', () => setCardTags(deck.id, zone, slotIds, tags));
  };
  const handleRenameDeckTag = (from: string, to: string) => {
    if (!deck) return;
    recordEdit(deck.id, `rename tag "${from}"`, () => renameDeckTag(deck.id, from, to));
  };
  const handleRemoveDeckTag = (tag: string) => {
    if (!deck) return;
    recordEdit(deck.id, `remove tag "${tag}"`, () => removeDeckTag(deck.id, tag));
  };

  return {
    handleRemoveCard,
    handleRemoveSideboardCard,
    handleRemoveConsideringCard,
    handleMoveToSideboard,
    handleMoveToMainboard,
    handleMoveToConsidering,
    handleMoveFromConsidering,
    handleSetQty,
    handleEditCard,
    handleSetCardTags,
    handleRenameDeckTag,
    handleRemoveDeckTag,
    handleBulkRemove,
    handleBulkMove,
    handleBulkEditTag,
    handleReorder,
  };
}
