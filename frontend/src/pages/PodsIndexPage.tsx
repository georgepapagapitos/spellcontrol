import './PodsIndexPage.css';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Modal } from '../components/Modal';
import { UserAvatar } from '../components/UserAvatar';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';
import { useAnimatedNumber } from '../lib/use-animated-number';
import { listFriends, type Friend } from '../lib/friends-client';
import {
  acceptPodInvite,
  createPod,
  declinePodInvite,
  invitePodMembers,
  listPods,
  type Pod,
} from '../lib/pods-client';

const POD_NAME_MAX = 60;

/* Legacy useAnimatedNumber (no revealKey) — tweens changes while mounted,
   never reveals-on-mount (STYLE_GUIDE "Live values"). Its own component so
   the hook isn't called inside a .map(). */
function PodMemberCount({ count }: { count: number }) {
  const { display } = useAnimatedNumber(count);
  return (
    <>
      {display} {display === 1 ? 'member' : 'members'}
    </>
  );
}

function PodsSkeleton() {
  return (
    <div className="pods-skeleton" aria-label="Loading" aria-busy="true">
      <span className="pods-skeleton-bar" />
      <span className="pods-skeleton-bar" />
      <span className="pods-skeleton-bar" />
    </div>
  );
}

export function PodsIndexPage() {
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();

  const [pods, setPods] = useState<Pod[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  // Imperative reload for post-mutation refetches (accept/decline/create).
  const loadPods = useCallback(() => {
    setLoadError(null);
    listPods()
      .then(setPods)
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load pods.');
      });
  }, []);

  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;
    listPods()
      .then((next) => {
        if (!cancelled) setPods(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load pods.');
        setPods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function handleAccept(pod: Pod) {
    setBusy(pod.id, true);
    try {
      await acceptPodInvite(pod.id);
      toast.show({ message: `You joined ${pod.name}.`, tone: 'success' });
      loadPods();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't accept the invite.",
        tone: 'error',
      });
    } finally {
      setBusy(pod.id, false);
    }
  }

  async function handleDecline(pod: Pod) {
    setBusy(pod.id, true);
    try {
      await declinePodInvite(pod.id);
      toast.show({ message: `Declined the invite to ${pod.name}.`, tone: 'info' });
      loadPods();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't decline the invite.",
        tone: 'error',
      });
    } finally {
      setBusy(pod.id, false);
    }
  }

  function handleCreated(newPod: Pod) {
    setCreateOpen(false);
    setPods((prev) => (prev ? [newPod, ...prev] : [newPod]));
    navigate(`/pods/${newPod.id}`);
  }

  // ── Guest gate — same sign-in-prompt pattern as FriendsManagement's own
  // guest branch (the closest precedent, since /friends now folds into
  // /you). ─────────────────────────────────────────────────────────────────
  if (status === 'guest') {
    return (
      <div className="pods-index-page">
        <header className="binder-hero">
          <div className="settings-page-hero-text">
            <h1 className="binder-hero-name">Pods</h1>
          </div>
        </header>
        <div className="friends-signin-prompt">
          <p className="friends-signin-title">Sign in to set up your pod</p>
          <p className="friends-signin-body">
            Create an account or sign in to track games and trades with your regular table.
          </p>
          <Link to="/auth" className="friends-signin-btn">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const loading = pods === null;
  const podsList = pods ?? [];
  const invited = podsList.filter((p) => p.myStatus === 'invited');
  const yours = podsList.filter((p) => p.myStatus === 'member');
  const isEmpty = !loading && invited.length === 0 && yours.length === 0;

  return (
    <div className="pods-index-page">
      <header className="binder-hero">
        <div className="settings-page-hero-text">
          <h1 className="binder-hero-name">Pods</h1>
          <p className="binder-hero-meta">Your regular tables — games and trades in one place.</p>
        </div>
      </header>

      {loadError && (
        <div className="friends-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="friends-error-retry" onClick={loadPods}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <PodsSkeleton />
      ) : isEmpty ? (
        <div className="empty-state" role="status">
          <EmptyStateMark />
          <p className="empty-state-tagline">No pods yet.</p>
          <p className="empty-state-hint">
            Create one to track games and trades with your regular table.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            Create pod
          </button>
        </div>
      ) : (
        <>
          {invited.length > 0 && (
            <section className="pods-index-section" aria-label="Pending pod invites">
              <h2 className="pods-index-section-title">Invited</h2>
              <ul className="pods-invited-list">
                {invited.map((pod) => (
                  <li key={pod.id} className="pods-invited-row">
                    <UserAvatar name={pod.ownerUsername} size={36} />
                    <div className="pods-invited-info">
                      <span className="pods-invited-name">{pod.name}</span>
                      <span className="pods-invited-meta">
                        <PodMemberCount count={pod.memberCount} /> · hosted by {pod.ownerUsername}
                      </span>
                    </div>
                    <div className="pods-invited-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void handleAccept(pod)}
                        disabled={busyIds.has(pod.id)}
                        aria-label={`Accept invite to ${pod.name}`}
                      >
                        {busyIds.has(pod.id) ? '…' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleDecline(pod)}
                        disabled={busyIds.has(pod.id)}
                        aria-label={`Decline invite to ${pod.name}`}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="pods-index-section" aria-label="Your pods">
            <h2 className="pods-index-section-title">Your pods</h2>
            <div className="deck-bento">
              {yours.map((pod) => (
                <Link key={pod.id} to={`/pods/${pod.id}`} className="pods-index-card">
                  <UserAvatar name={pod.ownerUsername} size={36} />
                  <span className="pods-index-card-body">
                    <span className="pods-index-card-name">{pod.name}</span>
                    <span className="pods-index-card-meta">
                      <PodMemberCount count={pod.memberCount} />
                    </span>
                  </span>
                </Link>
              ))}
              <button
                type="button"
                className="pods-index-card pods-index-card-create"
                onClick={() => setCreateOpen(true)}
              >
                <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Create pod</span>
              </button>
            </div>
          </section>
        </>
      )}

      {createOpen && (
        <CreatePodDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}

function CreatePodDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (pod: Pod) => void;
}) {
  const titleId = useId();
  const countId = useId();
  const [name, setName] = useState('');
  const [friendsFetch, setFriendsFetch] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; friends: Friend[] }
  >({ status: 'loading' });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFriends()
      .then((friends) => {
        if (!cancelled) setFriendsFetch({ status: 'ready', friends });
      })
      .catch(() => {
        // No friends list ≠ no dialog — the pod can still be created and
        // people invited later from its hub page.
        if (!cancelled) setFriendsFetch({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleFriend(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Pod name is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const pod = await createPod(trimmed);
      if (checked.size > 0) {
        try {
          await invitePodMembers(pod.id, Array.from(checked));
        } catch {
          // The pod itself was created successfully — never strand it or
          // block navigation over the secondary invite call failing.
          toast.show({
            message: 'Pod created, but invites failed to send — invite friends from the pod page.',
            tone: 'error',
          });
        }
      }
      onCreated(pod);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't create the pod.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} dismissable={!saving}>
      <form
        className="pods-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id={titleId} className="pods-dialog-title">
          Create a pod
        </h2>

        <label className="pods-dialog-field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={POD_NAME_MAX}
            placeholder="e.g. Friday commander table"
            aria-describedby={countId}
            autoFocus
          />
          <span id={countId} className="pods-dialog-counter">
            {name.length}/{POD_NAME_MAX}
          </span>
        </label>

        <fieldset className="pods-dialog-invites">
          <legend>Invite friends</legend>
          {friendsFetch.status === 'loading' ? (
            <p className="pods-dialog-hint">Loading friends…</p>
          ) : friendsFetch.status === 'error' ? (
            <p className="pods-dialog-hint">
              Couldn't load your friends list — you can invite people from the pod page instead.
            </p>
          ) : friendsFetch.friends.length === 0 ? (
            <p className="pods-dialog-hint">
              No friends yet — you can invite people from the pod page once you have some.
            </p>
          ) : (
            <ul className="pods-dialog-friend-list">
              {friendsFetch.friends.map((f) => (
                <li key={f.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked.has(f.id)}
                      disabled={saving}
                      onChange={() => toggleFriend(f.id)}
                    />
                    <span>{f.username}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {formError && (
          <p className="pods-form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="pods-dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create pod'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
