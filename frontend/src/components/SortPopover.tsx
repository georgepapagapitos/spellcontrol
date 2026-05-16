import { ArrowUpDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sortEntryLabel } from '../lib/sorting';
import { SortEditor } from './SortEditor';
import type { SortEntry, SortField } from '../types';

type ValueOrders = Partial<Record<SortField, string[]>>;

interface Props {
  sorts: SortEntry[];
  valueOrders: ValueOrders;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: ValueOrders) => void;
}

/**
 * In-view sort control for the binder summary line: a button showing the
 * current sort chain ("color › cmc ↓ › name") that opens the full SortEditor
 * in a popover. Edits persist immediately so the binder re-materializes live.
 */
export function SortPopover({ sorts, valueOrders, onSortsChange, onValueOrdersChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeSorts = sorts.filter((s) => s && s.field !== 'none');
  const breadcrumb = activeSorts.map(sortEntryLabel).join(' › ');

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      // SelectMenu renders its dropdown in a portal outside this wrapper —
      // clicks on a sort-field option must not collapse the sort popover.
      if ((e.target as HTMLElement).closest?.('.toolbar-popover-panel')) return;
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

  return (
    <div className="sort-popover" ref={wrapperRef}>
      <button
        type="button"
        className={`sort-popover-btn${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Change sort order"
        title="Change sort order"
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowUpDown width={13} height={13} strokeWidth={2} aria-hidden />
        <span className="sort-popover-label">{breadcrumb ? `Sort: ${breadcrumb}` : 'Sort'}</span>
      </button>
      {open && (
        <div className="sort-popover-panel" role="dialog" aria-label="Sort within binder">
          <SortEditor
            compact
            sorts={sorts}
            valueOrders={valueOrders}
            onSortsChange={onSortsChange}
            onValueOrdersChange={onValueOrdersChange}
          />
        </div>
      )}
    </div>
  );
}
