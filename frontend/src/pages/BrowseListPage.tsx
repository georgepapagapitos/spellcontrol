import './BrowseListPage.css';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '@/components/BackLink';
import { NotFoundPage } from '@/components/NotFoundPage';
import { PageHeader } from '@/components/PageHeader';
import { BrowseListFilters } from '@/components/browse/BrowseListFilters';
import { BrowseTile, BrowseTileSkeleton } from '@/components/browse/BrowseTile';
import { useOwnedNames } from '@/lib/discover/use-owned-names';
import { EdhrecSource } from '@/components/browse/EdhrecSource';
import { useBrowsePreview } from '@/components/browse/use-browse-preview';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  browseFiltersToParams,
  browseListDef,
  effectivePeriod,
  isOwnedName,
  loadBrowseList,
  parseBrowseFilters,
  type BrowseFilters,
  type BrowseItem,
  type BrowseListDef,
  type EdhrecProvenance,
} from '@/lib/discover/browse-lists';
import { colorComboName } from '@/lib/deck/commander-finder';
import { EDHREC_TOP_TYPES, type EdhrecTopPeriod } from '@/lib/discover/edhrec-top';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { userMessage } from '@/lib/util/user-error';
import { useAuth } from '@/store/auth';

const SKELETON_TILES = 18;

const PERIOD_PHRASE: Record<EdhrecTopPeriod, string> = {
  week: 'this week',
  month: 'this month',
  year: 'over the past 2 years',
};

/** "Azorius", "mono-white", "colorless", or nothing: the colour filter as it
 *  reads mid-sentence (a guild keeps its capital, a description doesn't). */
