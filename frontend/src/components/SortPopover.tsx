import { ArrowLeft, ArrowUpDown } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SORT_FIELDS, sortDirectionLabel } from '../lib/sorting';
import { SortEditor } from './SortEditor';
import { SortPresetChips, SortPresetList } from './SortPresets';
import { sortOrderSummaryLabel } from '@/lib/sort-order-label';
import { Modal } from './Modal';
import { Button } from '@/components/shared/Button';
import type { SortEntry, SortField } from '../types';
import { useAnchoredPanel } from '@/lib/use-anchored-panel';
import { Surface } from '@/components/shared/Surface';
import { useMediaQuery } from '@/lib/use-media-query';

type ValueOrders = Partial<Record<SortField, string[]>>;

/** A materialized section, trimmed to what "Your first sections" shows. */
export interface SortPreviewSection {
  label: string;
  page: number;
}

interface Props {
  sorts: SortEntry[];
  valueOrders: ValueOrders;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: ValueOrders) => void;
  /** The binder's real first few sections + the page each starts on, from the
   *  materialized binder this page already computed — shown in the phone
   *  sheet's chain view so picking fields has visible feedback without
   *  closing the sheet. Absent when the caller hasn't wired it up. */
  firstSections?: SortPreviewSection[];
  /** Total section count, for "+N more" under the first few, and the page
   *  count shown beside "Your first sections". */
  totalSections?: number;
  totalPages?: number;
}

/** Same phone tier as the rest of the app (ScanFab, BinderView) — the sort
 *  panel becomes a bottom sheet below this width instead of an anchored
 *  popover (E492). */
const NARROW = '(max-width: 599px)';

/**
 * In-view sort control for the binder summary line: a pill showing the
 * current order's NAME ("Set collection") or, for a chain that matches no
 * preset, the chain spelled out in words ("Rarity, then price"). Opens the
 * full picker — named orders first, "Choose fields" drills into the chain
 * editor — as an anchored popover on a roomy screen and a bottom sheet on a
 * phone, where an anchored panel would either clip or fight the screen
 * (STYLE_GUIDE § Config surfaces: a dialog on the kit opens as a sheet on a
 * phone).
 *
 * Edits persist immediately so the binder re-materializes live (STYLE_GUIDE §
 * Anchored panels: "live-apply for what you're looking at").
 */
export function SortPopover(props: Props) {
  const narrow = useMediaQuery(NARROW);
  return narrow ? <SortSheet {...props} /> : <SortAnchoredPopover {...props} />;
}

function describeAria(sorts: SortEntry[]): string {
  const activeSorts = sorts.filter((s) => s && s.field !== 'none');
  const spoken = activeSorts
    .map(
      (s) =>
        `${SORT_FIELDS.find((f) => f.value === s.field)?.label ?? s.field}, ${sortDirectionLabel(s.field, s.dir).toLowerCase()}`
    )
    .join(' › ');
  return spoken ? `Sorted by ${spoken}. Change sort order` : 'Change sort order';
}

function SortAnchoredPopover({ sorts, valueOrders, onSortsChange, onValueOrdersChange }: Props) {
  // `align: 'left'` — the sort panel is wide. `ignoreSelector` keeps the
  // SelectMenu portal-escape guard: a sort-field dropdown renders to <body>, so
  // interacting with (or scrolling) it must not collapse the sort popover.
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel({
    align: 'left',
    ignoreSelector: '.toolbar-popover-panel',
  });

  const label = sortOrderSummaryLabel(sorts);
  const description = describeAria(sorts);

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
        <ArrowUpDown width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span className="sort-popover-label">{label}</span>
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <Surface
            as="div"
            variant="popover"
            ref={panelRef}
            className="sort-popover-panel"
            role="dialog"
            aria-label="Sort within binder"
            style={panelStyle}
          >
            {/* Desktop keeps the anchored popover shape but gains the same
                named orders the phone sheet opens on, above the chain editor
                it always had (E491). The compact chip form (not the sheet's
                description-per-row list) keeps the panel short enough that
                the chain stays visible without scrolling at 1440×900.
                Picking "Choose fields" is a no-op here — the chain is
                already showing below. */}
            <SortPresetChips
              sorts={sorts}
              onPick={(preset) => onSortsChange(preset.sorts)}
              onChooseFields={() => {}}
            />
            <SortEditor
              sorts={sorts}
              valueOrders={valueOrders}
              onSortsChange={onSortsChange}
              onValueOrdersChange={onValueOrdersChange}
            />
          </Surface>,
          document.body
        )}
    </div>
  );
}

function SortSheet({
  sorts,
  valueOrders,
  onSortsChange,
  onValueOrdersChange,
  firstSections,
  totalSections,
  totalPages,
}: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'presets' | 'fields'>('presets');

  const label = sortOrderSummaryLabel(sorts);
  const description = describeAria(sorts);
  const moreSections =
    firstSections && totalSections !== undefined
      ? Math.max(0, totalSections - firstSections.length)
      : 0;

  return (
    <div className="sort-popover">
      <button
        type="button"
        className="sort-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={description}
        title={description}
        onClick={() => {
          setPage('presets');
          setOpen(true);
        }}
      >
        <ArrowUpDown width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span className="sort-popover-label">{label}</span>
      </button>
      {open && (
        <Modal
          backdropClassName="modal-backdrop--sheet"
          className="choice-dialog sort-sheet"
          label={page === 'presets' ? 'Order' : 'Choose fields'}
          onClose={() => setOpen(false)}
        >
          <div className="sort-sheet-head">
            {page === 'presets' ? (
              <h4 className="sort-sheet-title">Order</h4>
            ) : (
              <button type="button" className="sort-sheet-back" onClick={() => setPage('presets')}>
                <ArrowLeft width={14} height={14} strokeWidth={1.8} aria-hidden />
                Choose fields
              </button>
            )}
            {/* Closes the dialog's own way, per Modal's contract — no exit
                animation to wait on, just onClose directly. */}
            <Button variant="link" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
          {page === 'presets' ? (
            <SortPresetList
              sorts={sorts}
              onPick={(preset) => onSortsChange(preset.sorts)}
              onChooseFields={() => setPage('fields')}
            />
          ) : (
            <>
              <SortEditor
                sorts={sorts}
                valueOrders={valueOrders}
                onSortsChange={onSortsChange}
                onValueOrdersChange={onValueOrdersChange}
              />
              {firstSections && firstSections.length > 0 && (
                <div className="sort-sheet-preview">
                  <p className="sort-sheet-preview-head">
                    <span>Your first sections</span>
                    {totalPages !== undefined && <span>{totalPages} pages</span>}
                  </p>
                  <ul className="sort-sheet-preview-list">
                    {firstSections.map((s, i) => (
                      <li key={`${s.label}-${i}`}>
                        <span>{s.label}</span>
                        <span className="mono">p. {s.page}</span>
                      </li>
                    ))}
                  </ul>
                  {moreSections > 0 && (
                    <p className="sort-sheet-preview-more muted">+{moreSections} more</p>
                  )}
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
