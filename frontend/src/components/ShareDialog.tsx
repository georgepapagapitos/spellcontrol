import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { createShare, revokeShare, shareUrl } from '../lib/share-client';
import type { ShareKind, ShareRow } from '../lib/shared-types';
import { toast } from '../store/toasts';

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
  const [share, setShare] = useState<ShareRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createShare({ kind, resourceId })
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
  }, [kind, resourceId]);

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

  return (
    <Modal onClose={onClose} label={`Share ${resourceLabel}`} dismissable={!working}>
      <h2 id="share-dialog-title" style={{ marginTop: 0 }}>
        Share {resourceLabel}
      </h2>
      <p style={{ marginTop: 0, color: 'var(--text-muted, #888)' }}>
        Anyone with this link can view it. They don&apos;t need an account.
      </p>

      {loading && <p>Generating link…</p>}
      {error && (
        <p role="alert" style={{ color: 'var(--danger, #c0392b)' }}>
          {error}
        </p>
      )}

      {share && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              type="text"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, fontFamily: 'monospace' }}
              aria-label="Share URL"
            />
            <button type="button" onClick={handleCopy} disabled={working}>
              Copy
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button
              type="button"
              onClick={handleRevoke}
              disabled={working}
              className="danger"
              aria-label="Revoke share link"
            >
              {working ? 'Revoking…' : 'Revoke link'}
            </button>
            <button type="button" onClick={onClose} disabled={working}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
