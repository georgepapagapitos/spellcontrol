import { useEffect, useState } from 'react';
import { Modal } from '@/components/overlays/Modal';
import { VisibilityChoice } from '@/components/share/VisibilityChoice';
import { useAuth } from '@/store/auth';
import { useSignInPath } from '@/lib/account/sign-in-path';
import {
  fetchCollectionVisibility,
  setCollectionVisibility,
  type CollectionVisibility,
} from '@/lib/account/auth-api';
import { profileCollectionUrl } from '@/lib/social/profile-client';
import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
import { CopyButton } from '@/components/shared/CopyButton';

const OPTIONS: { value: CollectionVisibility; label: string; hint: string }[] = [
  {
    value: 'public',
    label: 'Public',
    hint: 'Anyone can see it on your profile, with quantities and prices.',
  },
  {
    value: 'friends',
    label: 'Friends',
    hint: 'Only your friends can see it on your profile, with quantities and prices.',
  },
  {
    value: 'private',
    label: 'Private',
    hint: "Only you can see it. Friends can't browse it or trade from it.",
  },
];

/**
 * Who can see your collection (board T136): Public / Friends / Private, one
 * choice applied the moment it's picked, stored on the account. The same
 * shape as ShareDialog's deck choice (STYLE_GUIDE "Visibility is one
 * choice"), and the same radio group classes. It opens on the real state and
 * changes nothing until something is picked.
 */
export function CollectionVisibilityDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** Told the new value once it's saved (the profile's Collection tab). */
  onChanged?: (v: CollectionVisibility) => void;
}) {
  const isGuest = useAuth((s) => s.status === 'guest');
  const username = useAuth((s) => s.user?.username);
  const signInHref = useSignInPath();
  // undefined = loading; null = couldn't load (nothing shown as picked). An
  // account that never chose comes back as 'friends' from the server.
  const [current, setCurrent] = useState<CollectionVisibility | null | undefined>(undefined);
  const [busy, setBusy] = useState<CollectionVisibility | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    fetchCollectionVisibility()
      .then((v) => {
        if (!cancelled) setCurrent(v);
      })
      .catch((err) => {
        if (cancelled) return;
        setCurrent(null);
        setError(userMessage(err, "Couldn't load who can see your collection. Try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [isGuest]);

  const choose = async (next: CollectionVisibility) => {
    if (busy || next === current) return;
    setBusy(next);
    setError(null);
    try {
      const saved = await setCollectionVisibility(next);
      setCurrent(saved);
      onChanged?.(saved);
    } catch (err) {
      setError(userMessage(err, "Couldn't change who can see it. Try again."));
    } finally {
      setBusy(null);
    }
  };

  if (isGuest) {
    return (
      <Modal onClose={onClose} labelledBy="collection-visibility-title" className="choice-dialog">
        <h2 id="collection-visibility-title" className="choice-dialog-title">
          Share your collection
        </h2>
        <p className="choice-dialog-body">Sharing needs an account.</p>
        <div className="choice-dialog-actions">
          <Button onClick={onClose}>Not now</Button>
          <Button variant="primary" to={signInHref} onClick={onClose}>
            Sign in
          </Button>
        </div>
      </Modal>
    );
  }

  const url =
    username && (current === 'public' || current === 'friends')
      ? profileCollectionUrl(username)
      : '';

  return (
    <Modal
      onClose={onClose}
      labelledBy="collection-visibility-title"
      dismissable={!busy}
      backdropClassName="modal-backdrop--sheet"
      className="choice-dialog share-dialog"
    >
      <h2 id="collection-visibility-title" className="choice-dialog-title">
        Who can see your collection
      </h2>
      {current === undefined ? (
        <p className="choice-dialog-body" role="status">
          Loading…
        </p>
      ) : (
        <>
          <VisibilityChoice
            ariaLabel="Who can see your collection"
            value={(current ?? '__unknown__') as CollectionVisibility}
            options={OPTIONS}
            busyValue={busy}
            disabled={!!busy}
            onChange={(next) => void choose(next)}
          />
        </>
      )}
      {error && (
        <p role="alert" className="share-dialog-error">
          {error}
        </p>
      )}
      {url && (
        <div className="share-dialog-link">
          <input
            type="text"
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="share-dialog-url"
            aria-label="Link"
          />
          <CopyButton value={url} what="the link" variant="primary" />
        </div>
      )}
      <div className="choice-dialog-actions">
        <Button onClick={onClose} disabled={!!busy}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
