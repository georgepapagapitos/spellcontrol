import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useSignInPath } from '../lib/sign-in-path';
import {
  fetchPublicShare,
  ShareAuthRequiredError,
  ShareForbiddenError,
  ShareNotFoundError,
} from '../lib/share-client';
import type { PublicShareResponse } from '../lib/shared-types';
import { useDocumentTitle } from '../lib/use-document-title';
import { SharedCollectionView } from '../components/share/SharedCollectionView';
import { SharedBinderView } from '../components/share/SharedBinderView';
import { SharedDeckSurface } from '../components/share/SharedDeckSurface';
import { SharedListView } from '../components/share/SharedListView';
import { SharedCubeView } from '../components/share/SharedCubeView';
import { NotFoundView, ErrorView } from '../components/share/SharedShell';
import { DeckFeedbackView } from '../components/share/DeckFeedbackView';
import { SharedGameSummaryView } from '../components/share/SharedGameSummaryView';
import { BrandMark } from '../components/shared/BrandMark';
import { CopyCubeButton } from '../components/share/CopyCubeButton';

import { userMessage } from '@/lib/user-error';
/** Tab title per share kind — every kind but `collection` carries its own
 *  owner-given name; `collection` has none, so it falls back to the same
 *  "Collection" label the page itself renders as its `<h1>`. */
function sharedViewTitle(payload: PublicShareResponse): string {
  switch (payload.kind) {
    case 'collection':
      return 'Collection';
    case 'feedback':
      return `Feedback: ${payload.data.name}`;
    case 'game-result':
      return 'Game result';
    default:
      return payload.data.name;
  }
}

/**
 * Public read-only view for /s/:token. Fetches via the unauthed public
 * endpoint and renders a per-kind view. **Does not write to any zustand
 * store** — the sync invariants require the owner's stores stay isolated
 * from anyone else's data we happen to load.
 */
export function SharedView() {
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return <NotFoundView />;
  }
  // Remount on token change so per-link state is fresh and the effect runs once.
  return <SharedViewInner key={token} token={token} />;
}

function SharedViewInner({ token }: { token: string }) {
  const signInHref = useSignInPath();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'authRequired' }
    | { status: 'forbidden' }
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
        } else if (err instanceof ShareForbiddenError) {
          setState({ status: 'forbidden' });
        } else {
          setState({
            status: 'error',
            message: userMessage(
              err,
              "Couldn't load this shared page. Check the link and try again."
            ),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Undefined while the share is still loading — the hook no-ops until then, so
  // the tab keeps whatever title it already had. The gated states name
  // themselves for the same reason the dead ends do (E344): the shell arrives
  // carrying the homepage title, and a tab reading "Organize MTG binders…" over
  // a wall is the page claiming to be something it isn't.
  useDocumentTitle(
    state.status === 'ready'
      ? sharedViewTitle(state.payload)
      : state.status === 'authRequired' || state.status === 'forbidden'
        ? 'Friends only'
        : undefined
  );

  if (state.status === 'loading') {
    return (
      <div className="shared-view shared-view--loading" aria-busy="true">
        <BrandMark size={64} motion="busy" aria-hidden />
        <p>Loading…</p>
      </div>
    );
  }
  if (state.status === 'notFound') {
    return <NotFoundView />;
  }
  if (state.status === 'authRequired') {
    return (
      <div className="shared-view shared-view--missing">
        <h1>Friends only</h1>
        <p>The owner shared this with their friends. Sign in to view it.</p>
        <Link to={signInHref} className="btn btn-primary shared-copy-btn">
          Sign in
        </Link>
      </div>
    );
  }
  if (state.status === 'forbidden') {
    // A signed-in stranger. Nothing went wrong — the gate did its job — so
    // the page says what the gate means and where a friendship starts.
    return (
      <div className="shared-view shared-view--missing">
        <h1>Friends only</h1>
        <p>The owner shared this with their friends, and you aren’t on their list yet.</p>
        <Link to="/friends" className="btn btn-primary shared-copy-btn">
          Go to Friends
        </Link>
      </div>
    );
  }
  if (state.status === 'error') {
    return <ErrorView message={state.message} />;
  }

  const { payload } = state;
  if (payload.kind === 'collection') {
    return <SharedCollectionView data={payload.data} />;
  }
  if (payload.kind === 'binder') {
    return <SharedBinderView data={payload.data} />;
  }
  if (payload.kind === 'deck') {
    return <SharedDeckSurface data={payload.data} sourceKey={token} />;
  }
  if (payload.kind === 'feedback') {
    return <DeckFeedbackView data={payload.data} token={token} />;
  }
  if (payload.kind === 'cube') {
    return <SharedCubeView data={payload.data} action={<CopyCubeButton data={payload.data} />} />;
  }
  if (payload.kind === 'game-result') {
    return <SharedGameSummaryView data={payload.data} token={token} />;
  }
  return <SharedListView data={payload.data} />;
}
