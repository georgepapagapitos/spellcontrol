import { Check } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useEscapeKey } from '../lib/use-escape-key';
import { useSheetExit } from '../lib/use-sheet-exit';
import { compileFilterGroups, cardMatchesAnyGroup, areAllGroupsEmpty } from '../lib/rules';
import type { EnrichedCard } from '../types';
import { Button } from '@/components/shared/Button';

interface Props {
  /** Physical copyIds to move into the chosen binder. */
  copyIds: string[];
  /** The full cards behind `copyIds` — used to compute the per-binder
   *  "N of M match this binder's rules" line (B3-09), mirroring the
   *  single-card sheet's own rule check. */
  cards: EnrichedCard[];
  /**
   * Maps each copyId to the binder it currently lives in (primary assignment),
   * mirroring the single-card move path. Copies present here are *moved* (excluded
   * /unpinned from their current binder before being pinned to the target); copies
   * absent here have no current home and are simply added.
   */
  currentBinderByCopyId?: Map<string, string>;
  onClose: () => void;
}

export function BulkMoveToBinderSheet({ copyIds, cards, currentBinderByCopyId, onClose }: Props) {
  const binders = useCollectionStore((s) => s.binders);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const [doneTo, setDoneTo] = useState<string | null>(null);

  const compiledByBinder = useMemo(
    () => new Map(binders.map((b) => [b.id, compileFilterGroups(b.filterGroups)])),
    [binders]
  );

  // How many of the selected cards would route into this binder on its own
  // rules — a manual binder or one with no rules always "matches" everything
  // (mirrors AddToBinderSheet.cardMatchesBinder).
  const matchCount = useCallback(
    (binderId: string): number => {
      const binder = binders.find((b) => b.id === binderId);
      if (!binder || binder.mode === 'manual' || areAllGroupsEmpty(binder.filterGroups)) {
        return cards.length;
      }
      const compiled = compiledByBinder.get(binderId);
      if (!compiled) return cards.length;
      return cards.filter((c) => cardMatchesAnyGroup(c, compiled)).length;
    },
    [binders, compiledByBinder, cards]
  );

  useLockBodyScroll();

  // Below 1024px this is a bottom sheet with a slide-up entry, so every
  // dismiss path (backdrop, Escape, Cancel, the post-pick auto-close) plays
  // the symmetric `binder-sheet-slide-out` before unmount. On desktop it's
  // a centered panel with `animation: none` — exits stay instant there,
  // symmetric with its entry.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  // Auto-close after showing confirmation feedback.
  useEffect(() => {
    if (!doneTo) return;
    const t = setTimeout(dismiss, 900);
    return () => clearTimeout(t);
  }, [doneTo, dismiss]);

  const sorted = [...binders].sort((a, b) => a.position - b.position);

  // If any selected copy currently lives in a binder, this is a move (those get
  // pulled out of their current binder first); otherwise it's a plain add.
  const isMove = useMemo(
    () => copyIds.some((id) => currentBinderByCopyId?.has(id)),
    [copyIds, currentBinderByCopyId]
  );

  const handlePick = (binderId: string) => {
    for (const copyId of copyIds) {
      const currentId = currentBinderByCopyId?.get(copyId);
      // Mirror the single-card path: a true move first removes the copy from its
      // current binder. If it isn't pinned there it landed via rule routing, so
      // we exclude (true) rather than unpin (false).
      if (currentId && currentId !== binderId) {
        const current = binders.find((b) => b.id === currentId);
        const wasPinned = !!current?.pinnedCopyIds?.includes(copyId);
        removeCardFromBinder(currentId, copyId, !wasPinned);
      }
      pinCardToBinder(binderId, copyId);
    }
    setDoneTo(binderId);
  };

  const count = copyIds.length;

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={isMove ? 'Move to binder' : 'Add to binder'}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="add-to-binder-label">{isMove ? 'Moving' : 'Adding'}</p>
          <p className="add-to-binder-card-name">
            {count} {count === 1 ? 'card' : 'cards'}
          </p>
        </div>

        {sorted.length === 0 ? (
          <div className="card-picker-empty" style={{ padding: 'var(--space-6) var(--space-4)' }}>
            No binders yet. Create a binder first.
          </div>
        ) : (
          <ul className="card-picker-list" role="list">
            {sorted.map((binder) => {
              const isDone = doneTo === binder.id;
              const isManual = binder.mode === 'manual';
              const actionWord = isMove ? 'Move' : 'Add';
              const matches = matchCount(binder.id);
              return (
                <li key={binder.id} className="add-to-binder-row">
                  <span
                    className="add-to-binder-swatch"
                    style={{ background: binder.color ?? 'var(--accent)' }}
                    aria-hidden
                  />
                  <span className="add-to-binder-name">
                    {binder.name}
                    {isManual && <span className="add-to-binder-mode-hint">Manual</span>}
                  </span>
                  {!isManual && matches < count && !isDone && (
                    <span className="add-to-binder-mismatch">
                      {matches} of {count} match this binder's rules
                    </span>
                  )}
                  {isDone ? (
                    <span className="add-to-binder-added" aria-live="polite">
                      <Check
                        width={12}
                        height={12}
                        strokeWidth={2}
                        aria-hidden
                        style={{
                          display: 'inline',
                          verticalAlign: 'middle',
                          marginRight: '0.2rem',
                        }}
                      />{' '}
                      {isMove ? 'Moved' : 'Added'}
                    </span>
                  ) : (
                    <Button
                      onClick={() => handlePick(binder.id)}
                      aria-label={`${actionWord} ${count} ${count === 1 ? 'card' : 'cards'} to ${binder.name}`}
                      disabled={!!doneTo}
                      className="add-to-binder-btn"
                    >
                      {actionWord}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="card-picker-footer">
          <Button onClick={() => dismiss()}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
