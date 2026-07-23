import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from './Modal';
import { ShareQrCode } from './shared/ShareQrCode';
import { useSealMoment } from './shared/SealMoment';
import { createShare, listShares, revokeShare, shareUrl } from '../lib/share-client';
import {
  DisplayNameRequiredError,
  getPublication,
  publicationUrl,
  publishDeck,
  unpublishDeck,
  type Publication,
} from '../lib/publications-client';
import { shouldCelebrateFirstPublish } from '../lib/first-publish-celebration';
import { updateProfile } from '../lib/auth-api';
import { listFriends, type Friend } from '../lib/friends-client';
import { isNativePlatform } from '../lib/platform';
import { Share } from '@capacitor/share';
import type { ShareKind, ShareRow } from '../lib/shared-types';
import { toast } from '../store/toasts';
import { useAuth } from '../store/auth';

type DialogAudience = 'link' | 'friends' | 'direct';

/**
 * The visibility ladder shown in the radiogroup. 'direct' (send-to-a-friend)
 * is deliberately not part of this type — it's recipient-targeted, not a
 * visibility level, so it renders as a secondary text link below the group
 * instead of a ladder rung (see the "Send to a friend" button below).
 */
type LadderValue = 'private' | 'link' | 'friends' | 'public';

interface Props {
  kind: ShareKind;
  resourceId?: string;
  /** Display title for what's being shared, e.g. "Edric Combo" or "your collection". */
  resourceLabel: string;
  /** Deck-only: the commander(s)' color identity, for the first-publish seal
   *  moment's motes (E150). Omit for identity-less / non-deck shares — the
   *  seal falls back to gold, per STYLE_GUIDE's "colours are honest" ruling. */
  colorIdentity?: string[];
  onClose: () => void;
}

/**
 * Modal that mints (or reuses) a public share link for a collection / deck /
 * list and lets the owner copy or revoke it. Mount-conditionally — the
 * caller renders <ShareDialog/> only when the dialog should be open, so each
 * open gets fresh state without re-running the fetch effect on prop changes.
 *
 * `kind === 'deck'` additionally exposes a fourth "Public" rung, backed by
 * `deck_publications` (`publications-client.ts`) rather than the `shares`
 * table — a separate, independent action layered on top of the existing
 * link/friends/direct shares, not a fourth `shares.audience` value (see
 * PLAN.md §A1). The two systems compose: a link, a friends, a direct-to-
 * Alice share, and a public listing of one resource can all coexist.
 */
