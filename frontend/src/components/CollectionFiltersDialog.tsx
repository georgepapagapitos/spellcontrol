import { ListFilter, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChipExpression, MaterializedBinder } from '../types';
import type { SetMap } from '../lib/api';
import { SetFilterPicker } from './SetFilterPicker';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { TypeLineExpressionBuilder } from './TypeLineExpressionBuilder';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

interface Props {
  supertypeExpr: ChipExpression;
  setSupertypeExpr: (next: ChipExpression) => void;
  typesExpr: ChipExpression;
  setTypesExpr: (next: ChipExpression) => void;
  subtypeExpr: ChipExpression;
  setSubtypeExpr: (next: ChipExpression) => void;
  subtypeSuggestions: string[];

  colorFilter: Set<string>;
  setColorFilter: (next: Set<string>) => void;
  colorOptions: Array<{ key: string; label: string }>;

  rarityExpr: ChipExpression;
  setRarityExpr: (next: ChipExpression) => void;
  rarities: readonly string[];

  /**
   * Binder section is collection-page-only. The deck-editor card search
   * doesn't have a binder concept, so it omits all three of these props
   * and the Binder section disappears entirely.
   */
  binderExpr?: ChipExpression;
  setBinderExpr?: (next: ChipExpression) => void;
  binders?: MaterializedBinder[];
  /** Force-hide binder section even when state is wired (binder-scoped views). */
  hideBinderFilter?: boolean;

  setFilter: Set<string>;
  setSetFilter: (next: Set<string>) => void;
  setMap?: SetMap;

  /**
   * "Group printings" toggle is collection-page-only — the deck editor
   * doesn't render rows per printing, so the option is meaningless and
   * the section just disappears when these are absent.
   */
  groupPrintings?: boolean;
  setGroupPrintings?: (next: boolean) => void;

  activeCount: number;
}

/**
 * Centered modal dialog that hosts every collection filter — type line,
 * color, rarity, binder, set, plus the group-printings option. Triggered
 * by the filter icon in the search pill; renders into a portal so it
 * overlays the whole app (backdrop + scroll lock).
 *
 * Edits stay local until **Apply** — picking chips, flipping joiners,
 * toggling colors etc. all mutate draft state inside the dialog. The
 * committed filters only change when the user explicitly applies.
 * **Clear** wipes the draft but leaves the dialog open. The close × /
 * backdrop click / Escape all dismiss without committing.
 *
 * Why deferred application: live-applying every keystroke caused the
 * card list to thrash and re-sort behind the dialog, which was both
 * distracting and slow on large collections.
 */
