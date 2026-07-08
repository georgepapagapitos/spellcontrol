import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { fetchPublicShare, ShareAuthRequiredError, ShareNotFoundError } from '../lib/share-client';
import type { PublicShareResponse } from '../lib/shared-types';
import { SharedCollectionView } from '../components/shared/SharedCollectionView';
import { SharedBinderView } from '../components/shared/SharedBinderView';
import { SharedDeckView } from '../components/shared/SharedDeckView';
import { SharedListView } from '../components/shared/SharedListView';
import { SharedCubeView } from '../components/shared/SharedCubeView';
import { SharedShell } from '../components/shared/SharedShell';
import { DeckFeedbackView } from '../components/shared/DeckFeedbackView';
import { BrandMark } from '../components/shared/BrandMark';
import { CopyDeckButton } from '../components/shared/CopyDeckButton';
import { CopyCubeButton } from '../components/shared/CopyCubeButton';

/**
 * Public read-only view for /s/:token. Fetches via the unauthed public
 * endpoint and renders a per-kind view. **Does not write to any zustand
 * store** — the sync invariants require the owner's stores stay isolated
 * from anyone else's data we happen to load.
 */
export function SharedView() {
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return (
      <SharedShell>
        <NotFoundView />
      </SharedShell>
    );
  }
  // Remount on token change so per-link state is fresh and the effect runs once.
  return <SharedViewInner key={token} token={token} />;
}

function NotFoundView() {
  return (
    <main className="shared-view shared-view--missing">
      <h1>Link not found</h1>
      <p>This share link is invalid or has been revoked.</p>
      <Link to="/" className="btn btn-primary shared-copy-btn">
        Go to SpellControl
      </Link>
    </main>
  );
}

function SharedViewInner({ token }: { token: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'authRequired' }
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
        } else if (err instanceof ShareAuthRequiredError) {
          setState({ status: 'authRequired' });
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
  if (state.status === 'authRequired') {
    return (
      <SharedShell>
        <main className="shared-view shared-view--missing">
          <h1>Friends only</h1>
          <p>The owner shared this with their friends. Sign in to view it.</p>
          <Link to="/auth" className="btn btn-primary shared-copy-btn">
            Sign in
          </Link>
        </main>
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
  if (payload.kind === 'collection') {
    return (
      <SharedShell>
        <SharedCollectionView data={payload.data} />
      </SharedShell>
    );
  }
  if (payload.kind === 'binder') {
    return (
      <SharedShell>
        <SharedBinderView data={payload.data} />
      </SharedShell>
    );
  }
  if (payload.kind === 'deck') {
    return (
      <SharedShell action={<CopyDeckButton data={payload.data} variant="bar" />}>
        <SharedDeckView data={payload.data} />
      </SharedShell>
    );
  }
  if (payload.kind === 'feedback') {
    return (
      <SharedShell>
        <DeckFeedbackView data={payload.data} token={token} />
      </SharedShell>
    );
  }
  if (payload.kind === 'cube') {
    return (
      <SharedShell action={<CopyCubeButton data={payload.data} />}>
        <SharedCubeView data={payload.data} />
      </SharedShell>
    );
  }
  return (
    <SharedShell>
      <SharedListView data={payload.data} />
    </SharedShell>
  );
}
