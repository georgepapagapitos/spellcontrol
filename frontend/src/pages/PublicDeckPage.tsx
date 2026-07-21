import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchPublicDeckPage,
  PublicDeckNotFoundError,
  recordDeckView,
  type PublicDeckPage as PublicDeckPageData,
} from '../lib/share-client';
import { SharedShell } from '../components/shared/SharedShell';
import { SharedDeckView } from '../components/shared/SharedDeckView';
import { BrandMark } from '../components/shared/BrandMark';
import { NotFoundView } from '../components/shared/SharedShell';
import { useAuth } from '../store/auth';
import { useOwnershipLens } from '../lib/use-ownership-lens';
import { OwnershipLensStrip } from '../components/deck/OwnershipLensStrip';
import type { PublicDeckCard } from '../lib/shared-types';

// Stable empty array — passed to useOwnershipLens before the deck has
// loaded, so its useMemo deps don't thrash on a fresh [] literal every render.
const EMPTY_DECK_CARDS: PublicDeckCard[] = [];

function alreadyViewedThisSession(slug: string): boolean {
  try {
    return sessionStorage.getItem(`viewed:${slug}`) != null;
  } catch {
    return false;
  }
}

function markViewedThisSession(slug: string): void {
  try {
    sessionStorage.setItem(`viewed:${slug}`, '1');
  } catch {
    // sessionStorage unavailable — the dedupe just won't persist this session.
  }
}

/**
 * Public read-only page for a published deck at /d/:slug. Fetches via the
 * unauthenticated public-reads endpoint (no audience gating, unlike
 * /s/:token) and renders the same SharedShell/SharedDeckView chrome that
 * page uses, threading the additive `publicMeta` prop for the owner-profile
 * link, view/copy counts, and Report action.
 */
export function PublicDeckPage() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) {
    return (
      <SharedShell>
        <NotFoundView />
      </SharedShell>
    );
  }
  // Remount on slug change so per-page state (and the view-beacon dedupe
  // effect) is fresh, mirroring SharedView.tsx's token-keyed remount.
  return <PublicDeckPageInner key={slug} slug={slug} />;
}

function PublicDeckPageInner({ slug }: { slug: string }) {
  const authUsername = useAuth((s) => s.user?.username);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'error'; message: string }
    | { status: 'ready'; payload: PublicDeckPageData }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchPublicDeckPage(slug)
      .then((payload) => {
        if (!cancelled) setState({ status: 'ready', payload });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof PublicDeckNotFoundError) {
          setState({ status: 'notFound' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load this deck.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // View beacon: fires at most once per tab session per slug (sessionStorage
  // dedupe, so a refresh doesn't double-count), and never for the deck's own
  // owner — an owner revisiting in a new session must not be able to inflate
  // their own count past the ghost-town-hide threshold. The server
  // independently excludes the owner too (routes/public.ts's optionalAuth
  // check), so this is belt-and-suspenders for honesty + skipping a
  // pointless request, not the sole guard.
  useEffect(() => {
    if (state.status !== 'ready') return;
    if (authUsername && authUsername === state.payload.deck.ownerUsername) return;
    if (alreadyViewedThisSession(slug)) return;
    markViewedThisSession(slug);
    void recordDeckView(slug);
  }, [state, slug, authUsername]);

  // Hooks must run unconditionally (before the early returns below), so this
  // computes over an empty array until the deck has loaded — cheap, and the
  // strip is never actually rendered during the loading/notFound/error states.
  const deckCards = state.status === 'ready' ? state.payload.deck.cards : EMPTY_DECK_CARDS;
  const {
    lens,
    missingCost,
    missingCardPrices,
    loading: lensLoading,
  } = useOwnershipLens(deckCards);

  if (state.status === 'loading') {
    return (
      <SharedShell>
        <main className="shared-view shared-view--loading" aria-busy="true">
          <BrandMark size={64} motion="busy" aria-hidden />
          <p>Loading…</p>
        </main>
      </SharedShell>
    );
  }
  if (state.status === 'notFound') {
    return (
      <SharedShell>
        <NotFoundView />
      </SharedShell>
    );
  }
  if (state.status === 'error') {
    return (
      <SharedShell>
        <main className="shared-view shared-view--error">
          <h1>Something went wrong</h1>
          <p>{state.message}</p>
          <Link to="/" className="btn btn-primary shared-copy-btn">
            Go to SpellControl
          </Link>
        </main>
      </SharedShell>
    );
  }

  const { payload } = state;
  return (
    <SharedShell>
      <div className="shared-view ownership-lens-view-slot">
        <OwnershipLensStrip
          lens={lens}
          missingCost={missingCost}
          missingCardPrices={missingCardPrices}
          loading={lensLoading}
        />
      </div>
      <SharedDeckView
        data={payload.deck}
        publicMeta={{
          slug: payload.slug,
          deckId: payload.deck.id,
          viewCount: payload.viewCount,
          copyCount: payload.copyCount,
        }}
        ownership={lens?.perCard}
      />
    </SharedShell>
  );
}
