import { useCallback, useMemo } from 'react';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useEscapeKey } from '../../lib/use-escape-key';
import { useSheetExit } from '../../lib/use-sheet-exit';
import { formatMoney } from '../../lib/format-money';
import type { OwnershipLens } from '../../lib/ownership-lens';

interface Props {
  id?: string;
  lens: OwnershipLens;
  missingCardPrices: Map<string, number | null>;
  onClose: () => void;
}

interface BinderSummaryRow {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

/**
 * Ownership lens detail sheet (w1-ownership-lens) — the missing-card list
 * (name + estimated nonfoil price) plus a compact owned/binder breakdown.
 * Reuses the existing card-picker shell verbatim (auto-scrim via the shared
 * `:where(.card-picker-root)` rule — zero new scrim CSS) and its generic
 * list/row classes (see CardPickerSheet.tsx for the same pattern), so this
 * file needs no CSS of its own.
 */
export function OwnershipLensSheet({ id, lens, missingCardPrices, onClose }: Props) {
  useLockBodyScroll();

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  // Compact owned/binder summary: how many owned deck cards fall in each
  // binder (or own no binder at all) — grouped counts, not a full per-card
  // list (the missing list below is the detailed one). A card owned across
  // several binders is counted once per distinct binder it appears in.
  const { binderRows, uncategorizedCount } = useMemo(() => {
    const byBinder = new Map<string, BinderSummaryRow>();
    let noBinder = 0;
    for (const entry of lens.perCard.values()) {
      if (!entry.owned) continue;
      if (entry.binders.length === 0) {
        noBinder++;
        continue;
      }
      const seen = new Set<string>();
      for (const b of entry.binders) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        const existing = byBinder.get(b.id);
        if (existing) existing.count++;
        else byBinder.set(b.id, { id: b.id, name: b.name, color: b.color, count: 1 });
      }
    }
    return {
      binderRows: [...byBinder.values()].sort((a, b) => b.count - a.count),
      uncategorizedCount: noBinder,
    };
  }, [lens]);

  const hasMissing = lens.missingCardNames.length > 0;
  const hasOwnedSummary = binderRows.length > 0 || uncategorizedCount > 0;

  return (
    <div className="card-picker-root" onClick={dismiss} role="presentation">
      <div
        id={id}
        className={`card-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="What you own from this deck"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">
            {lens.ownedCount} of {lens.totalCount} cards owned
          </h2>
        </div>

        {hasMissing && (
          <ul className="card-picker-list" role="list" aria-label="Missing cards">
            {lens.missingCardNames.map((name) => (
              <li key={name} className="card-picker-row">
                <span className="card-picker-name">{name}</span>
                <span className="card-picker-meta">
                  {formatMoney(missingCardPrices.get(name) ?? null)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {hasOwnedSummary && (
          <ul className="card-picker-list" role="list" aria-label="Owned, by binder">
            {binderRows.map((row) => (
              <li key={row.id} className="card-picker-row">
                <span
                  className="card-picker-rarity"
                  style={row.color ? { background: row.color } : undefined}
                  aria-hidden
                />
                <span className="card-picker-name">{row.name}</span>
                <span className="card-picker-meta">
                  {row.count} card{row.count === 1 ? '' : 's'}
                </span>
              </li>
            ))}
            {uncategorizedCount > 0 && (
              <li className="card-picker-row">
                <span className="card-picker-rarity" aria-hidden />
                <span className="card-picker-name">Uncategorized</span>
                <span className="card-picker-meta">
                  {uncategorizedCount} card{uncategorizedCount === 1 ? '' : 's'}
                </span>
              </li>
            )}
          </ul>
        )}

        {!hasMissing && !hasOwnedSummary && (
          <p className="card-picker-empty">Nothing to show yet.</p>
        )}

        <div className="card-picker-footer">
          <button type="button" className="btn btn-primary" onClick={() => dismiss()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
