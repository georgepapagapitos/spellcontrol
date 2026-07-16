import { Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ListDef } from '../types';
import { useEnrichedListEntries } from '../lib/use-enriched-list-entries';
import { dynamicListRows, isRuleEmpty } from '../lib/dynamic-list';
import { useCardsWithTags, groupsUseTags } from '../lib/card-tags';
import { summarizeListCost } from '../lib/list-cost';
import { formatMoney } from '../lib/format-money';
import { useCollectionStore } from '../store/collection';
import { ListDetailView } from './ListDetailView';
import { ListAddCardSheet } from './ListAddCardSheet';
import { ListRuleEditor } from './ListRuleEditor';

interface Props {
  list: ListDef;
}

const EMPTY_RULE: NonNullable<ListDef['rule']> = [];

/**
 * Per-list detail page. The card table (`ListDetailView`) reuses the
 * collection's filter dialog, sort, view toggle, rows, preview — and its
 * inline "Search Scryfall to add" affordance (the list search doubles as the
 * add query). An explicit "Add card" button opens that same search-and-add
 * flow in a sheet, so adding works even on an empty list.
 *
 * Dynamic lists (`list.rule` set) swap all of that for live membership: rows
 * are the owned collection copies matching the rule (exact printings by
 * construction), "Add card" becomes "Edit rule", and the cost stat is skipped
 * — everything in a dynamic list is already owned.
 *
 * `useEnrichedListEntries` is called once here (not inside `ListDetailView`)
 * so the header's acquisition-cost stat and the table share one name
 * resolution pass instead of double-fetching the same cards.
 */
export function ListEntriesView({ list }: Props) {
  const isDynamic = list.rule !== undefined;
  const rule = list.rule ?? EMPTY_RULE;
  // Auto-open the rule editor for a freshly created dynamic list (no rule
  // yet) so creation flows straight into defining what belongs here.
  const [ruleOpen, setRuleOpen] = useState(() => isDynamic && isRuleEmpty(rule));
  const [addOpen, setAddOpen] = useState(false);

  const ownedCards = useCollectionStore((s) => s.cards);
  // Static lists resolve their stored printings; dynamic lists never fetch —
  // their rows ARE collection cards. Each path gets an empty input when the
  // other is active.
  const { rows: entryRows, loading: entriesLoading } = useEnrichedListEntries(
    isDynamic ? [] : list.entries
  );
  // Decorate with oracle tags only when the rule needs them (same lazy gate
  // as the binder pages), so tag rules count correctly once the snapshot loads.
  const taggedOwned = useCardsWithTags(ownedCards, isDynamic && groupsUseTags(rule));
  const dynamicRows = useMemo(
    () => (isDynamic ? dynamicListRows(taggedOwned, rule) : []),
    [isDynamic, taggedOwned, rule]
  );

  const rows = isDynamic ? dynamicRows : entryRows;
  const loading = isDynamic ? false : entriesLoading;
  const cost = useMemo(
    () => summarizeListCost(isDynamic ? [] : entryRows, ownedCards),
    [isDynamic, entryRows, ownedCards]
  );

  const cardCount = isDynamic ? rows.length : list.entries.length;
  const copyCount = useMemo(
    () => (isDynamic ? rows.reduce((n, r) => n + r.entry.quantity, 0) : 0),
    [isDynamic, rows]
  );

  return (
    <div className="binders-index-page">
      <header className="binder-hero binders-index-hero">
        <div className="binders-index-hero-text">
          <h1 className="binder-hero-name">{list.name}</h1>
          <p className="binder-hero-meta">
            {cardCount.toLocaleString()} {cardCount === 1 ? 'card' : 'cards'}
            {isDynamic ? (
              <>
                {copyCount > cardCount && <> · {copyCount.toLocaleString()} copies</>}
                {' · '}
                <span title="This list is rule-driven — cards from your collection that match the rule appear here automatically">
                  dynamic — stays in sync with your collection
                </span>
              </>
            ) : (
              list.entries.length > 0 && (
                <>
                  {' · '}
                  {loading ? (
                    <span className="collection-hero-pricing" aria-live="polite">
                      <span className="sync-indicator-spinner" aria-hidden="true" />
                      Pricing…
                    </span>
                  ) : cost.allOwned ? (
                    <span title="Every copy on this list is already in your collection">
                      you already own everything here
                    </span>
                  ) : (
                    <span title="Cost to buy everything on this list you don't already own (Scryfall market price)">
                      {formatMoney(cost.totalCost, { wholeDollars: true })} to complete
                      {cost.unpricedCount > 0 &&
                        ` (+${cost.unpricedCount.toLocaleString()} unpriced)`}
                    </span>
                  )}
                </>
              )
            )}
          </p>
        </div>
        <div className="binders-index-actions">
          <Link to="/collection/lists" className="pill-btn">
            <span>Back to lists</span>
          </Link>
          {isDynamic ? (
            <button
              type="button"
              className="pill-btn pill-btn-primary"
              onClick={() => setRuleOpen(true)}
            >
              <SlidersHorizontal width={14} height={14} strokeWidth={1.8} aria-hidden />
              <span>Edit rule</span>
            </button>
          ) : (
            <button
              type="button"
              className="pill-btn pill-btn-primary"
              onClick={() => setAddOpen(true)}
            >
              <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
              <span>Add card</span>
            </button>
          )}
        </div>
      </header>

      <ListDetailView list={list} rows={rows} loading={loading} dynamic={isDynamic} />

      {addOpen && !isDynamic && <ListAddCardSheet list={list} onClose={() => setAddOpen(false)} />}
      {ruleOpen && isDynamic && <ListRuleEditor list={list} onClose={() => setRuleOpen(false)} />}
    </div>
  );
}
