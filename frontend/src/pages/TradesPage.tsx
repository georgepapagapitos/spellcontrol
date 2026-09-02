import './TradesPage.css';
import { SocialHubTabs } from '../components/SocialHubTabs';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { SearchPill } from '../components/SearchPill';
import { TradeOfferList } from '../components/trade/TradeOfferList';
import { listTrades, subscribeTradesChanged, type TradeOffer } from '../lib/trades-client';

import { userMessage } from '@/lib/user-error';
/**
 * `/trades` — every offer the viewer is party to, both directions, one place.
 *
 * Offers otherwise live only inside a friend's hub, so three people mid-trade
 * meant hunting person by person from Home's badge. This is the index that
 * closes that.
 *
 * Grouped by **what the viewer has to do**, not by friend: the whole reason to
 * come here is "what's waiting on me", and a per-friend grouping just rebuilds
 * the hunt one level up. Proposing still lives on the friend hub — it needs
 * that friend's collection — so this page has no composer; every row links to
 * the hub, which is also where Counter lives.
 */

const GROUPS = [
  {
    id: 'needs-you',
    title: 'Needs your answer',
    /** Incoming and still open — the only rows that are actually blocking. */
    match: (o: TradeOffer) => o.status === 'proposed' && !o.mine,
    empty: 'Nothing waiting on you right now.',
  },
  {
    id: 'waiting',
    title: 'Waiting on them',
    match: (o: TradeOffer) => o.status === 'proposed' && o.mine,
    empty: 'You have no offers out.',
  },
  {
    id: 'past',
    title: 'Settled & past',
    match: (o: TradeOffer) => o.status !== 'proposed',
    empty: 'Answered trades land here.',
  },
] as const;

/** Row count past which the page offers a filter. See `searchable` below. */
const SEARCH_THRESHOLD = 12;

/**
 * What a person actually searches this page for: a PERSON ("that trade with
 * Ruby") or a CARD ("where did my Sol Ring go"). Both sides are matched — the
 * card you gave away is as findable as the one you got.
 */
function matchesQuery(offer: TradeOffer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (offer.counterpartyDisplayName?.toLowerCase().includes(q)) return true;
  if (offer.counterpartyUsername.toLowerCase().includes(q)) return true;
  return [...offer.give, ...offer.receive].some((c) => c.name.toLowerCase().includes(q));
}

function TradesSkeleton() {
  return (
    <div className="trades-skeleton" aria-label="Loading your trades" aria-busy="true">
      <span className="trades-skeleton-bar" />
      <span className="trades-skeleton-bar" />
      <span className="trades-skeleton-bar" />
    </div>
  );
}

/** Page body wrapped so the {@link SocialHubTabs} strip sits OUTSIDE the
 *  width-capped `.trades-page` root — full-bleed and sticky, exactly like the
 *  Collection and Decks hub strips — on every return path (guest gate
 *  included) without restructuring them. */
export function TradesPage() {
  return (
    <>
      <SocialHubTabs />
      <TradesPageBody />
    </>
  );
}

