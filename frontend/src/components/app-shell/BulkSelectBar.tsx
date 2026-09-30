import type { KeyboardEvent, ReactNode } from 'react';
import { Check, CheckSquare } from 'lucide-react';
import './BulkSelectBar.css';
import { Button } from '@/components/shared/Button';
import type { OverflowMenuItem } from '@/components/overlays/OverflowMenu';
import { selectedCountLabel } from '@/lib/util/use-selection';

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
    <Button
      placement="row"
      className="bulk-select-toggle"
      aria-pressed={active}
      // On phones the idle label is hidden (`.toolbar-label-compact`, styles/
      // deck-builder-display.css) so the toolbar it sits in stays one row —
      // the accessible name has to come from here, not the text node.
      aria-label={active ? 'Done selecting' : 'Select'}
      title={active ? 'Done selecting' : 'Select'}
      onClick={onToggle}
      icon={<CheckSquare width={14} height={14} strokeWidth={1.8} />}
      labelClassName="toolbar-label-compact"
    >
      {active ? 'Done' : 'Select'}
    </Button>
  );
}

export function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span className="bulk-check" data-checked={checked} aria-hidden>
      {checked && <Check width={14} height={14} strokeWidth={1.8} />}
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
  /**
   * The selection's actions (Delete selected, Export, …), disabled while
   * nothing is selected. The same list is what a right-click inside the
   * selection offers (OverflowMenu `selection`), so pass it to both.
   */
  actions?: OverflowMenuItem[];
  /** Anything that is not an action row (rare). */
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
  actions = [],
  children,
}: BulkSelectBarProps) {
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <span className="bulk-bar-count">
        {count > 0 ? selectedCountLabel(count, noun) : 'Select items…'}
      </span>
      <Button placement="row" onClick={onToggleAll}>
        {allSelected ? 'Deselect all' : `Select all (${total})`}
      </Button>
      {actions.map((action, i) => {
        const Icon = action.icon;
        return (
          <Button
            key={`${i}-${action.label}`}
            placement="row"
            disabled={count === 0 || action.disabled}
            onClick={action.onClick}
            variant={action.danger ? 'danger' : undefined}
            icon={Icon ? <Icon width={14} height={14} strokeWidth={1.8} /> : undefined}
          >
            {action.label}
          </Button>
        );
      })}
      {children}
      {count > 0 && !allSelected && (
        <Button placement="row" onClick={onClear}>
          Clear
        </Button>
      )}
      <Button placement="row" onClick={onDone} className="bulk-bar-done">
        Done
      </Button>
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
