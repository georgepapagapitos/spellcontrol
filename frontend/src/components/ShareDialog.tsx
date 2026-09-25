import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSignInPath } from '../lib/sign-in-path';
import { Modal } from './Modal';
import { VisibilityChoice } from './VisibilityChoice';
import { ShareQrCode } from './shared/ShareQrCode';
import { useSealMoment } from './shared/SealMoment';
import { createShare, listShares, revokeShare, shareUrl } from '../lib/share-client';
import {
  getPublication,
  publicationUrl,
  publishDeck,
  unpublishDeck,
  type Publication,
} from '../lib/publications-client';
import { shouldCelebrateFirstPublish } from '../lib/first-publish-celebration';
import { listFriends, type Friend } from '../lib/friends-client';
import { canShare, openShareSheet } from '@/lib/web-share';
import type { ShareKind, ShareRow } from '../lib/shared-types';
import { toast } from '../store/toasts';
import { useAuth } from '../store/auth';
import { userMessage } from '@/lib/user-error';

/**
 * Who can see a resource: one choice, applied the moment it's picked.
 *
 * - `public` (decks): a `deck_publications` row. Listed on the profile and in
 *   Discover, at a frozen /d/:slug.
 * - `link` (everything else, until each kind gets a public page of its own):
 *   an unlisted /s/:token anyone with the address can open.
 * - `friends`: a friends-audience /s/:token, gated on friendship.
 * - `private`: nothing live.
 *
 * The rungs are exclusive, enforced where every write converges on the
 * server: publishing retires link/friends shares, minting one retires a live
 * publication and the other rung. 'direct' (send to one friend) is not a
 * rung: it is recipient-targeted and sits below the choice.
 */
type Rung = 'public' | 'link' | 'friends' | 'private';

/** A deck on the retired link rung (board T136): it still works, but it is
 *  no longer an option, so nothing reads as selected until the owner picks. */
type Current = Rung | 'legacy-link';

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

function rungsFor(kind: ShareKind): { value: Rung; label: string; hint: string }[] {
  const friends = {
    value: 'friends' as const,
    label: 'Friends',
    hint:
      kind === 'deck'
        ? 'Only your friends can open it. They find it on your page in their Friends list.'
        : 'Only your friends can open it, signed in.',
  };
  const priv = { value: 'private' as const, label: 'Private', hint: 'Only you can see it.' };
  if (kind === 'deck') {
    return [
      {
        value: 'public',
        label: 'Public',
        hint: 'Anyone can find it on your profile and in Discover, and copy it.',
      },
      friends,
      priv,
    ];
  }
  return [
    {
      value: 'link',
      label: 'Anyone with the link',
      hint: 'Anyone with the link can view it. No account needed.',
    },
    friends,
    priv,
  ];
}

const LEGACY_LINK_HINT =
  'It has an older link that anyone can open. Pick who can see it, and that link stops working.';

/**
 * The visibility control for a deck, collection, binder, list or cube. Opens
 * on the resource's REAL current state (it reads, never mints, on open), and
 * each pick applies at once: no confirm step, no link to manage.
 * Mount-conditionally: the caller renders it only while open.
 */
