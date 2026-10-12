import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchPublicResourcePage,
  ShareNotFoundError,
  type PublicResourcePage as PageData,
} from '@/lib/social/share-client';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { userMessage } from '@/lib/util/user-error';
import { SharedBinderView } from '../components/share/SharedBinderView';
import { SharedListView } from '../components/share/SharedListView';
import { NotFoundView, ErrorView, LoadingView } from '../components/share/SharedShell';

type Kind = 'binder' | 'list';

/**
 * Public read-only page for a published binder (/b/:slug) or list (/l/:slug).
 * Anyone can open it; there is no audience gate (friends-only binders live at
 * /s/:token). Renders the same view a share link does, from the unauthenticated
 * public-reads endpoint. Writes to no store.
 */
function PublicResourcePage({ kind }: { kind: Kind }) {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return <NotFoundView title="Page not found" message={missingMessage(kind)} />;
  // Remount on slug change so per-page state is fresh.
  return <PublicResourcePageInner key={slug} kind={kind} slug={slug} />;
}

function missingMessage(kind: Kind): string {
  return `This ${kind} is private, was removed, or the address is wrong.`;
}

function PublicResourcePageInner({ kind, slug }: { kind: Kind; slug: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'error'; message: string }
    | { status: 'ready'; page: PageData }
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchPublicResourcePage(kind, slug)
      .then((page) => {
        if (!cancelled) setState({ status: 'ready', page });
      })
      .catch((err) => {
        if (cancelled) return;
        setState(
          err instanceof ShareNotFoundError
            ? { status: 'notFound' }
            : {
                status: 'error',
                message: userMessage(err, "Couldn't load this page. Check the link and try again."),
              }
        );
      });
    return () => {
      cancelled = true;
    };
  }, [kind, slug, attempt]);

  useDocumentTitle(state.status === 'ready' ? state.page.data.name : undefined);

  if (state.status === 'loading') return <LoadingView label={`Loading ${kind}…`} />;
  if (state.status === 'notFound') {
    return <NotFoundView title="Page not found" message={missingMessage(kind)} />;
  }
  if (state.status === 'error') {
    return (
      <ErrorView
        message={state.message}
        onRetry={() => {
          setState({ status: 'loading' });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  const { page } = state;
  return page.kind === 'binder' ? (
    <SharedBinderView data={page.data} />
  ) : (
    <SharedListView data={page.data} />
  );
}

export function PublicBinderPage() {
  return <PublicResourcePage kind="binder" />;
}

export function PublicListPage() {
  return <PublicResourcePage kind="list" />;
}
