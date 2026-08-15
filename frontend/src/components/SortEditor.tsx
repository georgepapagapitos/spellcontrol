import { ArrowDown, ArrowUp, X } from 'lucide-react';
import {
  SORT_FIELDS,
  MAX_SORTS,
  getImplicitTiebreakers,
  sortEntryLabel,
  describeSortOrder,
  sortDirectionLabel,
  CUSTOMIZABLE_VALUE_ORDER_FIELDS,
} from '../lib/sorting';
import { InfoTip } from './InfoTip';
import { SelectMenu } from './SelectMenu';
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
 * The sort-chain editor: an ordered list of rows — field picker, direction
 * toggle, reorder/remove actions — plus optional value-order editors for
 * treatment/finish and the implicit tie-breaker hint. Controlled, and shared by
 * the binder edit modal and the in-view sort popover so the two never drift.
 *
 * Two things used to make this surface actively misleading:
 *
 *  1. There was no direction control. Flipping asc/desc meant opening the field
 *     dropdown and re-selecting the field you already had — a hidden gesture
 *     with nothing on screen to suggest it existed.
 *  2. The ▲/▼ buttons sitting exactly where a direction control belongs move the
 *     row up and down the chain instead. So the obvious-looking direction
 *     affordance did something else, and the real one was invisible.
 *
 * Direction is now its own button, labelled with what it does to the cards
 * ("Newest first", "A → Z", "Most played") rather than with `asc`/`desc`. That
 * is not pedantry: ascending release date is newest-LAST while ascending EDHREC
 * rank is most-popular-FIRST, so the raw word is ambiguous even to a reader who
 * knows what it means.
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
        <p className="muted sort-editor-intro">
          The first sort splits the binder into section headers; later sorts order cards within each
          section. Up to {MAX_SORTS} rules — treatment, finish, and name are applied automatically
          as tie-breakers after yours.
        </p>
      )}
      <div className="sort-editor-list">
        {sorts.map((s, i) => {
          const isCustomizable = CUSTOMIZABLE_VALUE_ORDER_FIELDS.includes(s.field);
          // The picker's own label ("Release date"), not `sortEntryLabel` —
          // that one appends a ↑/↓ glyph, which a screen reader either spells
          // out or drops, and the direction is already its own control here.
          const fieldLabel = SORT_FIELDS.find((f) => f.value === s.field)?.label ?? s.field;
          const dirLabel = sortDirectionLabel(s.field, s.dir);
          const DirIcon = s.dir === 'asc' ? ArrowUp : ArrowDown;
          return (
            // Keyed by field, not index. A chain that reorders and removes rows
            // reuses component instances by POSITION under an index key, so an
            // open field dropdown reattached itself to whichever row slid into
            // that slot. Fields are unique because the picker hides taken ones.
            <div key={s.field} className="sort-editor-row">
              <span className="sort-editor-num">{i + 1}.</span>
              <SelectMenu
                ariaLabel={`Sort ${i + 1} field`}
                value={s.field}
                // Only fields not already in the chain (plus this row's own).
                // Sorting by the same field twice does nothing — the second
                // pass has no ties left to break — and allowing it was also
                // what stopped the field from being a usable React key.
                options={SORT_FIELDS.filter(
                  (f) => f.value === s.field || !sorts.some((x) => x.field === f.value)
                ).map((f) => ({ value: f.value, label: f.label }))}
                onChange={(field) => {
                  if (field === s.field) return; // re-picking your own field is a no-op
                  onSortsChange(
                    sorts.map((x, j) => {
                      if (j !== i) return x;
                      const defaultDir =
                        SORT_FIELDS.find((f) => f.value === field)?.defaultDir ?? 'asc';
                      return { field: field as SortField, dir: defaultDir };
                    })
                  );
                }}
              />
              <button
                type="button"
                className="sort-editor-dir"
                aria-label={`Sort ${i + 1} direction: ${dirLabel}. Activate to reverse.`}
                title={`${dirLabel} — click to reverse`}
                onClick={() =>
                  onSortsChange(
                    sorts.map((x, j) =>
                      j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x
                    )
                  )
                }
              >
                <DirIcon width={13} height={13} strokeWidth={2} aria-hidden />
                <span className="sort-editor-dir-label">{dirLabel}</span>
              </button>
              <div className="tab-actions sort-editor-actions">
                <button
                  type="button"
                  className="tab-action"
                  onClick={() => onSortsChange(swap(sorts, i, i - 1))}
                  disabled={i === 0}
                  title="Move up"
                  aria-label={`Move ${fieldLabel} earlier in the sort order`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="tab-action"
                  onClick={() => onSortsChange(swap(sorts, i, i + 1))}
                  disabled={i === sorts.length - 1}
                  title="Move down"
                  aria-label={`Move ${fieldLabel} later in the sort order`}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className="tab-action"
                  onClick={() => onSortsChange(sorts.filter((_, j) => j !== i))}
                  disabled={sorts.length === 1}
                  title={
                    sorts.length === 1 ? 'A binder needs at least one sort' : 'Remove this sort'
                  }
                  aria-label={`Remove the ${fieldLabel} sort`}
                >
                  <X width={13} height={13} strokeWidth={2.2} aria-hidden />
                </button>
              </div>
              {isCustomizable && (
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
  return (
    <p className="muted sort-editor-tiebreakers">
      Then tie-broken by: {extras.map((e) => sortEntryLabel(e)).join(' → ')}
      {/* Was a bare `title=` carrying four lines of explanation — invisible on
          touch and to assistive tech. The style guide names that exact case as
          the one InfoTip exists for. */}
      <InfoTip
        label="automatic tie-breakers"
        wide
        text={
          <>
            <p className="info-tip-lead">
              Applied after your own sort rules so cards that tie under them still land in a stable
              order.
            </p>
            <ul className="info-tip-list">
              {extras.map((e) => {
                const resolved = describeSortOrder(e.field, e.dir, valueOrders);
                return (
                  <li key={e.field}>
                    {sortEntryLabel(e)}
                    {resolved ? `: ${resolved}` : ''}
                  </li>
                );
              })}
            </ul>
            <p>Add any of them above to flip its direction or customise its value order.</p>
          </>
        }
      />
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
