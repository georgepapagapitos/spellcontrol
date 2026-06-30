import { ChevronDown, ChevronUp, Download, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import type { MaterializedBinder } from '../types';
import { BinderExportDialog } from './BinderExportDialog';
import { useConfirm } from '../lib/use-confirm';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';

interface Props {
  binders: MaterializedBinder[];
}

export function BinderTabs({ binders }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const navigate = useNavigate();
  const moveBinder = useCollectionStore((s) => s.moveBinder);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const deleteAllBinders = useCollectionStore((s) => s.deleteAllBinders);
  const [exportOpen, setExportOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: `Its cards will be re-routed through your other binders. Anything that doesn't match a remaining binder will only show up in the Collection view.`,
      confirmLabel: 'Delete binder',
      danger: true,
    });
    if (ok) deleteBinder(id);
  };

  const handleDeleteAll = async () => {
    const ok = await confirm({
      title: `Delete all ${binders.length} binders?`,
      body: `Every binder definition will be removed. Your cards stay where they are — they'll fall back to the Uncategorized view until you build new binders. This can't be undone.`,
      confirmLabel: 'Delete all binders',
      danger: true,
    });
    if (ok) deleteAllBinders();
  };

  // Sort by position so reorder arrows produce a consistent display
  const sorted = [...binders].sort((a, b) => a.def.position - b.def.position);

  return (
    <div className="tab-row binder-tab-row">
      {sorted.map((b, idx) => {
        const isActive = activeTab === b.def.id;
        return (
          <div key={b.def.id} className={`binder-tab-group ${isActive ? 'active' : ''}`}>
            <button
              className={`tab ${isActive ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(b.def.id);
                navigate(`/collection/binders/${b.def.id}`);
              }}
              style={
                isActive
                  ? {
                      background: b.def.color,
                      borderColor: b.def.color,
                      // Mobile underline-tab style picks this up via CSS var.
                      ['--binder-color' as string]: b.def.color,
                    }
                  : {
                      borderLeftColor: b.def.color,
                      borderLeftWidth: 3,
                      ['--binder-color' as string]: b.def.color,
                    }
              }
            >
              <span className="tab-color-dot" aria-hidden style={{ background: b.def.color }} />
              <span className="tab-label">{b.def.name}</span>
              {b.def.mode === 'manual' && (
                <span className="tab-mode-badge" aria-label="Manual mode">
                  Manual
                </span>
              )}
              <span className="tab-count">{b.totalCards.toLocaleString()}</span>
            </button>

            {isActive && (
              <BinderOverflowMenu
                color={b.def.color}
                canMoveUp={idx > 0}
                canMoveDown={idx < sorted.length - 1}
                onMoveUp={() => moveBinder(b.def.id, 'up')}
                onMoveDown={() => moveBinder(b.def.id, 'down')}
                onEdit={() => setEditingBinder(b.def.id)}
                onDelete={() => handleDelete(b.def.id, b.def.name)}
              />
            )}
          </div>
        );
      })}

      <button
        className="tab tab-new"
        onClick={() => setEditingBinder('new')}
        title="Create a new binder"
      >
        + New binder
      </button>

      <button
        type="button"
        className="tab tab-export"
        onClick={() => setExportOpen(true)}
        disabled={binders.length === 0}
        title="Export this binder, all binders, or the full collection"
      >
        <Download width={14} height={14} strokeWidth={1.6} aria-hidden />
        <span>Export</span>
      </button>

      {binders.length > 1 && (
        <button
          type="button"
          className="tab tab-delete-all"
          onClick={handleDeleteAll}
          title="Delete every binder (cards are unaffected — they fall back to Uncategorized)"
        >
          <Trash2 width={14} height={14} strokeWidth={1.6} aria-hidden />
          <span>Delete all</span>
        </button>
      )}

      {exportOpen && (
        <BinderExportDialog
          binders={binders}
          activeId={activeTab}
          onClose={() => setExportOpen(false)}
        />
      )}

      {confirmDialog}
    </div>
  );
}

type PanelPos = { top: number; right: number };

function BinderOverflowMenu({
  color,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  color: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // When the sheet is open on mobile it should claim the screen — locking
  // body scroll prevents the page underneath from scrolling on a swipe.
  useLockBodyScroll(open);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      // Capture the button's viewport position before the state update so the
      // portaled panel opens right-aligned below the ⋮ button, independent of
      // whatever overflow/container-type ancestor the trigger sits inside.
      const r = btnRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="binder-overflow" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="binder-overflow-btn"
        style={{ borderColor: color }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Binder actions"
        onClick={handleToggle}
      >
        <MoreHorizontal width={18} height={18} strokeWidth={2.2} aria-hidden />
      </button>
      {open && panelPos && (
        <BinderOverflowPanel
          containerRef={ref}
          panelPos={panelPos}
          onClose={() => setOpen(false)}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

/**
 * The open menu, split out so it (and useSheetExit's one-shot closing
 * state) unmounts with every close and mounts fresh on the next open.
 *
 * Portaled to <body> so the panel escapes the overflow-x:auto .binder-tab-row
 * scroll container (which promotes overflow-y to auto, clipping position:absolute
 * descendants at desktop). The position is passed in as fixed-viewport coords
 * computed from the trigger button's getBoundingClientRect().
 */
function BinderOverflowPanel({
  containerRef,
  panelPos,
  onClose,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  panelPos: PanelPos;
  onClose: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // ≤1024px this renders as a bottom action sheet with a slide-up entry, so
  // dismissal plays the symmetric slide-down exit via useSheetExit. On
  // desktop it's a plain dropdown with no entry animation — exits stay
  // instant there (symmetric with its entry), so we skip the hook's
  // animation wait entirely.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(max-width: 1024px)').matches) beginClose();
    else onClose();
  }, [beginClose, onClose]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      // Both the trigger container AND the portaled panel are outside each
      // other in the DOM, so check both before dismissing.
      const insideContainer = containerRef.current?.contains(e.target as Node);
      const insidePanel = panelRef.current?.contains(e.target as Node);
      if (!insideContainer && !insidePanel) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [containerRef, dismiss]);

  const closingClass = isClosing ? ' is-closing' : '';

  return createPortal(
    <>
      {/* On mobile this backdrop converts the panel into a bottom
          sheet. On desktop it's invisible (display:none from CSS) and
          the panel renders as a fixed dropdown above all scroll containers. */}
      <div
        className={`binder-overflow-backdrop${closingClass}`}
        onClick={() => dismiss()}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={`binder-overflow-panel${closingClass}`}
        role="menu"
        style={{ position: 'fixed', top: panelPos.top, right: panelPos.right }}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="binder-overflow-handle" aria-hidden />
        <button
          type="button"
          role="menuitem"
          className="binder-overflow-item"
          disabled={!canMoveUp}
          onClick={() => {
            dismiss();
            onMoveUp();
          }}
        >
          <ChevronUp width={14} height={14} strokeWidth={1.6} aria-hidden />
          <span>Move up</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="binder-overflow-item"
          disabled={!canMoveDown}
          onClick={() => {
            dismiss();
            onMoveDown();
          }}
        >
          <ChevronDown width={14} height={14} strokeWidth={1.6} aria-hidden />
          <span>Move down</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="binder-overflow-item"
          onClick={() => {
            dismiss();
            onEdit();
          }}
        >
          <Pencil width={14} height={14} strokeWidth={1.6} aria-hidden />
          <span>Edit binder</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="binder-overflow-item binder-overflow-item--danger"
          onClick={() => {
            dismiss();
            onDelete();
          }}
        >
          <X width={14} height={14} strokeWidth={1.8} aria-hidden />
          <span>Delete binder</span>
        </button>
      </div>
    </>,
    document.body
  );
}
