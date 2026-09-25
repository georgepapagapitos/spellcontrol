import { ArrowUpDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { SORT_FIELDS, sortDirectionLabel, sortEntryLabel } from '../lib/sorting';
import { SortEditor } from './SortEditor';
import type { SortEntry, SortField } from '../types';
import { useAnchoredPanel } from '@/lib/use-anchored-panel';

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
 *
 * Portals the panel to `<body>` and uses `computePopoverPlacement` so it
 * flips/clamps against the safe viewport (accounting for sticky header,
 * mobile bottom nav, and keyboard inset).
 */
export function SortPopover({ sorts, valueOrders, onSortsChange, onValueOrdersChange }: Props) {
  // `align: 'left'` — the sort panel is wide. `ignoreSelector` keeps the
  // SelectMenu portal-escape guard: a sort-field dropdown renders to <body>, so
  // interacting with (or scrolling) it must not collapse the sort popover.
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel({
    align: 'left',
    ignoreSelector: '.toolbar-popover-panel',
  });

  const activeSorts = sorts.filter((s) => s && s.field !== 'none');
  const breadcrumb = activeSorts.map(sortEntryLabel).join(' › ');
  // The pill's ↑/↓ glyph marks a non-default direction but can't say what it
  // does — "release date ↑" reads two ways. The tooltip and accessible name
  // spell each level out by effect ("Release date, oldest first"), the same
  // wording the editor's direction buttons use (STYLE_GUIDE § Sort chains).
  const spoken = activeSorts
    .map(
      (s) =>
        `${SORT_FIELDS.find((f) => f.value === s.field)?.label ?? s.field}, ${sortDirectionLabel(s.field, s.dir).toLowerCase()}`
    )
    .join(' › ');
  const description = spoken ? `Sorted by ${spoken}. Change sort order` : 'Change sort order';

  return (
    <div className="sort-popover">
      <button
        ref={triggerRef}
        type="button"
        className={`sort-popover-btn${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={description}
        title={description}
        onClick={toggle}
      >
        <ArrowUpDown width={13} height={13} strokeWidth={2} aria-hidden />
        <span className="sort-popover-label">{breadcrumb || 'Sort'}</span>
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            className="sort-popover-panel"
            role="dialog"
            aria-label="Sort within binder"
            style={panelStyle}
          >
            <SortEditor
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
