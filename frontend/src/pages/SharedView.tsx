import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicShare, ShareNotFoundError } from '../lib/share-client';
import type { PublicShareResponse } from '../lib/shared-types';
import { SharedCollectionView } from '../components/shared/SharedCollectionView';
import { SharedDeckView } from '../components/shared/SharedDeckView';
import { SharedListView } from '../components/shared/SharedListView';

/**
 * Public read-only view for /s/:token. Fetches via the unauthed public
 * endpoint and renders a per-kind view. **Does not write to any zustand
 * store** — the sync invariants require the owner's stores stay isolated
 * from anyone else's data we happen to load.
 */
export function SharedView() {
  const { token } = useParams<{ token: string }>();
  if (!token) return <NotFoundView />;
  // Remount on token change so per-link state is fresh and the effect runs once.
  return <SharedViewInner key={token} token={token} />;
}

function NotFoundView() {
  return (
    <main className="shared-view shared-view--missing">
      <h1>Link not found</h1>
      <p>This share link is invalid or has been revoked.</p>
    </main>
  );
}

function SharedViewInner({ token }: { token: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'error'; message: string }
    | { status: 'ready'; payload: PublicShareResponse }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchPublicShare(token)
      .then((payload) => {
        if (!cancelled) setState({ status: 'ready', payload });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ShareNotFoundError) {
          setState({ status: 'notFound' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load shared content.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <main className="shared-view shared-view--loading" aria-busy="true">
        <p>Loading…</p>
      </main>
    );
  }
  if (state.status === 'notFound') {
    return <NotFoundView />;
  }
  if (state.status === 'error') {
    return (
      <main className="shared-view shared-view--error">
        <h1>Something went wrong</h1>
        <p>{state.message}</p>
      </main>
    );
  }

  const { payload } = state;
  if (payload.kind === 'collection') {
    return <SharedCollectionView data={payload.data} />;
  }
  if (payload.kind === 'deck') {
    return <SharedDeckView data={payload.data} />;
  }
  return <SharedListView data={payload.data} />;
}
