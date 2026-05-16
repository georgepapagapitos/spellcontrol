import {
  SORT_FIELDS,
  MAX_SORTS,
  getImplicitTiebreakers,
  sortEntryLabel,
  describeSortOrder,
  CUSTOMIZABLE_VALUE_ORDER_FIELDS,
} from '../lib/sorting';
import { SelectMenu } from './SelectMenu';
import { SortDirArrow } from './SortDirArrow';
import { SortValueOrderEditor } from './SortValueOrderEditor';
import type { SortEntry, SortField } from '../types';

type ValueOrders = Partial<Record<SortField, string[]>>;

interface Props {
  sorts: SortEntry[];
  valueOrders: ValueOrders;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: ValueOrders) => void;
  /** Hide the verbose explanatory paragraph (used in the compact popover). */
  compact?: boolean;
}

/**
 * The sort-chain editor: ordered list of field pickers (each toggles its own
 * direction when re-selected), reorder/remove controls, optional value-order
 * editors for treatment/finish, and the implicit tie-breaker hint. Controlled
 * — shared by the binder edit modal and the in-view sort popover so the two
 * never drift apart.
 */
export function SortEditor({
  sorts,
  valueOrders,
  onSortsChange,
  onValueOrdersChange,
  compact,
}: Props) {
  return (
    <>
      {!compact && (
        <p className="muted" style={{ marginBottom: '0.5rem' }}>
          The first sort splits the binder into section headers; later sorts order cards within each
          section. Up to {MAX_SORTS} rules — treatment, finish, and name are applied automatically
          as tie-breakers after yours.
        </p>
      )}
      <div className="sort-editor-list">
        {sorts.map((s, i) => {
          const orderHint = describeSortOrder(s.field, s.dir, valueOrders);
          const isCustomizable = CUSTOMIZABLE_VALUE_ORDER_FIELDS.includes(s.field);
          return (
            <div key={i} className="sort-editor-row">
              <span className="sort-editor-num">{i + 1}.</span>
              <SelectMenu
                ariaLabel={`Sort ${i + 1} field`}
                value={s.field}
                options={SORT_FIELDS.map((f) => ({ value: f.value, label: f.label }))}
                closeOnSelect={false}
                leadingIcon={<SortDirArrow dir={s.dir} />}
                renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={s.dir} /> : null)}
                onChange={(field) => {
                  onSortsChange(
                    sorts.map((x, j) => {
                      if (j !== i) return x;
                      if (x.field === field) {
                        return { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' };
                      }
                      const defaultDir =
                        SORT_FIELDS.find((f) => f.value === field)?.defaultDir ?? 'asc';
                      return { field: field as SortField, dir: defaultDir };
                    })
                  );
                }}
              />
              <div className="tab-actions sort-editor-actions">
                <button
                  type="button"
                  className="tab-action"
                  onClick={() => onSortsChange(swap(sorts, i, i - 1))}
                  disabled={i === 0}
                  title="Move up"
                  aria-label="Move sort up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="tab-action"
                  onClick={() => onSortsChange(swap(sorts, i, i + 1))}
                  disabled={i === sorts.length - 1}
                  title="Move down"
                  aria-label="Move sort down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  className="tab-action"
                  onClick={() => onSortsChange(sorts.filter((_, j) => j !== i))}
                  disabled={sorts.length === 1}
                  title="Remove this sort"
                  aria-label="Remove sort"
                >
                  ×
                </button>
              </div>
              {isCustomizable ? (
                <SortValueOrderEditor
                  field={s.field}
                  value={valueOrders[s.field]}
                  onChange={(next) => {
                    const copy = { ...valueOrders };
                    if (next === undefined) delete copy[s.field];
                    else copy[s.field] = next;
                    onValueOrdersChange(copy);
                  }}
                />
              ) : (
                orderHint && (
                  <p
                    className="muted sort-editor-order-hint"
                    style={{
                      width: '100%',
                      margin: '0.15rem 0 0 1.75rem',
                      fontSize: 'var(--text-xs)',
                    }}
                  >
                    {orderHint}
                  </p>
                )
              )}
            </div>
          );
        })}
        {sorts.length < MAX_SORTS && (
          <button
            type="button"
            className="btn btn-add-group"
            onClick={() => onSortsChange([...sorts, nextDefaultSort(sorts)])}
          >
            + Add sort
          </button>
        )}
      </div>
      <ImplicitTiebreakerHint sorts={sorts} valueOrders={valueOrders} />
    </>
  );
}

function ImplicitTiebreakerHint({
  sorts,
  valueOrders,
}: {
  sorts: SortEntry[];
  valueOrders: ValueOrders;
}) {
  const extras = getImplicitTiebreakers(sorts);
  if (!extras.length) return null;
  const tooltipLines = [
    'Applied automatically after your sort rules to keep ordering stable.',
    'Add any of these to your chain above to flip direction or customize value order.',
    ...extras
      .map((e) => {
        const resolved = describeSortOrder(e.field, e.dir, valueOrders);
        return resolved ? `• ${sortEntryLabel(e)}: ${resolved}` : null;
      })
      .filter((s): s is string => s !== null),
  ];
  return (
    <p
      className="muted"
      style={{ marginTop: '0.5rem', fontSize: '0.85em' }}
      title={tooltipLines.join('\n')}
    >
      Then tie-broken by: {extras.map((e) => sortEntryLabel(e)).join(' → ')}
    </p>
  );
}

/** Swap two array elements; out-of-bounds indices return the array unchanged. */
function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Pick a sort entry for a freshly-added row — the first field not already used, or 'name'. */
function nextDefaultSort(existing: SortEntry[]): SortEntry {
  for (const opt of SORT_FIELDS) {
    if (!existing.some((e) => e.field === opt.value)) {
      return { field: opt.value, dir: opt.defaultDir };
    }
  }
  return { field: 'name', dir: 'asc' };
}
