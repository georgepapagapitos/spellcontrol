import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchPublicDeckPage,
  fetchPublicShare,
  PublicDeckNotFoundError,
  ShareAuthRequiredError,
  ShareForbiddenError,
  ShareNotFoundError,
} from '../lib/share-client';
import type { PublicDeck } from '../lib/shared-types';
import { publicDeckToDeck } from '../lib/public-deck-to-deck';
import { PlaytestSession } from '@/playtest/components/PlaytestSession';
import { NotFoundView, ErrorView } from '../components/share/SharedShell';
import { BrandMark } from '../components/shared/BrandMark';
import { useDocumentTitle } from '../lib/use-document-title';
import { userMessage } from '@/lib/user-error';
import '@/styles/playtest.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'authRequired' }
  | { status: 'error'; message: string }
  | { status: 'ready'; deck: PublicDeck };

/**
 * Goldfish a deck you don't own, at `/d/:slug/playtest` and
 * `/s/:token/playtest`. A normal page inside <Layout>, exactly like the
 * owner's /decks/:id/playtest: the board is position:fixed over the chrome
 * either way, and the host is what gives the page its <main> landmark — a
 * bare mount had none (playtest batch 11).
 *
 * Trying out a deck is the single most useful thing a shared link can offer a
 * reader, and it's what every comparable site lets you do. The session runs
 * entirely on the visitor's device: the payload is adapted by
 * `lib/public-deck-to-deck.ts` and handed to the SAME `PlaytestSession` the
 * owner's own playtest uses, marked `external` so the playtest store never
 * tries (and fails) to resolve the deck out of the viewer's decks store.
 *
 * Nothing here writes to the visitor's decks or collection — the adapted deck
 * is local to this page, under a `public:`-namespaced id.
 */
export function PublicDeckPlaytestPage() {
  const { slug, token } = useParams<{ slug?: string; token?: string }>();
  const sourceKey = slug ?? token;
  if (!sourceKey) {
    return <NotFoundView />;
  }
  // Remount per link so the load + session start fresh, mirroring the
  // token/slug-keyed remount the deck pages themselves use.
  return <PublicDeckPlaytestInner key={sourceKey} sourceKey={sourceKey} isSlug={!!slug} />;
}

function PublicDeckPlaytestInner({ sourceKey, isSlug }: { sourceKey: string; isSlug: boolean }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = isSlug
      ? fetchPublicDeckPage(sourceKey).then((p) => p.deck)
      : fetchPublicShare(sourceKey).then((p) => {
          // A share token can point at any kind of resource; only a deck is
          // playable, and anything else is a wrong URL rather than an error.
          if (p.kind !== 'deck') throw new ShareNotFoundError();
          return p.data;
        });
    load
      .then((deck) => {
        if (!cancelled) setState({ status: 'ready', deck });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof PublicDeckNotFoundError || err instanceof ShareNotFoundError) {
          setState({ status: 'notFound' });
        } else if (err instanceof ShareAuthRequiredError || err instanceof ShareForbiddenError) {
          setState({ status: 'authRequired' });
        } else {
          setState({
            status: 'error',
            message: userMessage(err, "Couldn't load this deck. Check the link and try again."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey, isSlug]);

  useDocumentTitle(state.status === 'ready' ? `Playtest: ${state.deck.name}` : undefined);

  // Hooks run unconditionally, so this adapts an absent deck to null until the
  // payload lands; the session below is only rendered once it's real.
  const deck = useMemo(
    () => (state.status === 'ready' ? publicDeckToDeck(state.deck, sourceKey) : null),
    [state, sourceKey]
  );

  const backTo = isSlug ? `/d/${sourceKey}` : `/s/${sourceKey}`;

  if (state.status === 'loading') {
    return (
      <div className="shared-view shared-view--loading" aria-busy="true">
        <BrandMark size={64} motion="busy" aria-hidden />
        <p>Loading deck…</p>
      </div>
    );
  }
  if (state.status === 'notFound') {
    return (
      <NotFoundView
        title="Deck not found"
        message="This deck isn't shared anymore, or the link is wrong."
      />
    );
  }
  if (state.status === 'authRequired') {
    return (
      <NotFoundView
        title="Friends only"
        message="The owner shared this with their friends. Sign in as one of them to play it."
      />
    );
  }
  if (state.status === 'error') {
    return <ErrorView message={state.message} />;
  }

  return (
    <PlaytestSession
      deck={deck!}
      external
      back={{ label: state.deck.name, to: backTo }}
      title="Playtest"
      emptyHint="This deck has no cards in it yet, so there's nothing to draw."
    />
  );
}
