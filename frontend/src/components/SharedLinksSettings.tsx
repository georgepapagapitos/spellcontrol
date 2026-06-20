import { useCallback, useEffect, useState } from 'react';
import { Share } from '@capacitor/share';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useCubeStore } from '../store/cube';
import { listShares, revokeShare, shareUrl } from '../lib/share-client';
import { isNativePlatform } from '../lib/platform';
import { toast } from '../store/toasts';
import type { ShareKind, ShareRow } from '../lib/shared-types';

const KIND_LABELS: Record<ShareKind, string> = {
  collection: 'Collection',
  deck: 'Deck',
  binder: 'Binder',
  list: 'List',
  cube: 'Cube',
};

interface ResolvedLabel {
  /** Human-readable name for the underlying resource. */
  name: string;
  /** True when the resource has been deleted out from under the share. */
  deleted: boolean;
}

/**
 * Settings card listing the signed-in user's active share links with copy
 * and revoke actions. Hidden entirely for guests (shares are per-account
 * and a guest has none). Empty state shown when the user has no shares
 * yet, so the surface is discoverable even before they mint their first
 * link.
 *
 * Resource names are resolved from local stores rather than another
 * server call — the user's own decks / binders / lists are already in
 * memory, and a missing match means the resource was deleted (we render
 * "Deleted X" and let revoke clean up the orphan).
 */
export function SharedLinksSettings() {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const decks = useDecksStore((s) => s.decks);
  const binders = useCollectionStore((s) => s.binders);
  const lists = useCollectionStore((s) => s.lists);
  const cubes = useCubeStore((s) => s.saved);

  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  // Inline .then() chain on purpose: react-hooks/set-state-in-effect flags
  // `await`-then-setState patterns even when wrapped in a separate function.
  // Mirrors the ShareDialog effect for consistency.
  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    listShares()
      .then((rows) => {
        if (cancelled) return;
        setShares(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load shares.');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  const resolveLabel = (s: ShareRow): ResolvedLabel => {
    if (s.kind === 'collection') return { name: 'Your collection', deleted: false };
    if (s.kind === 'deck') {
      const d = decks.find((x) => x.id === s.resourceId);
      return d ? { name: d.name, deleted: false } : { name: 'Deleted deck', deleted: true };
    }
    if (s.kind === 'binder') {
      const b = binders.find((x) => x.id === s.resourceId);
      return b ? { name: b.name, deleted: false } : { name: 'Deleted binder', deleted: true };
    }
    if (s.kind === 'cube') {
      const c = cubes.find((x) => x.id === s.resourceId);
      return c ? { name: c.name, deleted: false } : { name: 'Deleted cube', deleted: true };
    }
    const l = lists.find((x) => x.id === s.resourceId);
    return l ? { name: l.name, deleted: false } : { name: 'Deleted list', deleted: true };
  };

  const handleCopy = useCallback(async (token: string) => {
    const url = shareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: 'Link copied to clipboard.', tone: 'success' });
    } catch {
      toast.show({ message: 'Could not copy. Select and copy manually.', tone: 'warn' });
    }
  }, []);

  const handleNativeShare = useCallback(async (token: string, label: string) => {
    const url = shareUrl(token);
    try {
      await Share.share({
        title: `Share ${label}`,
        text: `${label} on SpellControl`,
        url,
        dialogTitle: 'Share link',
      });
    } catch (err) {
      if (err && (err as { message?: string }).message?.includes('cancel')) return;
      toast.show({ message: 'Could not open share sheet.', tone: 'warn' });
    }
  }, []);

  const handleRevoke = useCallback(async (token: string) => {
    setRevokingToken(token);
    try {
      await revokeShare(token);
      // Optimistic: drop it locally so the row disappears before the
      // refetch completes — revoke is irreversible from the UI, so no
      // need to await the server's view of the world.
      setShares((prev) => (prev ? prev.filter((s) => s.token !== token) : prev));
      toast.show({ message: 'Share link revoked.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Could not revoke share.',
        tone: 'error',
      });
    } finally {
      setRevokingToken(null);
    }
  }, []);

  if (!isAuthed) return null;

  return (
    <section className="settings-card" aria-labelledby="settings-shares-title">
      <header className="settings-card-header">
        <h2 id="settings-shares-title" className="settings-card-title">
          Share links
        </h2>
        <p className="settings-card-hint">
          Public links you&apos;ve minted. Anyone with the URL can view the linked content until you
          revoke it.
        </p>
      </header>
      <div className="settings-card-body">
        {error && (
          <div role="alert" className="settings-row-text">
            <div className="settings-row-hint">{error}</div>
          </div>
        )}
        {shares === null && !error && (
          <div className="settings-row-text">
            <div className="settings-row-hint">Loading…</div>
          </div>
        )}
        {shares?.length === 0 && (
          <div className="settings-row-text">
            <div className="settings-row-hint">
              You haven&apos;t shared anything yet. Use the Share button on a collection, binder,
              deck, or list to mint a public link.
            </div>
          </div>
        )}
        {shares?.map((s) => {
          const label = resolveLabel(s);
          const url = shareUrl(s.token);
          const revoking = revokingToken === s.token;
          return (
            <div className="settings-row settings-share-row" key={s.token}>
              <div className="settings-row-text">
                <div className="settings-row-value">
                  <span className="settings-share-kind">{KIND_LABELS[s.kind]}</span>{' '}
                  <span className={label.deleted ? 'settings-share-name--deleted' : undefined}>
                    {label.name}
                  </span>
                  {s.audience === 'friends' && (
                    <span className="settings-share-audience"> · Friends only</span>
                  )}
                  {s.audience === 'direct' && (
                    <span className="settings-share-audience"> · Sent to a friend</span>
                  )}
                </div>
                <div className="settings-row-hint">
                  Shared {new Date(s.createdAt).toLocaleDateString()} ·{' '}
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-share-url"
                  >
                    {url.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              </div>
              <div className="settings-share-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleCopy(s.token)}
                  disabled={revoking}
                  aria-label={`Copy ${KIND_LABELS[s.kind].toLowerCase()} share link`}
                >
                  Copy
                </button>
                {isNativePlatform() && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void handleNativeShare(s.token, label.name)}
                    disabled={revoking}
                    aria-label={`Share ${KIND_LABELS[s.kind].toLowerCase()} link`}
                  >
                    Share…
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleRevoke(s.token)}
                  disabled={revoking}
                  aria-label={`Revoke ${KIND_LABELS[s.kind].toLowerCase()} share link`}
                >
                  {revoking ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