export function ShareDialog({ kind, resourceId, resourceLabel, colorIdentity, onClose }: Props) {
  // Share links are per-account (they stay tied to the owner and are
  // revocable), so a guest can't mint one — prompt them to sign in instead.
  const isGuest = useAuth((s) => s.status === 'guest');
  const username = useAuth((s) => s.user?.username);
  const displayName = useAuth((s) => s.profile?.displayName);
  const [audience, setAudience] = useState<DialogAudience>('link');
  const [addresseeId, setAddresseeId] = useState('');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [share, setShare] = useState<ShareRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guests take the sign-in branch below and never reach the loading state.
  const [loading, setLoading] = useState(!isGuest);
  const [working, setWorking] = useState(false);
  // Lives outside the `share &&` block on purpose: switching audience briefly
  // nulls `share` while a new token mints, and this toggle should stay open
  // (not reset) across that gap so the panel just reappears once resolved.
  const [showQr, setShowQr] = useState(false);

  // The ladder's own selection — independent of `audience` (see the mint
  // effect below). `undefined` (deck kind only) means "haven't checked
  // publish status yet"; distinct from `null` ("checked, not published") so
  // the mint effect can hold off minting a link share until it knows whether
  // to show Public instead (see Folded blocking fix — no wasted mint call
  // reopening on an already-published deck).
  const [ladder, setLadder] = useState<LadderValue>('link');
  const [publication, setPublication] = useState<Publication | null | undefined>(
    kind === 'deck' ? undefined : null
  );
  const [pendingPublicConfirm, setPendingPublicConfirm] = useState(false);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  // Distinct from `working` (which still gates every button, unchanged) —
  // this only decides whether the Private rung's own label reads
  // "Revoking…", since going private can start from any other rung
  // (including 'public'), so `working` alone can't tell which action is live.
  const [privateBusy, setPrivateBusy] = useState(false);
  // sr-only aria-live="polite" announcement for the confirm-block / display-
  // name transitions (Folded blocking fix — Modal's own focus-trap only
  // fires once, on mount; showing/hiding content inside it re-targets nothing).
  const [announcement, setAnnouncement] = useState('');

  const previousLadderRef = useRef<LadderValue>('link');
  const confirmBlockRef = useRef<HTMLDivElement>(null);
  const displayNameId = useId();
  // First-publish seal (E150): this dialog never navigates away on publish
  // (it stays open showing the live link), so — unlike the creation-time
  // fieldsets — it's safe to fire directly here rather than handing off to a
  // landing page. Covers both entry surfaces that reuse this dialog as-is:
  // the deck-editor visibility chip and the post-create DeckPublishNudge.
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();

  // A direct share can't mint until a recipient is chosen — hold off until then.
  const awaitingRecipient = audience === 'direct' && !addresseeId;

  // Mint (or reuse) the token for the selected audience (+ recipient, for
  // direct). Each audience/recipient has its own idempotent token, so a
  // 'link', a 'friends', and a direct-to-Alice share of one resource
  // coexist. Default 'link' on open keeps the one-tap copy-link flow
  // unchanged. State resets on switch happen in the click handlers, keeping
  // the effect setState-free.
  //
  // Only fires for the classic link/friends rungs: 'private' and 'public'
  // have nothing to mint (private means nothing lives; public mints nothing
  // — it's a deck_publications row, not a share). This also holds off
  // minting while a deck's publish status is still unknown, so an
  // already-public deck never gets a wasted 'link' share minted underneath
  // it just because the dialog happened to open.
  useEffect(() => {
    if (ladder !== 'link' && ladder !== 'friends') return;
    if (kind === 'deck' && publication === undefined) return;
    if (isGuest || awaitingRecipient) return;
    let cancelled = false;
    createShare({ kind, resourceId, audience, addresseeId: addresseeId || undefined })
      .then((row) => {
        if (!cancelled) setShare(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to create share.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, resourceId, isGuest, audience, addresseeId, awaitingRecipient, ladder, publication]);

  // Deck-only: check whether this deck is already publicly listed, in
  // parallel with the mint effect above. Resolves `publication` out of
  // `undefined` either way (even on failure) so the mint effect above is
  // never permanently blocked by a failed check.
  useEffect(() => {
    if (isGuest || kind !== 'deck' || !resourceId) return;
    let cancelled = false;
    getPublication(resourceId)
      .then((pub) => {
        if (cancelled) return;
        setPublication(pub);
        if (pub && !pub.unpublishedAt) setLadder('public');
      })
      .catch(() => {
        if (!cancelled) setPublication(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isGuest, kind, resourceId]);

  // Lazy-load the friends list the first time the user picks "Send to a friend".
  useEffect(() => {
    if (audience !== 'direct' || friends !== null) return;
    let cancelled = false;
    listFriends()
      .then((list) => {
        if (!cancelled) setFriends(list);
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
      });
    return () => {
      cancelled = true;
    };
  }, [audience, friends]);

  // Focus the confirm block or display-name sub-step the instant either
  // becomes visible — Modal's own focus-trap only moves focus once, on
  // mount, so it never re-targets when content changes inside it. The
  // sr-only announcement is set separately, synchronously in the handlers
  // that cause each transition (below) — setState directly inside an effect
  // risks a cascading render (react-hooks/set-state-in-effect); this effect
  // only performs the (non-state) imperative focus move.
  useEffect(() => {
    if (!pendingPublicConfirm) return;
    const first = confirmBlockRef.current?.querySelector<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex]'
    );
    first?.focus();
  }, [pendingPublicConfirm, needsDisplayName]);

  const selectAudience = (next: DialogAudience) => {
    if (next === audience || working) return;
    setShare(null);
    setError(null);
    setAddresseeId('');
    // 'direct' shows the recipient picker first (no token yet); others mint now.
    setLoading(next !== 'direct');
    setAudience(next);
  };

  const selectRecipient = (id: string) => {
    setAddresseeId(id);
    setShare(null);
    setError(null);
    setLoading(!!id);
  };

  /**
   * The complete Private fix (Folded blocking fix #1): revoke every live
   * share row for this exact (kind, resourceId) — not just whichever one
   * happens to be loaded in dialog state — and unpublish any live
   * deck_publications row, awaiting all of it before claiming "not shared".
   * On failure the prior state is preserved, not optimistically cleared.
   */
  const handleGoPrivate = async () => {
    setWorking(true);
    setPrivateBusy(true);
    setError(null);
    try {
      const all = await listShares();
      const rid = resourceId ?? ''; // matches the server's collection-kind normalization
      const mine = all.filter((s) => s.kind === kind && s.resourceId === rid);
      await Promise.all(mine.map((s) => revokeShare(s.token)));
      if (kind === 'deck' && resourceId && publication && !publication.unpublishedAt) {
        await unpublishDeck(resourceId);
      }
      setShare(null);
      setPublication(null);
      setPendingPublicConfirm(false);
      setNeedsDisplayName(false);
      setLadder('private');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke sharing.');
    } finally {
      setWorking(false);
      setPrivateBusy(false);
    }
  };

  const doPublish = async (): Promise<void> => {
    if (!resourceId) return;
    try {
      const pub = await publishDeck(resourceId);
      setPublication(pub);
      setPendingPublicConfirm(false);
      setNeedsDisplayName(false);
      if (shouldCelebrateFirstPublish(resourceId, pub.isFirstPublish)) {
        fireSealMoment(colorIdentity);
      }
    } catch (err) {
      // Defense in depth: even if the client's cached displayName looked
      // set, a display_name_required 400 re-shows the same sub-step rather
      // than a generic error.
      if (err instanceof DisplayNameRequiredError) {
        setNeedsDisplayName(true);
        setAnnouncement('Set a display name to continue publishing.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to publish deck.');
      }
    }
  };

  const handleConfirmPublic = async () => {
    if (working) return;
    setError(null);
    if (!displayName) {
      setNeedsDisplayName(true);
      setAnnouncement('Set a display name to continue publishing.');
      return;
    }
    setWorking(true);
    try {
      await doPublish();
    } finally {
      setWorking(false);
    }
  };

  const handleSaveDisplayName = async () => {
    const trimmed = displayNameDraft.trim();
    if (!trimmed || working) return;
    setWorking(true);
    setError(null);
    try {
      const updated = await updateProfile({ displayName: trimmed });
      useAuth.setState((s) => (s.profile ? { profile: { ...s.profile, ...updated } } : s));
      await doPublish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your display name.");
    } finally {
      setWorking(false);
    }
  };

  const handleCancelPublic = () => {
    setLadder(previousLadderRef.current);
    setPendingPublicConfirm(false);
    setNeedsDisplayName(false);
    setDisplayNameDraft('');
    setError(null);
  };

  const handleUnpublish = async () => {
    if (!resourceId || working) return;
    setWorking(true);
    setError(null);
    try {
      await unpublishDeck(resourceId);
      setPublication(null);
      // Fall back to the baseline visibility rung, re-triggering the mint
      // effect above (its `ladder` dependency just changed) so a 'link'
      // share is ready the moment the ladder shows it.
      setAudience('link');
      setShare(null);
      setLoading(true);
      setLadder('link');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unpublish deck.');
    } finally {
      setWorking(false);
    }
  };

  const selectLadder = (next: LadderValue) => {
    if (working) return;
    setError(null);
    if (next === 'private') {
      if (ladder === 'private') return;
      void handleGoPrivate();
      return;
    }
    if (next === 'public') {
      if (ladder === 'public') return;
      if (publication && !publication.unpublishedAt) {
        // Already live — just review it, no confirm needed to re-show it.
        setLadder('public');
        return;
      }
      previousLadderRef.current = ladder;
      setPendingPublicConfirm(true);
      setNeedsDisplayName(false);
      setAnnouncement(`Confirm making ${resourceLabel} public.`);
      setLadder('public');
      return;
    }
    setLadder(next);
    selectAudience(next);
  };

  const LADDER_OPTIONS: { value: LadderValue; label: string; hint: string }[] = [
    { value: 'private', label: 'Private', hint: 'Not shared — only you can see this.' },
    {
      value: 'link',
      label: 'Anyone with link',
      hint: 'Anyone with this link can view it. No account needed.',
    },
    {
      value: 'friends',
      label: 'My friends',
      hint: 'Only your accepted friends can open this — they’ll need to be signed in.',
    },
    ...(kind === 'deck'
      ? [
          {
            value: 'public' as const,
            label: 'Public',
            hint: 'Discoverable on your profile and in search. Anyone can view and copy it.',
          },
        ]
      : []),
  ];

  const ladderHint = LADDER_OPTIONS.find((o) => o.value === ladder)?.hint ?? LADDER_OPTIONS[0].hint;

  const recipientName = friends?.find((f) => f.id === addresseeId)?.username ?? '';

  const isConfirmedPublic = ladder === 'public' && !!publication && !publication.unpublishedAt;
  const url =
    isConfirmedPublic && publication
      ? publicationUrl(publication.slug)
      : share
        ? shareUrl(share.token)
        : '';

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: 'Link copied to clipboard.', tone: 'success' });
    } catch {
      toast.show({ message: "Couldn't copy. Select and copy manually.", tone: 'warn' });
    }
  };

  const handleNativeShare = async () => {
    if (!url) return;
    try {
      await Share.share({
        title: `Share ${resourceLabel}`,
        text: `${resourceLabel} on SpellControl`,
        url,
        dialogTitle: 'Share link',
      });
    } catch (err) {
      // The user cancelling the system sheet rejects with a generic error;
      // treat anything from this call as a soft no-op rather than a toast.
      if (err && (err as { message?: string }).message?.includes('cancel')) return;
      toast.show({ message: "Couldn't open share sheet.", tone: 'warn' });
    }
  };

  if (isGuest) {
    return (
      <Modal onClose={onClose} labelledBy="share-dialog-title" className="choice-dialog">
        <h2 id="share-dialog-title" className="choice-dialog-title">
          Share {resourceLabel}
        </h2>
        <p className="choice-dialog-body">
          Sharing a public link needs an account, so the link stays tied to you and you can revoke
          it later. Signing in also syncs your collection across devices.
        </p>
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Not now
          </button>
          <Link to="/auth" className="btn btn-primary" onClick={onClose}>
            Sign in
          </Link>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="share-dialog-title"
      dismissable={!working}
      className="choice-dialog share-dialog"
    >
      {sealMoment}
      <h2 id="share-dialog-title" className="choice-dialog-title">
        Share {resourceLabel}
      </h2>

      <div className="share-audience" role="radiogroup" aria-label="Who can view this">
        {LADDER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={ladder === opt.value}
            className={`share-audience-option${ladder === opt.value ? ' is-active' : ''}`}
            onClick={() => selectLadder(opt.value)}
            disabled={working}
          >
            {opt.value === 'private' && privateBusy ? 'Revoking…' : opt.label}
          </button>
        ))}
      </div>
      {!pendingPublicConfirm && <p className="choice-dialog-body">{ladderHint}</p>}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {!pendingPublicConfirm && (
        <>
          <button
            type="button"
            className="btn-link"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => selectAudience('direct')}
            disabled={working || audience === 'direct'}
          >
            Send to a friend
          </button>

          {audience === 'direct' && (
            <div className="share-recipient">
              {friends === null ? (
                <p className="choice-dialog-body">Loading friends…</p>
              ) : friends.length === 0 ? (
                <p className="choice-dialog-body">
                  You have no friends yet — add some on the{' '}
                  <Link to="/friends" onClick={onClose}>
                    Friends page
                  </Link>
                  .
                </p>
              ) : (
                <select
                  className="share-recipient-select"
                  aria-label="Choose a friend"
                  value={addresseeId}
                  onChange={(e) => selectRecipient(e.target.value)}
                  disabled={working}
                >
                  <option value="">Choose a friend…</option>
                  {friends.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.username}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </>
      )}

      {loading && ladder !== 'public' && <p className="choice-dialog-body">Generating link…</p>}
      {error && (
        <p role="alert" className="share-dialog-error">
          {error}
        </p>
      )}

      {ladder !== 'public' && share && (
        <>
          {audience === 'direct' && recipientName && (
            <p className="share-dialog-sent" role="status">
              Sent to @{recipientName} — they’ll see it in their inbox. You can also copy the link
              below.
            </p>
          )}
          <div className="share-dialog-link">
            <input
              type="text"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="share-dialog-url"
              aria-label="Share URL"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopy}
              disabled={working}
            >
              Copy
            </button>
            {isNativePlatform() && (
              <button type="button" className="btn" onClick={handleNativeShare} disabled={working}>
                Share…
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn-link"
            style={{ alignSelf: 'flex-start' }}
            aria-expanded={showQr}
            aria-controls="share-qr-panel"
            onClick={() => setShowQr((v) => !v)}
          >
            {showQr ? 'Hide QR code' : 'Show QR code'}
          </button>
          {showQr && (
            <div className="share-qr-panel" id="share-qr-panel">
              <ShareQrCode value={url} label={`QR code for ${resourceLabel}`} />
              <p className="share-qr-caption">Scan with a phone camera to open this link.</p>
            </div>
          )}

          <div className="choice-dialog-actions">
            <button type="button" className="btn" onClick={onClose} disabled={working}>
              Done
            </button>
          </div>
        </>
      )}

      {ladder === 'public' && pendingPublicConfirm && !needsDisplayName && (
        <div className="share-public-confirm" ref={confirmBlockRef}>
          <p className="choice-dialog-body">
            Going public makes "{resourceLabel}" discoverable on your profile and in search results.
            Anyone can view and copy it. You can unpublish anytime.
          </p>
          <div className="choice-dialog-actions share-dialog-actions">
            <button type="button" className="btn" onClick={handleCancelPublic} disabled={working}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleConfirmPublic()}
              disabled={working}
              aria-label={working ? 'Publishing…' : 'Make it public — anyone can view'}
            >
              {working ? 'Publishing…' : 'Make it public'}
            </button>
          </div>
        </div>
      )}

      {ladder === 'public' && pendingPublicConfirm && needsDisplayName && (
        <div className="share-public-confirm" ref={confirmBlockRef}>
          <p className="choice-dialog-body">
            Publishing shows your display name on the deck page — set one to continue.
          </p>
          <div className="field">
            <label htmlFor={displayNameId}>Display name</label>
            <input
              id={displayNameId}
              type="text"
              className="name-input-field"
              value={displayNameDraft}
              maxLength={40}
              disabled={working}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
            />
          </div>
          <div className="choice-dialog-actions share-dialog-actions">
            <button type="button" className="btn" onClick={handleCancelPublic} disabled={working}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSaveDisplayName()}
              disabled={working || !displayNameDraft.trim()}
            >
              {working ? 'Saving…' : 'Save & continue'}
            </button>
          </div>
        </div>
      )}

      {isConfirmedPublic && publication && (
        <>
          <div className="share-dialog-link">
            <input
              type="text"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="share-dialog-url"
              aria-label="Published deck URL"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopy}
              disabled={working}
            >
              Copy
            </button>
            {isNativePlatform() && (
              <button type="button" className="btn" onClick={handleNativeShare} disabled={working}>
                Share…
              </button>
            )}
          </div>
          <p className="choice-dialog-body">
            {publication.viewCount.toLocaleString()}{' '}
            {publication.viewCount === 1 ? 'view' : 'views'} ·{' '}
            {publication.copyCount.toLocaleString()}{' '}
            {publication.copyCount === 1 ? 'copy' : 'copies'}
          </p>
          {username && (
            <p className="choice-dialog-body">
              Your profile:{' '}
              <Link to={`/u/${username}`} onClick={onClose}>
                spellcontrol.com/u/{username}
              </Link>
            </p>
          )}
          <div className="choice-dialog-actions share-dialog-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void handleUnpublish()}
              disabled={working}
            >
              {working ? 'Unpublishing…' : 'Unpublish'}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={working}>
              Done
            </button>
          </div>
        </>
      )}

      {ladder === 'private' && !working && (
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}