export function CollectionFiltersDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const hasActive = props.activeCount > 0;

  return (
    <>
      <button
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasActive ? `Filters (${props.activeCount} active)` : 'Filters'}
        title="Filters"
        onClick={() => setOpen(true)}
      >
        <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
        {hasActive && (
          <span className="collection-filters-badge" aria-hidden>
            {props.activeCount}
          </span>
        )}
      </button>
      {open &&
        createPortal(<DialogBody {...props} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/**
 * The mounted-while-open body. Splitting this out lets `useState`
 * initializers seed the draft from current props on each open — no
 * effect-driven sync needed, no stale draft after close+reopen.
 */
function DialogBody({
  supertypeExpr,
  setSupertypeExpr,
  typesExpr,
  setTypesExpr,
  subtypeExpr,
  setSubtypeExpr,
  subtypeSuggestions,
  colorFilter,
  setColorFilter,
  colorOptions,
  rarityExpr,
  setRarityExpr,
  rarities,
  binderExpr,
  setBinderExpr,
  binders,
  hideBinderFilter,
  setFilter,
  setSetFilter,
  setMap,
  groupPrintings,
  setGroupPrintings,
  onClose,
}: Props & { onClose: () => void }) {
  // Draft state — seeded once from props on mount; this component is
  // remounted on every dialog open, so the snapshot stays fresh.
  const [draftSuper, setDraftSuper] = useState<ChipExpression>(supertypeExpr);
  const [draftTypes, setDraftTypes] = useState<ChipExpression>(typesExpr);
  const [draftSubtype, setDraftSubtype] = useState<ChipExpression>(subtypeExpr);
  const [draftColor, setDraftColor] = useState<Set<string>>(() => new Set(colorFilter));
  const [draftRarity, setDraftRarity] = useState<ChipExpression>(rarityExpr);
  // Binder + groupPrintings are optional surfaces (collection-page only).
  // When the parent doesn't wire them up, the draft stays at its harmless
  // default and the section just doesn't render.
  const [draftBinder, setDraftBinder] = useState<ChipExpression>(binderExpr ?? EMPTY_EXPR);
  const [draftSet, setDraftSet] = useState<Set<string>>(() => new Set(setFilter));
  const [draftGroup, setDraftGroup] = useState<boolean>(groupPrintings ?? true);

  const showBinder = binderExpr !== undefined && !hideBinderFilter;
  const showOptions = groupPrintings !== undefined;

  const draftHasAny =
    draftSuper.chips.length > 0 ||
    draftTypes.chips.length > 0 ||
    draftSubtype.chips.length > 0 ||
    draftColor.size > 0 ||
    draftRarity.chips.length > 0 ||
    (showBinder && draftBinder.chips.length > 0) ||
    draftSet.size > 0 ||
    (showOptions && !draftGroup);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll so the page underneath doesn't drift while
    // the dialog is open — touch users especially expect this.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const toggleDraftColor = (c: string) => {
    setDraftColor((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const apply = () => {
    setSupertypeExpr(draftSuper);
    setTypesExpr(draftTypes);
    setSubtypeExpr(draftSubtype);
    setColorFilter(draftColor);
    setRarityExpr(draftRarity);
    if (showBinder) setBinderExpr?.(draftBinder);
    setSetFilter(draftSet);
    if (showOptions) setGroupPrintings?.(draftGroup);
    onClose();
  };

  const clearDraft = () => {
    setDraftSuper(EMPTY_EXPR);
    setDraftTypes(EMPTY_EXPR);
    setDraftSubtype(EMPTY_EXPR);
    setDraftColor(new Set());
    setDraftRarity(EMPTY_EXPR);
    setDraftBinder(EMPTY_EXPR);
    setDraftSet(new Set());
    setDraftGroup(true);
  };

  return (
    <div className="collection-filters-dialog-root">
      <div className="collection-filters-dialog-backdrop" onClick={onClose} aria-hidden />
      <div
        className="collection-filters-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Collection filters"
      >
        <header className="collection-filters-dialog-header">
          <span className="collection-filters-dialog-title">Filters</span>
          <button
            type="button"
            className="collection-filters-dialog-close"
            onClick={onClose}
            aria-label="Close filters without applying"
            title="Close without applying"
          >
            <X width={20} height={20} strokeWidth={1.8} aria-hidden />
          </button>
        </header>

        <div className="collection-filters-dialog-body">
          {/* Type line — one shared input that auto-classifies each
              token into Supertypes / Type / Subtype, then displays
              classified chips in their respective row. Each row's
              chips are its own ChipExpression so AND/OR composes
              naturally per category. */}
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Type line</div>
            <TypeLineExpressionBuilder
              supertypeExpr={draftSuper}
              setSupertypeExpr={setDraftSuper}
              typesExpr={draftTypes}
              setTypesExpr={setDraftTypes}
              subtypeExpr={draftSubtype}
              setSubtypeExpr={setDraftSubtype}
              subtypeSuggestions={subtypeSuggestions}
            />
          </section>

          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Color</div>
            <div className="color-filter-row" role="group" aria-label="Filter by color">
              {colorOptions.map((c) => {
                const active = draftColor.has(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`color-filter-btn${active ? ' is-active' : ''}`}
                    onClick={() => toggleDraftColor(c.key)}
                    aria-label={c.label}
                    aria-pressed={active}
                    title={c.label}
                  >
                    <i
                      className={`ms ms-${c.key.toLowerCase()} ms-cost color-pip-mana color-pip-mana--lg`}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* Single-valued fields (a card has one rarity, lives in one
              binder). The AND/OR joiner pills still render for visual
              consistency with the type-line rows, but flipping to AND
              between two values is unsatisfiable — the evaluator just
              returns no matches, which is technically correct.
              Defaults to OR for both. */}
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Rarity</div>
            <ChipExpressionBuilder
              value={draftRarity}
              onChange={setDraftRarity}
              options={rarities.map((r) => ({
                value: r,
                label: r.charAt(0).toUpperCase() + r.slice(1),
              }))}
              defaultJoiner="OR"
              placeholder="Add rarity…"
            />
          </section>

          {showBinder && (
            <section className="collection-filters-section">
              <div className="collection-filters-section-label">Binder</div>
              <ChipExpressionBuilder
                value={draftBinder}
                onChange={setDraftBinder}
                options={[
                  ...(binders ?? []).map((b) => ({ value: b.def.name, label: b.def.name })),
                  { value: '__uncategorized', label: 'Uncategorized' },
                ]}
                defaultJoiner="OR"
                placeholder="Add binder…"
              />
            </section>
          )}

          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Set</div>
            <SetFilterPicker setMap={setMap} value={draftSet} onChange={setDraftSet} />
          </section>

          {showOptions && (
            <section className="collection-filters-section">
              <div className="collection-filters-section-label">Options</div>
              <label className="filter-popover-row">
                <input
                  type="checkbox"
                  checked={draftGroup}
                  onChange={(e) => setDraftGroup(e.target.checked)}
                />
                <span className="filter-popover-label">Group printings</span>
              </label>
            </section>
          )}
        </div>

        <footer className="collection-filters-dialog-footer">
          <button
            type="button"
            className="collection-filters-dialog-clear"
            onClick={clearDraft}
            disabled={!draftHasAny}
          >
            Clear
          </button>
          <button type="button" className="collection-filters-dialog-done" onClick={apply}>
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}
