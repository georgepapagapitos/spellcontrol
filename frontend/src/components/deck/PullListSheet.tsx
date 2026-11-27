import { type JSX, useCallback, useMemo, useState } from 'react';
import { Sheet } from '@/components/overlays/Sheet';
import { useSetMap } from '@/lib/api';
import { buildPullList, isPullableKind, type PullListGroup } from '@/lib/collection/pull-list';
import { formatLocationSpan } from '@/lib/binder/card-locations';
import type { AllocationInfo } from '@/lib/collection/allocations';
import type { Deck } from '../../store/decks';
import type { BinderDef, EnrichedCard } from '../../types';
import { CardRow } from '../shared/CardRow';
import { MeterBar } from '../shared/MeterBar';
import { EmptyState } from '../shared/EmptyState';
import './PullListSheet.css';
import { Button } from '@/components/shared/Button';
import { Count } from '@/components/shared/Count';

/**
 * Device-local checklist state for one deck's pull session — which row keys
 * are checked off. Persisted to localStorage (same fail-safe pattern as
 * use-collapsed-pref) so a pull that spans an app restart keeps its progress;
 * never synced. Stale keys from since-edited decks are harmless and cleared
 * by "Start over".
 */
function usePullChecks(deckId: string) {
  const storageKey = `pull-list:${deckId}`;
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const persist = useCallback(
    (next: Set<string>) => {
      setChecked(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Quota/privacy mode — checklist stays session-only.
      }
    },
    [storageKey]
  );
  const toggle = useCallback(
    (key: string) => {
      const next = new Set(checked);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
    },
    [checked, persist]
  );
  const checkAll = useCallback(
    (keys: string[]) => persist(new Set([...checked, ...keys])),
    [checked, persist]
  );
  const reset = useCallback(() => persist(new Set()), [persist]);
  return { checked, toggle, checkAll, reset };
}

const rowKey = (group: PullListGroup, key: string) => `${group.key}:${key}`;

/**
 * Physical-assembly sheet: where every card in the deck lives, grouped by
 * binder in priority order (rows in each binder's own page order), then
 * Uncategorized, then copies allocated elsewhere, then unowned cards. Check
 * rows off as you pull — walk your binders once, list in hand. Opened from
 * the deck-action row (peer to Tokens): it's prep, not analysis.
 *
 * Built on <Sheet> (bottom sheet on mobile, centered modal ≥1024px), with
 * Start over in its `actions` slot beside the close button.
 */
export function PullListSheet({
  deck,
  collection,
  binderDefs,
  allocations,
  onClose,
}: {
  deck: Deck;
  collection: EnrichedCard[];
  binderDefs: BinderDef[];
  allocations: Map<string, AllocationInfo>;
  onClose: () => void;
}): JSX.Element {
  const setMap = useSetMap();

  const groups = useMemo(
    () => buildPullList(deck, collection, binderDefs, allocations, setMap),
    [deck, collection, binderDefs, allocations, setMap]
  );
  const { checked, toggle, checkAll, reset } = usePullChecks(deck.id);

  // Progress counts physical cards (a checked row pulls its whole pile).
  let totalQty = 0;
  let pulledQty = 0;
  for (const g of groups) {
    if (!isPullableKind(g.kind)) continue;
    for (const r of g.rows) {
      totalQty += r.qty;
      if (checked.has(rowKey(g, r.key))) pulledQty += r.qty;
    }
  }

  const subtitle =
    groups.length === 0
      ? 'Nothing to pull yet.'
      : totalQty === 0
        ? 'Nothing to pull. No free copies in your binders.'
        : pulledQty === totalQty
          ? `All ${totalQty} pulled.`
          : `${pulledQty} of ${totalQty} pulled.`;

  return (
    <Sheet
      onClose={onClose}
      title="Pull list"
      description={<span aria-live="polite">{subtitle}</span>}
      className="pull-list-sheet"
      rootClassName="pull-list-root"
      actions={
        pulledQty > 0 && (
          <Button variant="link" onClick={reset}>
            Start over
          </Button>
        )
      }
      closeButton
    >
      {totalQty > 0 && (
        <div className="pull-list-meter">
          <MeterBar value={pulledQty} max={totalQty} size="sm" />
        </div>
      )}

      <div className="pull-list-body">
        {groups.length === 0 ? (
          <EmptyState tagline="Nothing to pull yet." hint="Add cards to the deck first." />
        ) : (
          groups.map((g) => {
            const pullable = isPullableKind(g.kind);
            const groupQty = g.rows.reduce((n, r) => n + r.qty, 0);
            const groupPulled = pullable
              ? g.rows.reduce((n, r) => n + (checked.has(rowKey(g, r.key)) ? r.qty : 0), 0)
              : 0;
            const unpulledKeys = pullable
              ? g.rows.map((r) => rowKey(g, r.key)).filter((k) => !checked.has(k))
              : [];
            const groupCountText = pullable
              ? `${groupPulled} of ${groupQty}`
              : `${groupQty} ${groupQty === 1 ? 'card' : 'cards'}`;
            return (
              <section key={g.key} className="pull-list-group" aria-label={g.label}>
                <div className="pull-list-group-head">
                  {g.color && (
                    <span
                      className="pull-list-group-dot"
                      style={{ background: g.color }}
                      aria-hidden
                    />
                  )}
                  <h3 className="pull-list-group-title">{g.label}</h3>
                  <Count
                    className="pull-list-group-count"
                    value={groupQty}
                    placement="inline"
                    display={groupCountText}
                    label={groupCountText}
                  />
                  {unpulledKeys.length > 1 && (
                    <Button
                      variant="link"
                      onClick={() => checkAll(unpulledKeys)}
                      aria-label={`Pulled all: ${g.label}`}
                      className="pull-list-group-all"
                    >
                      Pulled all
                    </Button>
                  )}
                </div>
                <ul className="pull-list-rows" role="list">
                  {g.rows.map((r, i) =>
                    pullable && r.card ? (
                      <li key={r.key}>
                        <CardRow
                          card={r.card}
                          qty={r.qty}
                          allocations={[]}
                          menu={null}
                          binders={[]}
                          location={r.spots ? formatLocationSpan(r.spots) : undefined}
                          selectMode
                          selected={checked.has(rowKey(g, r.key))}
                          onActivate={() => toggle(rowKey(g, r.key))}
                          isLastRow={i === g.rows.length - 1}
                        />
                      </li>
                    ) : (
                      <li key={r.key} className="pull-list-static-row">
                        <span className="pull-list-static-name">{r.name}</span>
                        {r.qty > 1 && <span className="pull-list-static-qty">×{r.qty}</span>}
                        <span className="pull-list-static-note">
                          {g.kind === 'elsewhere' && r.owners
                            ? `In ${r.owners.join(', ')}`
                            : 'No free copy in your collection'}
                        </span>
                      </li>
                    )
                  )}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
