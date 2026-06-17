import { ArrowUpDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sortEntryLabel } from '../lib/sorting';
import { SortEditor } from './SortEditor';
import type { SortEntry, SortField } from '../types';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';

type ValueOrders = Partial<Record<SortField, string[]>>;

interface Props {
  sorts: SortEntry[];
  valueOrders: ValueOrders;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: ValueOrders) => void;
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * In-view sort control for the binder summary line: a button showing the
 * current sort chain ("color › cmc ↓ › name") that opens the full SortEditor
 * in a popover. Edits persist immediately so the binder re-materializes live.
 *
 * Portals the panel to `<body>` and uses `computePopoverPlacement` so it
 * flips/clamps against the safe viewport (accounting for sticky header,
 * mobile bottom nav, and keyboard inset).
 */
export function SortPopover({ sorts, valueOrders, onSortsChange, onValueOrdersChange }: Props) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeSorts = sorts.filter((s) => s && s.field !== 'none');
  const breadcrumb = activeSorts.map(sortEntryLabel).join(' › ');

  // After the panel renders in the portal, measure and clamp/flip into the safe
  // viewport. useLayoutEffect fires before paint so there is no visible flash.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      safe,
      'left' // sort panel opens left-aligned (it's wide)
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  // Close on outside click or Escape while open.
  // Keeps the SelectMenu portal-escape guard: clicks inside a .toolbar-popover-panel
  // (a SelectMenu that portaled out) must not dismiss this popover.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target as Node)) return;
      if (buttonRef.current?.contains(target as Node)) return;
      // SelectMenu renders its dropdown in a portal outside this wrapper —
      // clicks on a sort-field option must not collapse the sort popover.
      if (target.closest?.('.toolbar-popover-panel')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 6, left: Math.max(8, r.left) });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="sort-popover">
      <button
        ref={buttonRef}
        type="button"
        className={`sort-popover-btn${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Change sort order"
        title="Change sort order"
        onClick={handleToggle}
      >
        <ArrowUpDown width={13} height={13} strokeWidth={2} aria-hidden />
        <span className="sort-popover-label">{breadcrumb ? `Sort: ${breadcrumb}` : 'Sort'}</span>
      </button>
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className="sort-popover-panel"
            role="dialog"
            aria-label="Sort within binder"
            style={{
              position: 'fixed',
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              right: panelPos.right,
            }}
          >
            <SortEditor
              compact
              sorts={sorts}
              valueOrders={valueOrders}
              onSortsChange={onSortsChange}
              onValueOrdersChange={onValueOrdersChange}
            />
          </div>,
          document.body
        )}
    </div>
  );
}
