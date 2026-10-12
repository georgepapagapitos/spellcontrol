import { useCallback, useMemo, useState } from 'react';
import type { EnrichedCard } from '@/types/index';
import type { OverflowMenuItem } from '@/components/overlays/OverflowMenu';
import { useConfirm } from '@/components/overlays/use-confirm';
import { type PrintingSelection } from '@/lib/collection/edit-card';
import { removeCopiesOfPrinting, printingFinishKey } from '@/lib/collection/collection-mutations';
import { applyPrices } from '@/lib/collection/card-prices';
import { useToastsStore } from '@/store/toasts';
import { useCollectionStore } from '@/store/collection';
import type { AllocationInfo } from '@/lib/collection/allocations';
import {
  buildEditedCards,
  isNoOpCardEdit,
  stackCopies,
  stackDetailMix,
} from '@/lib/collection/edit-card';
import type { Row } from './card-list-table-config';

// Everything the collection table does TO cards (E549): the edit dialog's
// target and confirm, single-row and bulk removal, the bulk proxy toggle and
// the bulk action list. Every write goes through replaceAllCards with an Undo
// toast that restores the prior list.

interface Args {
  cards: EnrichedCard[];
  allCards: EnrichedCard[];
  allocations: Map<string, AllocationInfo>;
  groupPrintings: boolean;
  selectedRowKeys: Set<string>;
  clearSelection: () => void;
}