export function ShareDialog({ kind, resourceId, resourceLabel, colorIdentity, onClose }: Props) {
  const isGuest = useAuth((s) => s.status === 'guest');
  const signInHref = useSignInPath();
  const username = useAuth((s) => s.user?.username);
  const rid = resourceId ?? ''; // the server's collection-kind normalization
  const rungs = rungsFor(kind);

  const [current, setCurrent] = useState<Current | null>(null);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [share, setShare] = useState<ShareRow | null>(null);
  const [busy, setBusy] = useState<Rung | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // First-publish seal (E150): the dialog stays open showing the live link,
  // so it's safe to fire here rather than handing off to a landing page.
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();

  // Read the current state from both systems at once. Precedence mirrors
  // resolveDeckVisibility() in use-deck-visibility.ts.
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    Promise.all([
      kind === 'deck' && resourceId ? getPublication(resourceId).catch(() => null) : null,
      listShares().catch((): ShareRow[] => []),
    ]).then(([pub, all]) => {
      if (cancelled) return;
      setPublication(pub);
      const mine = all.filter((s) => s.kind === kind && s.resourceId === rid);
      const friendsShare = mine.find((s) => s.audience === 'friends');
      const linkShare = mine.find((s) => s.audience === 'link');
      if (pub && !pub.unpublishedAt) {
        setCurrent('public');
      } else if (friendsShare) {
        setShare(friendsShare);
        setCurrent('friends');
      } else if (linkShare) {
        setShare(linkShare);
        setCurrent(kind === 'deck' ? 'legacy-link' : 'link');
      } else {
        setCurrent('private');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isGuest, kind, resourceId, rid]);

  // The friends list loads the first time "Send to a friend" opens.
  useEffect(() => {
    if (!sendOpen || friends !== null) return;
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
  }, [sendOpen, friends]);

  const choose = async (next: Rung) => {
    if (busy || next === current) return;
    setBusy(next);
    setError(null);
    try {
      if (next === 'private') {
        // Every live row for this resource, not just the one in state, and
        // the publication; only then does it read as private.
        const all = await listShares();
        const mine = all.filter((s) => s.kind === kind && s.resourceId === rid);
        await Promise.all(mine.map((s) => revokeShare(s.token)));
        if (kind === 'deck' && resourceId && publication && !publication.unpublishedAt) {
          await unpublishDeck(resourceId);
        }
        setShare(null);
        setPublication(null);
      } else if (next === 'public') {
        if (!resourceId) return;
        const pub = await publishDeck(resourceId);
        // The server retired this deck's link/friends shares as it published.
        setShare(null);
        setPublication(pub);
        if (shouldCelebrateFirstPublish(resourceId, pub.isFirstPublish)) {
          fireSealMoment(colorIdentity);
        }
      } else {
        const row = await createShare({ kind, resourceId, audience: next });
        // Minting retired the other rung and any live publication server-side.
        setShare(row);
        setPublication((pub) =>
          pub && !pub.unpublishedAt ? { ...pub, unpublishedAt: Date.now() } : pub
        );
      }
      setCurrent(next);
      const label = rungs.find((r) => r.value === next)?.label ?? next;
      setAnnouncement(`Now ${label.toLowerCase()}.`);
    } catch (err) {
      setError(userMessage(err, "Couldn't change who can see it. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const sendTo = async (friend: Friend) => {
    setSending(true);
    setError(null);
    try {
      await createShare({ kind, resourceId, audience: 'direct', addresseeId: friend.id });
      setSentTo(friend.username);
    } catch (err) {
      setError(userMessage(err, "Couldn't send it. Try again."));
    } finally {
      setSending(false);
    }
  };

  const url =
    current === 'public' && publication
      ? publicationUrl(publication.slug)
      : (current === 'friends' || current === 'link' || current === 'legacy-link') && share
        ? shareUrl(share.token)
        : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: 'Link copied to clipboard.', tone: 'success' });
    } catch {
      toast.show({ message: "Couldn't copy. Select and copy manually.", tone: 'warn' });
    }
  };

  if (isGuest) {
    return (
      <Modal onClose={onClose} labelledBy="share-dialog-title" className="choice-dialog">
        <h2 id="share-dialog-title" className="choice-dialog-title">
          Share {resourceLabel}
        </h2>
        <p className="choice-dialog-body">
          Sharing needs an account, so you stay in control of who sees it.
        </p>
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Not now
          </button>
          <Link to={signInHref} className="btn btn-primary" onClick={onClose}>
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
      dismissable={!busy}
      backdropClassName="modal-backdrop--sheet"
      className="choice-dialog share-dialog"
    >
      {sealMoment}
      <h2 id="share-dialog-title" className="choice-dialog-title">
        Who can see {resourceLabel}
      </h2>

      {current === null ? (
        <p className="choice-dialog-body" role="status">
          Loading…
        </p>
      ) : (
        <>
          {current === 'legacy-link' && <p className="choice-dialog-body">{LEGACY_LINK_HINT}</p>}
          <VisibilityChoice
            ariaLabel="Who can see it"
            value={current as Rung}
            options={rungs}
            busyValue={busy}
            disabled={!!busy}
            onChange={(next) => void choose(next)}
          />
        </>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {error && (
        <p role="alert" className="share-dialog-error">
          {error}
        </p>
      )}

      {url && (
        <>
          <div className="share-dialog-link">
            <input
              type="text"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="share-dialog-url"
              aria-label="Link"
            />
            <button type="button" className="btn btn-primary" onClick={() => void handleCopy()}>
              Copy
            </button>
            {canShare() && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void openShareSheet({
                    title: `Share ${resourceLabel}`,
                    text: `${resourceLabel} on SpellControl`,
                    url,
                  })
                }
              >
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
        </>
      )}

      {current === 'public' && publication && (
        <p className="choice-dialog-body">
          {publication.viewCount.toLocaleString()} {publication.viewCount === 1 ? 'view' : 'views'}{' '}
          · {publication.copyCount.toLocaleString()}{' '}
          {publication.copyCount === 1 ? 'copy' : 'copies'}
          {username && (
            <>
              {' '}
              ·{' '}
              <Link to={`/u/${username}`} onClick={onClose}>
                Your profile
              </Link>
            </>
          )}
        </p>
      )}

      {current !== null && (
        <div className="share-recipient">
          {sentTo ? (
            <p className="share-dialog-sent" role="status">
              Sent to @{sentTo}. They&apos;ll see it in their inbox.
            </p>
          ) : !sendOpen ? (
            <button
              type="button"
              className="btn-link"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setSendOpen(true)}
            >
              Send to a friend
            </button>
          ) : friends === null ? (
            <p className="choice-dialog-body">Loading friends…</p>
          ) : friends.length === 0 ? (
            <p className="choice-dialog-body">
              You have no friends yet. Add some on the{' '}
              <Link to="/friends" onClick={onClose}>
                Friends page
              </Link>
              .
            </p>
          ) : (
            <select
              className="share-recipient-select"
              aria-label="Choose a friend"
              value=""
              disabled={sending}
              onChange={(e) => {
                const f = friends.find((x) => x.id === e.target.value);
                if (f) void sendTo(f);
              }}
            >
              <option value="">{sending ? 'Sending…' : 'Choose a friend…'}</option>
              {friends.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.username}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onClose} disabled={!!busy}>
          Done
        </button>
      </div>
    </Modal>
  );
}
