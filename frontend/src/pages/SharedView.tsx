import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useSignInPath } from '../lib/sign-in-path';
import { fetchPublicShare, ShareAuthRequiredError, ShareNotFoundError } from '../lib/share-client';
import type { PublicShareResponse } from '../lib/shared-types';
import { useDocumentTitle } from '../lib/use-document-title';
import { SharedCollectionView } from '../components/share/SharedCollectionView';
import { SharedBinderView } from '../components/share/SharedBinderView';
import { SharedDeckView } from '../components/share/SharedDeckView';
import { SharedListView } from '../components/share/SharedListView';
import { SharedCubeView } from '../components/share/SharedCubeView';
import { SharedShell, NotFoundView, ErrorView } from '../components/share/SharedShell';
import { DeckFeedbackView } from '../components/share/DeckFeedbackView';
import { SharedGameSummaryView } from '../components/share/SharedGameSummaryView';
import { BrandMark } from '../components/shared/BrandMark';
import { CopyDeckButton } from '../components/share/CopyDeckButton';
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
    return (
      <SharedShell>
        <NotFoundView />
      </SharedShell>
    );
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

  // Undefined until the share loads — the hook no-ops until then, so the tab
  // keeps whatever title it already had through the loading/error states.
  useDocumentTitle(state.status === 'ready' ? sharedViewTitle(state.payload) : undefined);

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
          <Link to={signInHref} className="btn btn-primary shared-copy-btn">
            Sign in
          </Link>
        </main>
      </SharedShell>
    );
  }
  if (state.status === 'error') {
    return (
      <SharedShell>
        <ErrorView message={state.message} />
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
  if (payload.kind === 'game-result') {
    return (
      <SharedShell>
        <SharedGameSummaryView data={payload.data} token={token} />
      </SharedShell>
    );
  }
  return (
    <SharedShell>
      <SharedListView data={payload.data} />
    </SharedShell>
  );
}
