import './DiscoverBrewersPage.css';
import { useEffect, useRef, useState } from 'react';
import { DecksHubTabs } from '../components/DecksHubTabs';
import { DiscoverPanel, DiscoverSwitch } from '../components/DiscoverSwitch';
import { PageHeader } from '../components/PageHeader';
import { SearchPill } from '../components/SearchPill';
import { BrewerCard, BrewerCardSkeleton } from '../components/social/BrewerCard';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { SectionHeader } from '@/components/shared/SectionHeader';
import {
  fetchBrewerRails,
  searchBrewers,
  type BrewerCard as BrewerCardData,
  type BrewerRails,
} from '@/lib/brewers-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useOverflowEdges } from '@/lib/use-overflow-edges';
import { userMessage } from '@/lib/user-error';
import { useAuth } from '../store/auth';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const SKELETON_COUNT = 4;

type Loaded<T> = { key: string; data?: T; error?: string };

/**
 * One rail: a heading and a row of brewer cards. A phone scrolls it
 * sideways with snap; wider screens lay the same cards out as a grid, so a
 * mouse never needs a horizontal wheel to see the eighth one.
 */
function BrewerRail({
  id,
  title,
  brewers,
}: {
  id: string;
  title: string;
  brewers: BrewerCardData[];
}) {
  const track = useRef<HTMLUListElement>(null);
  useOverflowEdges(track, true, brewers.length);
  return (
    <section className="brewers-rail" aria-labelledby={id}>
      <SectionHeader id={id} title={title} />
      <ul className="brewers-rail-track" ref={track}>
        {brewers.map((b) => (
          <BrewerCard key={b.username} brewer={b} />
        ))}
      </ul>
    </section>
  );
}

/**
 * /decks/discover/brewers: find a brewer by name, or browse the directory's
 * rails. A rail the server sends empty (under its people floor) renders
 * nothing at all: a thin rail advertises an empty room, so it is absent
 * until it has enough people to be worth a heading.
 */
export function DiscoverBrewersPage() {
  useDocumentTitle('Discover brewers');
  const authStatus = useAuth((s) => s.status);
  const authReady = authStatus === 'authed' || authStatus === 'guest';

  // ── Rails ──────────────────────────────────────────────────────────────
  const [railsTick, setRailsTick] = useState(0);
  const [railsResult, setRailsResult] = useState<Loaded<BrewerRails> | null>(null);
  const railsKey = `${authStatus}#${railsTick}`;
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    fetchBrewerRails()
      .then((data) => {
        if (!cancelled) setRailsResult({ key: railsKey, data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRailsResult({
          key: railsKey,
          error: userMessage(err, "Couldn't load brewers. Check your connection and try again."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, railsKey]);
  const railsLoading = !authReady || railsResult?.key !== railsKey;

  // ── Search ─────────────────────────────────────────────────────────────
  const [text, setText] = useState('');
  const query = text.trim();
  const term = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const searching = query.length >= MIN_QUERY;
  const [searchTick, setSearchTick] = useState(0);
  const [searchResult, setSearchResult] = useState<Loaded<BrewerCardData[]> | null>(null);
  const searchKey = `${term}#${searchTick}`;
  useEffect(() => {
    if (term.length < MIN_QUERY) return;
    let cancelled = false;
    searchBrewers(term)
      .then((data) => {
        if (!cancelled) setSearchResult({ key: searchKey, data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSearchResult({
          key: searchKey,
          error: userMessage(err, "Couldn't search brewers. Try again."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [term, searchKey]);
  // The debounce lags the box: until it catches up (or the answer lands) the
  // results area is loading, never showing the previous term's answer.
  const searchLoading = term !== query || searchResult?.key !== searchKey;

  const rails = railsResult?.key === railsKey ? railsResult.data : undefined;
  const railsError = railsResult?.key === railsKey ? railsResult.error : undefined;

  const railSections = rails
    ? [
        {
          id: 'brewers-rail-shared',
          title: 'Brewing your commanders',
          list: rails.sharedCommanders,
        },
        { id: 'brewers-rail-newest', title: 'Newest brewers', list: rails.newest },
        { id: 'brewers-rail-liked', title: 'Most liked brewers', list: rails.mostLiked },
        { id: 'brewers-rail-followed', title: 'Most followed brewers', list: rails.mostFollowed },
      ].filter((r) => r.list.length > 0)
    : [];
  const allEmpty = rails != null && railSections.length === 0 && rails.spotlight == null;

  let body;
  if (searching) {
    if (searchLoading) {
      body = (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            Searching brewers…
          </p>
          <ul className="brewers-results" aria-hidden="true">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <BrewerCardSkeleton key={i} variant="row" />
            ))}
          </ul>
        </>
      );
    } else if (searchResult?.error) {
      body = (
        <div className="discover-decks-error" role="alert">
          <span>{searchResult.error}</span>
          <Button
            onClick={() => setSearchTick((t) => t + 1)}
            className="discover-decks-error-retry"
          >
            Retry
          </Button>
        </div>
      );
    } else if (!searchResult?.data?.length) {
      body = (
        <EmptyState
          status
          tagline={`No brewers match “${query}”.`}
          hint="Try part of a name or a handle."
        />
      );
    } else {
      body = (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            {searchResult.data.length} {searchResult.data.length === 1 ? 'brewer' : 'brewers'} found
          </p>
          <ul className="brewers-results" aria-label="Brewers">
            {searchResult.data.map((b) => (
              <BrewerCard key={b.username} brewer={b} variant="row" />
            ))}
          </ul>
        </>
      );
    }
  } else if (railsLoading) {
    body = (
      <>
        <p role="status" aria-live="polite" className="sr-only">
          Loading brewers…
        </p>
        <div className="brewers-rail" aria-hidden="true">
          <div className="brewers-skeleton-title" />
          <ul className="brewers-rail-track">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <BrewerCardSkeleton key={i} />
            ))}
          </ul>
        </div>
      </>
    );
  } else if (railsError) {
    body = (
      <div className="discover-decks-error" role="alert">
        <span>{railsError}</span>
        <Button onClick={() => setRailsTick((t) => t + 1)} className="discover-decks-error-retry">
          Retry
        </Button>
      </div>
    );
  } else if (allEmpty) {
    body = (
      <EmptyState
        tagline="No brewers to show yet."
        hint="Publish a deck and your profile is the first one listed here."
        actions={
          <Button to="/decks" variant="link">
            Go to your decks
          </Button>
        }
      />
    );
  } else if (rails) {
    body = (
      <>
        {rails.spotlight && (
          <section className="brewers-spotlight" aria-labelledby="brewers-spotlight-title">
            <SectionHeader id="brewers-spotlight-title" title="Brewer spotlight" />
            <BrewerCard brewer={rails.spotlight} variant="featured" as="div" />
          </section>
        )}
        {railSections.map((r) => (
          <BrewerRail key={r.id} id={r.id} title={r.title} brewers={r.list} />
        ))}
      </>
    );
  }

  return (
    <div className="decks-index-page">
      <PageHeader title="Discover" meta="Public decks from the SpellControl community." />
      <DecksHubTabs />
      <DiscoverSwitch value="brewers" />
      <DiscoverPanel section="brewers">
        <SearchPill
          className="brewers-search"
          value={text}
          onChange={setText}
          placeholder="Search brewers by name or handle…"
          ariaLabel="Search brewers"
          inputProps={{ enterKeyHint: 'search', autoComplete: 'off', spellCheck: false }}
        />
        {body}
      </DiscoverPanel>
    </div>
  );
}
