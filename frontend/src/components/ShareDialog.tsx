import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from './Modal';
import { createShare, revokeShare, shareUrl } from '../lib/share-client';
import { isNativePlatform } from '../lib/platform';
import { Share } from '@capacitor/share';
import type { ShareKind, ShareRow } from '../lib/shared-types';
import { toast } from '../store/toasts';
import { useAuth } from '../store/auth';

/** Audiences the dialog can mint. 'direct' (send to one friend) ships later. */
type DialogAudience = 'link' | 'friends';
const AUDIENCE_OPTIONS: { value: DialogAudience; label: string; hint: string }[] = [
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
];

interface Props {
  kind: ShareKind;
  resourceId?: string;
  /** Display title for what's being shared, e.g. "Edric Combo" or "your collection". */
  resourceLabel: string;
  onClose: () => void;
}

/**
 * Modal that mints (or reuses) a public share link for a collection / deck /
 * list and lets the owner copy or revoke it. Mount-conditionally — the
 * caller renders <ShareDialog/> only when the dialog should be open, so each
 * open gets fresh state without re-running the fetch effect on prop changes.
 */
export function ShareDialog({ kind, resourceId, resourceLabel, onClose }: Props) {
  // Share links are per-account (they stay tied to the owner and are
  // revocable), so a guest can't mint one — prompt them to sign in instead.
  const isGuest = useAuth((s) => s.status === 'guest');
  const [audience, setAudience] = useState<DialogAudience>('link');
  const [share, setShare] = useState<ShareRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guests take the sign-in branch below and never reach the loading state.
  const [loading, setLoading] = useState(!isGuest);
  const [working, setWorking] = useState(false);

  // Mint (or reuse) the token for the selected audience. Re-runs when the user
  // switches audience — each audience has its own idempotent token, so a 'link'
  // and a 'friends' share of the same resource coexist. Default 'link' on open
  // keeps the one-tap copy-link flow unchanged. State resets on switch happen in
  // the click handler (selectAudience), not here, to keep the effect setState-free.
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    createShare({ kind, resourceId, audience })
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
  }, [kind, resourceId, isGuest, audience]);

  const selectAudience = (next: DialogAudience) => {
    if (next === audience || working) return;
    // Reset to the loading state for the new audience before the effect refetches.
    setLoading(true);
    setShare(null);
    setError(null);
    setAudience(next);
  };

  const audienceHint =
    AUDIENCE_OPTIONS.find((o) => o.value === audience)?.hint ?? AUDIENCE_OPTIONS[0].hint;

  const url = share ? shareUrl(share.token) : '';

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: 'Link copied to clipboard.', tone: 'success' });
    } catch {
      toast.show({ message: 'Could not copy. Select and copy manually.', tone: 'warn' });
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
      toast.show({ message: 'Could not open share sheet.', tone: 'warn' });
    }
  };

  const handleRevoke = async () => {
    if (!share) return;
    setWorking(true);
    try {
      await revokeShare(share.token);
      toast.show({ message: 'Share link revoked.', tone: 'success' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share.');
    } finally {
      setWorking(false);
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
      <h2 id="share-dialog-title" className="choice-dialog-title">
        Share {resourceLabel}
      </h2>

      <div className="share-audience" role="radiogroup" aria-label="Who can view this">
        {AUDIENCE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={audience === opt.value}
            className={`share-audience-option${audience === opt.value ? ' is-active' : ''}`}
            onClick={() => selectAudience(opt.value)}
            disabled={working}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="choice-dialog-body">{audienceHint}</p>

      {loading && <p className="choice-dialog-body">Generating link…</p>}
      {error && (
        <p role="alert" className="share-dialog-error">
          {error}
        </p>
      )}

      {share && (
        <>
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
          <div className="choice-dialog-actions share-dialog-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleRevoke}
              disabled={working}
              aria-label="Revoke share link"
            >
              {working ? 'Revoking…' : 'Revoke link'}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={working}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