function TradesPageBody() {
  const status = useAuth((s) => s.status);
  const [offers, setOffers] = useState<TradeOffer[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  // Offers are server-authoritative (two parties, no last-write-wins), so
  // every transition re-fetches rather than patching local state — same
  // contract the friend hub's own thread view keeps.
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;
    listTrades()
      .then((listing) => {
        if (cancelled) return;
        setOffers(listing.offers);
        setTruncated(listing.truncated);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOffers([]);
        setLoadError(
          userMessage(err, "Couldn't load your trades. Check your connection and try again.")
        );
      });
    return () => {
      cancelled = true;
    };
  }, [status, attempt]);

  // An offer arriving while this page is open never showed up — the page
  // fetched once on mount and then sat there. `useActivity()`, which feeds the
  // badge that sends people here, already refetches on window focus; matching
  // that cadence is also what stops the two from disagreeing, where you return
  // to the tab and the badge says 1 over a page still showing nothing.
  useEffect(() => {
    if (status !== 'authed') return;
    window.addEventListener('focus', refresh);
    // A settlement applied by the app shell changes rows on this page.
    const unsubscribe = subscribeTradesChanged(refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      unsubscribe();
    };
  }, [status, refresh]);

  if (status === 'guest') {
    return (
      <div className="trades-page">
        <header className="binder-hero">
          <div className="settings-page-hero-text">
            <h1 className="binder-hero-name">Trades</h1>
          </div>
        </header>
        <div className="friends-signin-prompt">
          <p className="friends-signin-title">Sign in to see your trades</p>
          <p className="friends-signin-body">
            Trade offers travel between accounts, so they need one on both ends.
          </p>
          <Link to="/auth" className="friends-signin-btn">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const loading = offers === null;
  const all = offers ?? [];
  // A failed load is NOT an empty collection. Without the `!loadError` guard
  // the retry banner and "No trades yet." render together, which reads as
  // "you have none" when the truth is "we don't know".
  const isEmpty = !loading && all.length === 0 && !loadError;
  // Errored with nothing to show → the banner above is the whole page. The
  // groups must not render either: their per-group empty lines ("Nothing
  // waiting on you") assert the same thing we don't actually know.
  const showGroups = !loading && all.length > 0;

  // #1532 judged a search box "noise at 3 rows" and was right; that judgement
  // was always going to expire, since history only accumulates. Re-made here
  // deliberately with a threshold instead of a yes/no: past roughly a screenful
  // the three groups stop being scannable and finding "that trade with Ruby"
  // becomes a hunt, which is the exact failure this page exists to end. Below
  // it, the box would be furniture.
  const searchable = all.length > SEARCH_THRESHOLD;
  const visible = searchable ? all.filter((o) => matchesQuery(o, query)) : all;
  const noMatches = searchable && query.trim() !== '' && visible.length === 0;

  return (
    <div className="trades-page">
      <header className="binder-hero">
        <div className="settings-page-hero-text">
          <h1 className="binder-hero-name">Trades</h1>
          <p className="binder-hero-meta">
            Every offer you’re part of, either way. Accepting settles both collections.
          </p>
        </div>
      </header>

      {loadError && (
        <div className="friends-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="friends-error-retry" onClick={refresh}>
            Retry
          </button>
        </div>
      )}

      {loading && <TradesSkeleton />}

      {isEmpty && (
        <div className="empty-state" role="status">
          <EmptyStateMark />
          <p className="empty-state-tagline">No trades yet.</p>
          <p className="empty-state-hint">
            Open a friend’s hub to see what they have and propose one — it shows up here for both of
            you until it’s answered.
          </p>
          <Link to="/friends" className="btn btn-primary">
            Find a friend to trade with
          </Link>
        </div>
      )}

      {searchable && (
        <SearchPill
          value={query}
          onChange={setQuery}
          placeholder="Search by friend or card"
          ariaLabel="Search your trades by friend or card"
          className="trades-search"
        />
      )}

      {noMatches && (
        <p className="trades-group-empty trades-no-matches" role="status">
          No trades match “{query.trim()}”.
        </p>
      )}

      {showGroups &&
        !noMatches &&
        GROUPS.map((group) => {
          const rows = visible.filter(group.match);
          return (
            <section className="trades-section" key={group.id} aria-labelledby={`${group.id}-head`}>
              <h2 className="trades-section-title" id={`${group.id}-head`}>
                {group.title}
                {/* aria-hidden like .friends-nav-link-badge: a bare "3" in the
                    section's accessible name reads as noise, and the row count
                    is already carried by the list itself. */}
                {rows.length > 0 && (
                  <span className="trades-section-count" aria-hidden="true">
                    {rows.length}
                  </span>
                )}
              </h2>
              {rows.length === 0 ? (
                // Per-group empty — text only, no brand mark. The page-level
                // empty state above owns that treatment (STYLE_GUIDE § Empty
                // states: micro/in-panel placeholders stay text-only).
                <p className="trades-group-empty">{group.empty}</p>
              ) : (
                <TradeOfferList
                  offers={rows}
                  onChanged={refresh}
                  linkCounterparty
                  label={group.title}
                />
              )}
              {/* The server returns at most 100 offers per caller. Only the
                  history group can ever reach that — the other two are open
                  offers — and it is the one that grows forever, so say so
                  rather than letting the list quietly stop. Paging was the
                  alternative and was not worth a control on three groups when
                  two of them can never need it. */}
              {group.id === 'past' && truncated && rows.length > 0 && (
                <p className="trades-group-empty trades-cap-note">
                  Showing your 100 most recent trades. Older ones aren’t listed here.
                </p>
              )}
            </section>
          );
        })}
    </div>
  );
}
