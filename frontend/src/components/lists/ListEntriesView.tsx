import { Plus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ListDef } from '@/types/index';
import { useEnrichedListEntries } from '@/lib/collection/use-enriched-list-entries';
import { dynamicListRows, isRuleEmpty } from '@/lib/collection/dynamic-list';
import { useCardsWithTags, groupsUseTags } from '@/lib/cards/card-tags';
import { summarizeListCost } from '@/lib/collection/list-cost';
import { isTrackingList } from '@/lib/collection/lists';
import { formatMoney } from '@/lib/collection/format-money';
import { useCollectionStore } from '@/store/collection';
import { BackLink } from '@/components/app-shell/BackLink';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { InfoTip } from '@/components/overlays/InfoTip';
import { ListDetailView } from './ListDetailView';
import { ListAddCardSheet } from './ListAddCardSheet';
import { ListRuleEditor } from './ListRuleEditor';
import { InlineRename } from '@/components/shared/InlineRename';

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
 * Tracking lists (static, `kind: 'tracking'`) keep the manual flows but drop
 * the acquisition framing: instead of a cost to complete, the header flags
 * entries that aren't in the collection (ownership drift).
 *
 * `useEnrichedListEntries` is called once here (not inside `ListDetailView`)
 * so the header's acquisition-cost stat and the table share one name
 * resolution pass instead of double-fetching the same cards.
 */
export function ListEntriesView({ list }: Props) {
  const isDynamic = list.rule !== undefined;
  const tracking = !isDynamic && isTrackingList(list);
  const rule = list.rule ?? EMPTY_RULE;
  // Auto-open the rule editor for a freshly created dynamic list (no rule
  // yet) so creation flows straight into defining what belongs here.
  const [ruleOpen, setRuleOpen] = useState(() => isDynamic && isRuleEmpty(rule));
  const [addOpen, setAddOpen] = useState(false);
  const renameList = useCollectionStore((s) => s.renameList);

  // The index row's "Rename" menu item is a shortcut that navigates here and
  // puts the title straight into edit mode (STYLE_GUIDE § Verbs — Rename),
  // instead of a modal. Consume the hand-off once, then drop it from history
  // so a back-nav or refresh doesn't reopen the editor.
  const location = useLocation();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(
    () => !!(location.state as { autoRename?: boolean } | null)?.autoRename
  );
  useEffect(() => {
    if ((location.state as { autoRename?: boolean } | null)?.autoRename) {
      navigate(location.pathname, { replace: true });
    }
    // Only ever consume the hand-off once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ownedCards = useCollectionStore((s) => s.cards);
  // Static lists resolve their stored printings; dynamic lists never fetch —
  // their rows ARE collection cards. Each path gets an empty input when the
  // other is active.
  const {
    rows: entryRows,
    loading: entriesLoading,
    loadingLong: entriesLoadingLong,
    retry: retryEntries,
  } = useEnrichedListEntries(isDynamic ? [] : list.entries);
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
      <BackLink to="/collection/lists" label="All lists" />
      <PageHeader
        title={
          // renameLabel carries the list's own name (not a bare "Rename
          // list") so a screen-reader user tabbing straight to this button
          // hears which list, not just the verb.
          <InlineRename
            value={list.name}
            onCommit={(name) => renameList(list.id, name)}
            editing={renaming}
            onEditingChange={setRenaming}
            label="List name"
            renameLabel={`Rename ${list.name}`}
          />
        }
        actions={[
          isDynamic
            ? {
                label: 'Edit rule',
                icon: SlidersHorizontal,
                primary: true,
                onClick: () => setRuleOpen(true),
              }
            : { label: 'Add card', icon: Plus, primary: true, onClick: () => setAddOpen(true) },
        ]}
        meta={
          <>
            {cardCount.toLocaleString()} {cardCount === 1 ? 'card' : 'cards'}
            {isDynamic ? (
              <>
                {copyCount > cardCount && <> · {copyCount.toLocaleString()} copies</>}
                {' · '}
                <span>
                  dynamic
                  <InfoTip
                    label="dynamic list"
                    text="Cards from your collection that match its rule."
                  />
                </span>
              </>
            ) : tracking ? (
              <>
                {' · '}
                <span>
                  tracking
                  <InfoTip label="tracking list" text="Cards you own. Never counted as wants." />
                </span>
                {list.entries.length > 0 &&
                  !loading &&
                  // Ownership drift is the one stat a tracking list needs:
                  // silence when all owned, a flag when something slipped out.
                  !cost.allOwned && (
                    <>
                      {' · '}
                      <span>{cost.unownedEntries.toLocaleString()} not in your collection</span>
                    </>
                  )}
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
                    <span>you already own everything here</span>
                  ) : (
                    <span>
                      {formatMoney(cost.totalCost, { wholeDollars: true })} to complete
                      {cost.unpricedCount > 0 &&
                        ` (+${cost.unpricedCount.toLocaleString()} unpriced)`}
                      <InfoTip
                        label="cost to complete"
                        text="Scryfall market price for everything here you don't own."
                      />
                    </span>
                  )}
                </>
              )
            )}
          </>
        }
      />

      <ListDetailView
        list={list}
        rows={rows}
        loading={loading}
        loadingLong={!isDynamic && entriesLoadingLong}
        onRetry={retryEntries}
        dynamic={isDynamic}
      />

      {addOpen && !isDynamic && <ListAddCardSheet list={list} onClose={() => setAddOpen(false)} />}
      {ruleOpen && isDynamic && <ListRuleEditor list={list} onClose={() => setRuleOpen(false)} />}
    </div>
  );
}
