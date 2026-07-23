import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../store/auth';
import { isOnline, onSyncedChange } from './sync';
import { updateProfile } from './auth-api';
import {
  DeckNotSyncedYetError,
  DisplayNameRequiredError,
  publicationUrl,
  publishDeck,
  type PublishResult,
} from './publications-client';
import { toast } from '../store/toasts';

export type CreateVisibility = 'private' | 'public';

/** Handed to `onSettled` only when a publish attempt actually succeeded. */
export interface PublishOutcome {
  isFirstPublish: boolean;
}

/** How long a freshly-created deck's fire-and-forget local persist typically
 *  takes to reach the server (see publishWithSyncRetry below) — comfortably
 *  more than a signed-in web session's immediate write-through, and more
 *  than the native/guest debounced queue's 500ms window. */
const SYNC_CATCH_UP_MS = 600;

/**
 * `publishDeck()`, tolerant of the one race every creation-time publish
 * attempt is exposed to: `createDeck()`'s persist-to-server is fire-and-
 * forget from the store's own subscriber (store/decks.ts) — there is no
 * promise a caller can await to know the deck has actually reached the
 * server. Firing `publishDeck()` immediately after `createDeck()` can
 * therefore reach the server before the deck itself does, 404ing with "Deck
 * not found." (caught live via browser validation — a mocked publishDeck in
 * a unit test can't reproduce it). A single bounded retry after a short
 * delay is far simpler and more robust than teaching this hook to couple to
 * sync.ts's internals (E22 — audit before building anything sync-adjacent);
 * by the second attempt the deck has always landed.
 */
async function publishWithSyncRetry(deckId: string): Promise<PublishResult> {
  try {
    return await publishDeck(deckId);
  } catch (err) {
    if (!(err instanceof DeckNotSyncedYetError)) throw err;
    await new Promise((r) => setTimeout(r, SYNC_CATCH_UP_MS));
    return await publishDeck(deckId);
  }
}

/**
 * Shared creation-time "publish on create" flow — the exact choke point
 * DeckNewPage's Private/Public fieldset (#1278) already used, now reused by
 * ImportDeckDialog's single-deck path (E150) so this network/error dance
 * doesn't fork into a second, slowly-drifting copy. Owns: guest/offline
 * gating for the fieldset, the `display_name_required` inline substep
 * (exactly one retry, mirroring ShareDialog's own fallback), and the success
 * toast.
 *
 * Deliberately does NOT fire the first-publish seal moment itself — every
 * caller navigates away the instant a publish resolves (straight to the new
 * deck's editor), which would unmount the portal mid-animation. Instead it
 * hands `PublishOutcome` to `onSettled`, whose caller threads it to wherever
 * the flow actually lands (DeckEditorPage's `justPublished` router state),
 * which is the real choke point for `shouldCelebrateFirstPublish`.
 */
export function usePublishOnCreate(onSettled: (deckId: string, outcome?: PublishOutcome) => void) {
  const isGuest = useAuth((s) => s.status === 'guest');
  const [, forceOnlineTick] = useState(0);
  useEffect(() => onSyncedChange(() => forceOnlineTick((n) => n + 1)), []);
  const online = isOnline();
  const canPublish = !isGuest && online;
  const publicDisabledReason = isGuest
    ? 'Sign in to publish.'
    : !online
      ? "You're offline — reconnect to publish."
      : null;

  const [visibility, setVisibility] = useState<CreateVisibility>('private');
  // Never leave Public selected-but-disabled (e.g. connectivity drops after
  // it was chosen) — snap back to Private during render, mirroring
  // DeckNewPage's identical guarded render-time setState (terminating, so
  // react-hooks/set-state-in-effect doesn't apply — there's no effect here).
  if (!canPublish && visibility === 'public') {
    setVisibility('private');
  }

  const [publishing, setPublishing] = useState(false);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [pendingPublishId, setPendingPublishId] = useState<string | null>(null);

  const announcePublished = (slug: string) => {
    toast.show({
      message: `Published — anyone can view it at ${publicationUrl(slug)}`,
      tone: 'success',
    });
  };

  /** Publish a just-created deck. On display_name_required, hold off calling
   *  onSettled and show the inline set-name substep; any other failure just
   *  toasts a warning — the deck already exists, so a failed publish never
   *  blocks getting to it. */
  const publishAfterCreate = useCallback(
    async (deckId: string) => {
      setPublishing(true);
      try {
        const pub = await publishWithSyncRetry(deckId);
        announcePublished(pub.slug);
        onSettled(deckId, { isFirstPublish: pub.isFirstPublish });
      } catch (err) {
        if (err instanceof DisplayNameRequiredError) {
          setPendingPublishId(deckId);
          setNeedsDisplayName(true);
        } else {
          toast.show({
            message: err instanceof Error ? err.message : 'Failed to publish deck.',
            tone: 'warn',
          });
          onSettled(deckId);
        }
      } finally {
        setPublishing(false);
      }
    },
    [onSettled]
  );

  const saveDisplayNameAndPublish = useCallback(async () => {
    const trimmed = displayNameDraft.trim();
    if (!trimmed || !pendingPublishId || publishing) return;
    setPublishing(true);
    try {
      const updated = await updateProfile({ displayName: trimmed });
      useAuth.setState((s) => (s.profile ? { profile: { ...s.profile, ...updated } } : s));
      // The display-name substep's own one retry after saving a name — not
      // to be confused with publishWithSyncRetry's inner sync-catch-up retry.
      const pub = await publishWithSyncRetry(pendingPublishId);
      announcePublished(pub.slug);
      onSettled(pendingPublishId, { isFirstPublish: pub.isFirstPublish });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't publish the deck.",
        tone: 'warn',
      });
      onSettled(pendingPublishId);
    } finally {
      setPublishing(false);
      setNeedsDisplayName(false);
    }
  }, [displayNameDraft, pendingPublishId, publishing, onSettled]);

  const cancelDisplayName = useCallback(() => {
    // Deck stays created + private — never blocks creation.
    setNeedsDisplayName(false);
    if (pendingPublishId) onSettled(pendingPublishId);
  }, [pendingPublishId, onSettled]);

  return {
    canPublish,
    publicDisabledReason,
    visibility,
    setVisibility,
    publishing,
    needsDisplayName,
    displayNameDraft,
    setDisplayNameDraft,
    publishAfterCreate,
    saveDisplayNameAndPublish,
    cancelDisplayName,
  };
}