function colorPhrase(colors: string): string {
  const name = colorComboName([...colors]);
  return /^(Mono|Five|Colorless)/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

/** The one line under the title: what the list is, filters included, in the
 *  words a player would use for it. */
function listMeta(def: BrowseListDef, filters: BrowseFilters): string {
  const period = PERIOD_PHRASE[effectivePeriod(filters)];
  const color = colorPhrase(filters.colors);
  const lead = (noun: string) => ['The', color, noun].filter(Boolean).join(' ');
  switch (def.id) {
    case 'commanders':
      return `${lead('commanders')} most built on EDHREC ${period}.`;
    case 'cards': {
      const type = EDHREC_TOP_TYPES.find((t) => t.value === filters.type)?.label.toLowerCase();
      return `${lead(type ?? 'cards')} most played on EDHREC ${period}.`;
    }
    case 'salt':
      return "The cards players least like to face, scored 0 to 4 by EDHREC's community.";
    case 'new-commanders':
      return 'Commanders from the newest sets, newest first.';
    case 'game-changers':
      return 'Cards Wizards limits by bracket: none in brackets 1 and 2, up to three in bracket 3.';
    case 'banned':
      return 'Cards a Commander deck is not allowed to run.';
  }
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'done';
      items: BrowseItem[];
      page: number;
      hasMore: boolean;
      loadingMore: boolean;
      moreError: string | null;
      edhrec?: EdhrecProvenance;
    };

/**
 * One browse list in full (`/search/top/:list`): up to 100 of EDHREC's
 * popularity list, or Scryfall's list paged through, as card tiles with the
 * list's stat under each. The filters live in the URL so a list is a link.
 */
export function BrowseListPage() {
  const { list } = useParams();
  const def = browseListDef(list);
  const status = useAuth((s) => s.status);
  if (!def) return <NotFoundPage homePath={status === 'authed' ? '/home' : '/collection'} />;
  return <BrowseList key={def.id} def={def} />;
}

function BrowseList({ def }: { def: BrowseListDef }) {
  useDocumentTitle(def.title);
  const [params, setParams] = useSearchParams();
  const filters = parseBrowseFilters(params, def);
  const setFilters = (next: BrowseFilters) =>
    setParams(browseFiltersToParams(next), { replace: true });

  const owned = useOwnedNames();
  const hasCollection = owned.size > 0;
  // A paged list only holds what's been loaded, so "in my collection" would
  // quietly mean "in the pages so far"; it isn't offered there.
  const ownedFilter = hasCollection && !def.paged;
  const ownedOnly = ownedFilter && filters.ownedOnly;
  const preview = useBrowsePreview(def);

  // What the server is asked for; the owned filter is ours to apply.
  const period = effectivePeriod(filters);
  const { colors, type } = filters;
  const query = `${period}|${colors}|${type}`;
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setState({ status: 'loading' });
  }

  useEffect(() => {
    let cancelled = false;
    loadBrowseList(def.id, { period, colors, type, ownedOnly: false }).then(
      (page) => {
        if (cancelled) return;
        setState({
          status: 'done',
          items: page.items,
          page: 1,
          hasMore: page.hasMore,
          loadingMore: false,
          moreError: null,
          edhrec: page.edhrec,
        });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: userMessage(err, "Couldn't load this list.") });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [def.id, period, colors, type, attempt]);

  const loadMore = () => {
    if (state.status !== 'done' || state.loadingMore) return;
    const nextPage = state.page + 1;
    setState({ ...state, loadingMore: true, moreError: null });
    loadBrowseList(def.id, { period, colors, type, ownedOnly: false }, nextPage).then(
      (page) =>
        setState((prev) =>
          prev.status === 'done'
            ? {
                ...prev,
                items: [...prev.items, ...page.items],
                page: nextPage,
                hasMore: page.hasMore,
                loadingMore: false,
              }
            : prev
        ),
      (err: unknown) =>
        setState((prev) =>
          prev.status === 'done'
            ? {
                ...prev,
                loadingMore: false,
                moreError: userMessage(err, "Couldn't load more of this list."),
              }
            : prev
        )
    );
  };

  const shown =
    state.status !== 'done'
      ? []
      : ownedOnly
        ? state.items.filter((i) => isOwnedName(owned, i.name))
        : state.items;

  const hasServerFilters = colors !== '' || type !== '';

  return (
    <div className="browse-list-page">
      <BackLink to="/search" label="Search" />
      <PageHeader title={def.title} meta={listMeta(def, filters)} />

      <BrowseListFilters
        def={def}
        filters={filters}
        ownedFilter={ownedFilter}
        onChange={setFilters}
      />

      {state.status === 'loading' ? (
        <>
          <p role="status" className="sr-only">
            Loading {def.title.toLowerCase()}…
          </p>
          <ul className="browse-grid" aria-hidden="true">
            {Array.from({ length: SKELETON_TILES }, (_, i) => (
              <li key={i}>
                <BrowseTileSkeleton caption={def.id !== 'game-changers' && def.id !== 'banned'} />
              </li>
            ))}
          </ul>
        </>
      ) : state.status === 'error' ? (
        <div className="discover-decks-error" role="alert">
          <span>{state.message}</span>
          <Button
            className="discover-decks-error-retry"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : shown.length === 0 ? (
        ownedOnly && state.items.length > 0 ? (
          <EmptyState
            tagline="None of these are in your collection."
            actions={
              <Button onClick={() => setFilters({ ...filters, ownedOnly: false })}>Show all</Button>
            }
          />
        ) : (
          <EmptyState
            tagline={
              def.source === 'edhrec'
                ? 'EDHREC has no list for this yet.'
                : 'Nothing on this list yet.'
            }
            actions={
              hasServerFilters ? (
                <Button onClick={() => setFilters({ ...filters, colors: '', type: '' })}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <ul className="browse-grid" aria-label={def.title}>
            {shown.map((item) => (
              <li key={item.name}>
                <BrowseTile
                  list={def.id}
                  item={item}
                  owned={isOwnedName(owned, item.name)}
                  onOpen={() => preview.open(shown, item.name)}
                />
              </li>
            ))}
          </ul>
          {state.hasMore && (
            <div className="browse-list-more">
              {state.moreError && (
                <p className="browse-list-more-error" role="alert">
                  {state.moreError}
                </p>
              )}
              <Button onClick={loadMore} disabled={state.loadingMore}>
                {state.loadingMore ? 'Loading…' : state.moreError ? 'Retry' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}

      {state.status === 'done' && state.edhrec && <EdhrecSource provenance={state.edhrec} />}
      {preview.preview}
    </div>
  );
}