export function useCollectionRowActions({
  cards,
  allCards,
  allocations,
  groupPrintings,
  selectedRowKeys,
  clearSelection,
}: Args) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const replaceAllCards = useCollectionStore((s) => s.replaceAllCards);
  const pushToast = useToastsStore((s) => s.push);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<EnrichedCard | null>(null);
  // True when the edit targets a single physical copy rather than the whole
  // printing stack: always so in ungrouped view, and when "Change one copy's
  // printing" is picked from a grouped 2+ stack (splitting one copy off).
  const [editingSingle, setEditingSingle] = useState(false);
  const openEdit = (card: EnrichedCard, single: boolean) => {
    setEditingCard(card);
    setEditingSingle(single);
  };
  const editingQty = useMemo(() => {
    if (!editingCard) return 0;
    return cards.filter(
      (c) => c.scryfallId === editingCard.scryfallId && c.foil === editingCard.foil
    ).length;
  }, [editingCard, cards]);
  // Only meaningful for a grouped (stacked) edit — a single-copy edit is
  // trivially uniform. Mirrors the exact scryfallId+finish match
  // buildEditedCards edits by, so "mixed" here means buildEditedCards would
  // otherwise touch more than one distinct condition/language.
  const editingMixedDetails = useMemo(() => {
    if (!editingCard || editingSingle) return undefined;
    return stackDetailMix(stackCopies(allCards, editingCard));
  }, [editingCard, editingSingle, allCards]);

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingCard) return;
    // Single-copy edit re-points just this one copy, leaving siblings on the old
    // printing — that's how a stack of identical printings gets split.
    const copyId = editingSingle ? editingCard.copyId : undefined;
    if (isNoOpCardEdit(editingCard, selection, editingQty, copyId)) {
      setEditingCard(null);
      return;
    }
    const prevCards = allCards;
    const cardName = editingCard.name;
    replaceAllCards(buildEditedCards(editingCard, selection, allCards, copyId));
    pushToast({
      message: `Updated ${cardName}.`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => replaceAllCards(prevCards),
    });
    setEditingCard(null);
  };

  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);
  // For stacked rows (qty > 1, grouped view), the user picks how many to drop.
  const [deletingRow, setDeletingRow] = useState<{
    card: EnrichedCard;
    key: string;
    total: number;
  } | null>(null);

  // Restore by appending the exact removed copies (copyIds preserved) to the
  // current collection — replaceAllCards re-runs remapAllocations so any deck
  // that lost a binding rebinds.
  const applyRemoval = useCallback(
    (removed: EnrichedCard[]) => {
      if (removed.length === 0) return;
      const removedIds = new Set(removed.map((c) => c.copyId));
      replaceAllCards(allCards.filter((c) => !removedIds.has(c.copyId)));
      // Naming a card only reads correctly when they are all the same card —
      // the per-row and RemoveCopiesDialog paths. A bulk selection spans many
      // printings, and "Removed 500 copies of Finch Formation" is simply wrong.
      const names = new Set(removed.map((c) => c.name));
      const what =
        names.size === 1
          ? `${removed.length} ${removed.length === 1 ? 'copy' : 'copies'} of ${removed[0].name}`
          : `${removed.length} cards`;
      pushToast({
        message: `Removed ${what}`,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: () => replaceAllCards([...useCollectionStore.getState().cards, ...removed]),
      });
    },
    [allCards, replaceAllCards, pushToast]
  );

  const handleDeleteRow = useCallback(
    (row: Row) => {
      // Ungrouped view: a row is one physical copy — remove exactly it.
      if (!groupPrintings) {
        applyRemoval([row.card]);
        return;
      }
      const key = printingFinishKey(row.card);
      const total = allCards.filter((c) => printingFinishKey(c) === key).length;
      if (total <= 1) {
        applyRemoval(removeCopiesOfPrinting(allCards, key, 1, allocatedCopyIds).removed);
        return;
      }
      setDeletingRow({ card: row.card, key, total });
    },
    [groupPrintings, allCards, allocatedCopyIds, applyRemoval]
  );

  const confirmDeleteCount = useCallback(
    (count: number) => {
      if (!deletingRow) return;
      const { removed } = removeCopiesOfPrinting(
        allCards,
        deletingRow.key,
        count,
        allocatedCopyIds
      );
      applyRemoval(removed);
      setDeletingRow(null);
    },
    [deletingRow, allCards, allocatedCopyIds, applyRemoval]
  );

  // Expand the row-keyed selection into concrete physical copyIds. When
  // grouping is on, each key is a printing+finish key that fans out to every
  // matching copy in the full collection (same idiom handleDeleteRow uses);
  // when grouping is off the key already IS a copyId. Deduped.
  const selectedCopyIds = useCallback((): string[] => {
    const ids = new Set<string>();
    for (const key of selectedRowKeys) {
      if (groupPrintings) {
        for (const c of allCards) {
          if (printingFinishKey(c) === key) ids.add(c.copyId);
        }
      } else {
        ids.add(key);
      }
    }
    return [...ids];
  }, [selectedRowKeys, groupPrintings, allCards]);

  const handleBulkDelete = useCallback(async () => {
    const ids = selectedCopyIds();
    const idSet = new Set(ids);
    const removable = allCards.filter(
      (c) => idSet.has(c.copyId) && !allocatedCopyIds.has(c.copyId)
    );
    const skipped = ids.length - removable.length;
    const ok = await confirm({
      title: `Delete ${removable.length} selected ${removable.length === 1 ? 'copy' : 'copies'}?`,
      body:
        skipped > 0
          ? `${skipped} ${skipped === 1 ? 'copy' : 'copies'} reserved by a deck stay. You can undo from the toast.`
          : `Removes the selected copies from your collection. You can undo from the toast.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok || removable.length === 0) return;
    applyRemoval(removable);
    clearSelection();
  }, [selectedCopyIds, allCards, allocatedCopyIds, confirm, applyRemoval, clearSelection]);

  // Smart toggle (mirrors the "Select all"/"Deselect all" pill above): marks
  // every selected copy as proxy, unless they're ALL already proxy, in which
  // case it unmarks. Non-destructive and instantly reversible (Undo toast),
  // so this skips the blocking confirm() that guards handleBulkDelete — that
  // bar is for data loss, not a flag flip. applyPrices re-runs inline so the
  // collection total reflects the price zeroing immediately, the same
  // chokepoint refreshPrices/reapplyCardPrices use (lib/collection/card-prices.ts).
  const bulkProxyAllMarked = useMemo(() => {
    if (selectedRowKeys.size === 0) return false;
    const ids = new Set(selectedCopyIds());
    const targets = allCards.filter((c) => ids.has(c.copyId));
    return targets.length > 0 && targets.every((c) => c.proxy);
  }, [selectedRowKeys, selectedCopyIds, allCards]);

  const handleBulkToggleProxy = useCallback(() => {
    const ids = selectedCopyIds();
    const idSet = new Set(ids);
    const targets = allCards.filter((c) => idSet.has(c.copyId));
    if (targets.length === 0) return;
    const nextProxy = !bulkProxyAllMarked;
    const prevCards = allCards;
    const next = applyPrices(
      allCards.map((c) =>
        idSet.has(c.copyId) ? { ...c, proxy: nextProxy, updatedAt: Date.now() } : c
      )
    );
    replaceAllCards(next);
    pushToast({
      message: `${nextProxy ? 'Marked' : 'Unmarked'} ${targets.length} ${
        targets.length === 1 ? 'copy' : 'copies'
      } as proxy.`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => replaceAllCards(applyPrices(prevCards)),
    });
  }, [selectedCopyIds, allCards, bulkProxyAllMarked, replaceAllCards, pushToast]);

  // The selection's actions: the bulk toolbar's buttons and the menu a
  // right-click on a selected card opens, from one list (T162).
  const bulkActions: OverflowMenuItem[] = [
    { label: 'Move to…', onClick: () => setBulkMoveOpen(true) },
    {
      label: bulkProxyAllMarked ? 'Unmark proxy' : 'Mark as proxy',
      onClick: handleBulkToggleProxy,
    },
    { label: 'Delete selected', danger: true, onClick: handleBulkDelete },
  ];

  return {
    editingCard,
    editingSingle,
    editingQty,
    editingMixedDetails,
    openEdit,
    closeEdit: () => setEditingCard(null),
    handleEditConfirm,
    deletingRow,
    closeDeleting: () => setDeletingRow(null),
    handleDeleteRow,
    confirmDeleteCount,
    selectedCopyIds,
    bulkActions,
    bulkMoveOpen,
    closeBulkMove: () => setBulkMoveOpen(false),
    confirmDialog,
  };
}

/** "Save to list" for the current filter result: one entry per printing+finish. */
export function useSaveToList(filtered: Row[]) {
  const lists = useCollectionStore((s) => s.lists);
  const createList = useCollectionStore((s) => s.createList);
  const addListEntries = useCollectionStore((s) => s.addListEntries);
  const pushToast = useToastsStore((s) => s.push);
  const [saveToListOpen, setSaveToListOpen] = useState(false);

  // Aggregate the current filter result into one entry per printing+finish
  // (summing copies), independent of the group-printings toggle — that's the
  // set "Save to list" captures.
  const saveToListCards = useMemo(() => {
    const byKey = new Map<string, { card: EnrichedCard; quantity: number }>();
    for (const r of filtered) {
      const key = printingFinishKey(r.card);
      const existing = byKey.get(key);
      if (existing) existing.quantity += r.qty;
      else byKey.set(key, { card: r.card, quantity: r.qty });
    }
    return [...byKey.values()];
  }, [filtered]);

  const handleSaveToList = useCallback(
    async (target: { listId: string } | { newName: string }) => {
      const listId = 'listId' in target ? target.listId : createList(target.newName);
      const { added, skipped } = await addListEntries(listId, saveToListCards);
      setSaveToListOpen(false);
      const name = useCollectionStore.getState().lists.find((l) => l.id === listId)?.name ?? 'list';
      pushToast({
        message:
          added > 0
            ? `Added ${added} ${added === 1 ? 'card' : 'cards'} to “${name}”${
                skipped > 0 ? ` · ${skipped} already there` : ''
              }`
            : `Already in “${name}”, nothing to add`,
        tone: added > 0 ? 'success' : 'info',
      });
    },
    [createList, addListEntries, saveToListCards, pushToast]
  );

  return { lists, saveToListOpen, setSaveToListOpen, saveToListCards, handleSaveToList };
}
