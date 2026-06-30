import type { KeyboardEvent, ReactNode } from 'react';
import { Check, CheckSquare } from 'lucide-react';
import './BulkSelectBar.css';

/**
 * Shared multi-select affordances for list/index surfaces (decks, binders,
 * lists). Pairs with `useSelection`. Three pieces:
 *  - `SelectToggle` — the header/toolbar "Select"/"Done" pill.
 *  - `BulkSelectBar` — the action bar shown while select mode is on.
 *  - `SelectCheck` — the corner check badge rendered on each selectable card.
 * Plus `selectInteraction`, which returns the click/keyboard props that turn a
 * card into a selection target (and the className tokens to mark it selected).
 */

export function SelectToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="pill-btn bulk-select-toggle"
      aria-pressed={active}
      onClick={onToggle}
    >
      <CheckSquare width={14} height={14} strokeWidth={2} aria-hidden />
      <span>{active ? 'Done' : 'Select'}</span>
    </button>
  );
}

export function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span className="bulk-check" data-checked={checked} aria-hidden>
      {checked && <Check width={14} height={14} strokeWidth={3} />}
    </span>
  );
}

interface BulkSelectBarProps {
  /** Number of currently-selected items. */
  count: number;
  /** Total selectable items (post-filter), for the Select-all label. */
  total: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  onDone: () => void;
  /** Singular noun for the count label, e.g. "deck". Pluralized with "s". */
  noun: string;
  /** Action buttons (Delete selected, Export, …). Disabled when count is 0. */
  children?: ReactNode;
}

export function BulkSelectBar({
  count,
  total,
  allSelected,
  onToggleAll,
  onClear,
  onDone,
  noun,
  children,
}: BulkSelectBarProps) {
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <span className="bulk-bar-count">
        {count > 0 ? `${count} ${noun}${count === 1 ? '' : 's'} selected` : 'Select items…'}
      </span>
      <button type="button" className="pill-btn" onClick={onToggleAll}>
        {allSelected ? 'Deselect all' : `Select all (${total})`}
      </button>
      {children}
      {count > 0 && !allSelected && (
        <button type="button" className="pill-btn" onClick={onClear}>
          Clear
        </button>
      )}
      <button type="button" className="pill-btn bulk-bar-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

/**
 * Props that make a card act as a selection target while select mode is on:
 * the whole card toggles on click/Enter/Space, and screen readers announce it
 * as a pressed/unpressed button. Returns `{}` when select mode is off so the
 * card keeps its normal navigation behavior.
 */
export function selectInteraction(active: boolean, selected: boolean, onToggle: () => void) {
  if (!active) return {} as const;
  return {
    role: 'button' as const,
    'aria-pressed': selected,
    tabIndex: 0,
    onClick: onToggle,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    },
  };
}
