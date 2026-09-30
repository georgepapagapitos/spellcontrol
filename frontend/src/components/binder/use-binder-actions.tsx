import { ArrowDown, ArrowUp, Pencil, Share2, Trash2, type LucideIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useCollectionStore } from '@/store/collection';
import { toast } from '@/store/toasts';
import { diffMembershipByDefs } from '@/lib/binder/binder-moves';
import { useBinderLayoutInputs } from '@/lib/binder/use-binder-layout-inputs';
import type { BinderDef } from '@/types/index';

/** One row of a binder's menu, in the shape both OverflowMenu and PageHeader take. */
export interface BinderAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  opensDialog?: boolean;
  /** May stand as a button beside the ⋮ where a page header has room; the
   *  others (reordering, Delete) only ever live in the menu. */
  canStandAlone?: boolean;
}

/**
 * A binder's own actions, one list wherever the binder has a menu: its tile ⋮
 * on the index (and the right-click that opens the same menu) and the ⋮ on its
 * own page. They used to be three menus on two screens, with the editor
 * called "Binder rules" in one and "Edit binder" in the others, Share in only
 * one, and a tab-strip ⋯ that reordered without saying which cards moved.
 * "Binder rules" is the name UX-305 (#576) chose, because it says what the
 * dialog is for; the index and the tab strip had kept the old one.
 *
 * Moving a binder re-routes the whole waterfall below it, so every move toasts
 * how many cards changed binder, wherever it was made.
 */
export function useBinderActions(): {
  actionsFor: (
    def: BinderDef,
    opts: { onShare: () => void; canReorder?: boolean }
  ) => BinderAction[];
  moveBinder: (id: string, direction: 'up' | 'down') => void;
} {
  const binders = useCollectionStore((s) => s.binders);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const storeMove = useCollectionStore((s) => s.moveBinder);
  const { cards, allocatedCopyIds } = useBinderLayoutInputs();

  const moveBinder = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const oldDefs = useCollectionStore.getState().binders;
      storeMove(id, direction);
      const newDefs = useCollectionStore.getState().binders;
      const changed = diffMembershipByDefs(cards, oldDefs, newDefs, { allocatedCopyIds });
      toast.show({
        message:
          changed > 0
            ? `Reorder moved ${changed.toLocaleString()} card${changed === 1 ? '' : 's'} between binders`
            : "Reorder didn't move any cards",
        tone: 'info',
      });
    },
    [storeMove, cards, allocatedCopyIds]
  );

  const actionsFor = useCallback(
    (
      def: BinderDef,
      { onShare, canReorder = true }: { onShare: () => void; canReorder?: boolean }
    ) => {
      const ordered = [...binders].sort((a, b) => a.position - b.position);
      const idx = ordered.findIndex((b) => b.id === def.id);
      return [
        {
          label: 'Binder rules',
          icon: Pencil,
          opensDialog: true,
          canStandAlone: true,
          onClick: () => setEditingBinder(def.id),
        },
        { label: 'Share', icon: Share2, opensDialog: true, canStandAlone: true, onClick: onShare },
        ...(canReorder
          ? [
              {
                label: 'Move up',
                icon: ArrowUp,
                disabled: idx <= 0,
                onClick: () => moveBinder(def.id, 'up'),
              },
              {
                label: 'Move down',
                icon: ArrowDown,
                disabled: idx === -1 || idx >= ordered.length - 1,
                onClick: () => moveBinder(def.id, 'down'),
              },
            ]
          : []),
        // Undoable from the toast, so it doesn't confirm first (T157).
        { label: 'Delete binder', icon: Trash2, danger: true, onClick: () => deleteBinder(def.id) },
      ];
    },
    [binders, setEditingBinder, deleteBinder, moveBinder]
  );

  return { actionsFor, moveBinder };
}
