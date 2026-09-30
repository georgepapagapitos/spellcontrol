import type { OverflowMenuItem } from '@/components/overlays/OverflowMenu';
import { Button } from '@/components/shared/Button';

interface Props {
  selectedCount: number;
  countLabel: string;
  totalCount: number;
  allSelected: boolean;
  actions: OverflowMenuItem[];
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}

/** The bulk-actions bar shown while CardListTable is in select mode.
 *  Presentational; the selection itself lives in the table (T176 split). */
export function CardListBulkToolbar({
  selectedCount,
  countLabel,
  totalCount,
  allSelected,
  actions,
  onSelectAll,
  onClear,
  onDone,
}: Props) {
  return (
    <div className="card-list-bulk-toolbar" role="region" aria-label="Bulk actions">
      <span className="card-list-bulk-count">
        {selectedCount > 0 ? countLabel : 'Select cards'}
      </span>
      <Button placement="toolbar" onClick={() => (allSelected ? onClear() : onSelectAll())}>
        {allSelected ? 'Deselect all' : `Select all (${totalCount})`}
      </Button>
      {actions.map((action) => (
        <Button
          key={action.label}
          placement="toolbar"
          variant={action.danger ? 'danger' : undefined}
          disabled={selectedCount === 0}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
      {selectedCount > 0 && !allSelected && (
        <Button placement="toolbar" onClick={onClear}>
          Clear
        </Button>
      )}
      <Button placement="toolbar" onClick={onDone} className="card-list-bulk-done">
        Done
      </Button>
    </div>
  );
}
