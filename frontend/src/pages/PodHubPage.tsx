import './PodHubPage.css';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Layers, Pencil } from 'lucide-react';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackedBar } from '../components/shared/MeterBar';
import { gameFormatLabel } from '../lib/game-formats';
import { listFriends, type Friend } from '../lib/friends-client';
import { getFriendShares, type FriendShareRow } from '../lib/share-client';
import {
  acceptPodInvite,
  declinePodInvite,
  deletePod,
  fetchPodGames,
  fetchPodLeaderboard,
  getPod,
  invitePodMembers,
  removePodMember,
  renamePod,
  PodNotFoundError,
  type PodDetail,
  type PodGameResult,
  type PodMember,
  type PodStanding,
} from '../lib/pods-client';

const POD_NAME_MAX = 60;

type GamesFetch =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; games: PodGameResult[] };

type LeaderboardFetch =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; standings: PodStanding[] };

/** "What the pod plays" per-member resolution — a mutual friend's fetched
 *  deck shares (never fetched at all for a non-friend, per the spec's "zero
 *  new backend calls beyond one getFriendShares per mutual friend" rule). */
type MemberDecks =
  | { kind: 'not-friend' }
  | { kind: 'loading' }
  | { kind: 'ready'; shares: FriendShareRow[] };

function BackLink() {
  return (
    <Link to="/pods" className="pod-hub-back">
      <ArrowLeft width={16} height={16} aria-hidden />
      Pods
    </Link>
  );
}

export function PodHubPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUserId = useAuth((s) => s.user?.id ?? null);

  const [pod, setPod] = useState<PodDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inviteRespondBusy, setInviteRespondBusy] = useState(false);

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PodMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [gamesFetch, setGamesFetch] = useState<GamesFetch>({ status: 'loading' });
  const [leaderboardFetch, setLeaderboardFetch] = useState<LeaderboardFetch>({ status: 'loading' });

  const [friends, setFriends] = useState<Friend[] | null>(null);
  // Only ever holds RESOLVED per-member deck shares — the 'loading' and
  // 'not-friend' states are derived at render time (see memberDeckState)
  // rather than seeded via a synchronous setState in an effect.
  const [memberDecks, setMemberDecks] = useState<Record<string, FriendShareRow[]>>({});

  // All state-setting happens inside the promise callbacks (never
  // synchronously in the function body) so calling this from an effect never
  // triggers cascading synchronous renders — mirrors FriendHubPage.tsx's own
  // fetch effects.
  const loadPod = useCallback(() => {
    if (!id) return;
    getPod(id)
      .then((p) => {
        setNotFound(false);
        setLoadError(null);
        setPod(p);
      })
      .catch((err: unknown) => {
        if (err instanceof PodNotFoundError) setNotFound(true);
        else setLoadError(err instanceof Error ? err.message : 'Failed to load pod.');
      });
  }, [id]);

  useEffect(() => {
    loadPod();
  }, [loadPod]);

  const isMember = pod?.myStatus === 'member';

  const loadGames = useCallback(() => {
    if (!id) return;
    fetchPodGames(id)
      .then((games) => setGamesFetch({ status: 'ready', games }))
      .catch((err: unknown) => {
        setGamesFetch({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load shared history.',
        });
      });
  }, [id]);

  const loadLeaderboard = useCallback(() => {
    if (!id) return;
    fetchPodLeaderboard(id)
      .then((standings) => setLeaderboardFetch({ status: 'ready', standings }))
      .catch((err: unknown) => {
        setLeaderboardFetch({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load the leaderboard.',
        });
      });
  }, [id]);

  useEffect(() => {
    if (isMember) {
      loadGames();
      loadLeaderboard();
    }
  }, [isMember, loadGames, loadLeaderboard]);

  useEffect(() => {
    if (!isMember) return;
    let cancelled = false;
    listFriends()
      .then((f) => {
        if (!cancelled) setFriends(f);
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isMember]);

  // Every OTHER active member of the pod — "what the pod plays" never shows a
  // row for the viewer's own membership (nothing to friend-gate about your
  // own decks).
  const otherMembers = useMemo(
    () =>
      pod ? pod.members.filter((m) => m.status === 'member' && m.userId !== currentUserId) : [],
    [pod, currentUserId]
  );

  const friendIds = useMemo(() => new Set((friends ?? []).map((f) => f.id)), [friends]);

  useEffect(() => {
    const mutual = otherMembers.filter((m) => friendIds.has(m.userId));
    if (mutual.length === 0) return;
    let cancelled = false;
    Promise.allSettled(mutual.map((m) => getFriendShares(m.userId))).then((results) => {
      if (cancelled) return;
      setMemberDecks((prev) => {
        const next = { ...prev };
        mutual.forEach((m, i) => {
          const r = results[i];
          // A fetch failure folds into "no decks shared yet" rather than a
          // 4th visible state — see the section's Risks note (v1 tradeoff).
          next[m.userId] =
            r.status === 'fulfilled' ? r.value.shares.filter((s) => s.kind === 'deck') : [];
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [otherMembers, friendIds]);

  /** Render-time resolution for one member's "what the pod plays" row —
   *  'loading' while the friends list or that member's own fetch is still in
   *  flight, 'not-friend' once we know they aren't a mutual friend (no fetch
   *  ever fires for them), else the resolved (possibly empty) deck shares. */
  function memberDeckState(userId: string): MemberDecks {
    const resolved = memberDecks[userId];
    if (resolved !== undefined) return { kind: 'ready', shares: resolved };
    if (friends === null) return { kind: 'loading' };
    return friendIds.has(userId) ? { kind: 'loading' } : { kind: 'not-friend' };
  }

  async function handleAcceptInvite() {
    if (!pod) return;
    setInviteRespondBusy(true);
    try {
      await acceptPodInvite(pod.id);
      toast.show({ message: `You joined ${pod.name}.`, tone: 'success' });
      loadPod();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't accept the invite.",
        tone: 'error',
      });
    } finally {
      setInviteRespondBusy(false);
    }
  }

  async function handleDeclineInvite() {
    if (!pod) return;
    setInviteRespondBusy(true);
    try {
      await declinePodInvite(pod.id);
      toast.show({ message: `Declined the invite to ${pod.name}.`, tone: 'info' });
      navigate('/pods');
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't decline the invite.",
        tone: 'error',
      });
      setInviteRespondBusy(false);
    }
  }

  function startRename() {
    if (!pod) return;
    setDraftName(pod.name);
    setRenaming(true);
  }
  function cancelRename() {
    setRenaming(false);
  }
  async function commitRename() {
    if (!pod) return;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === pod.name) {
      setRenaming(false);
      return;
    }
    try {
      const newName = await renamePod(pod.id, trimmed);
      setPod((prev) => (prev ? { ...prev, name: newName } : prev));
      setRenaming(false);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't rename the pod.",
        tone: 'error',
      });
    }
  }

  async function handleRemoveMember() {
    if (!pod || !removeTarget) return;
    setRemoveBusy(true);
    try {
      await removePodMember(pod.id, removeTarget.userId);
      toast.show({ message: `Removed ${removeTarget.username} from ${pod.name}.`, tone: 'info' });
      setRemoveTarget(null);
      loadPod();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't remove that member.",
        tone: 'error',
      });
    } finally {
      setRemoveBusy(false);
    }
  }

  async function handleDeletePod() {
    if (!pod) return;
    setDeleteBusy(true);
    try {
      await deletePod(pod.id);
      toast.show({ message: `Deleted ${pod.name}.`, tone: 'info' });
      navigate('/pods');
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't delete the pod.",
        tone: 'error',
      });
      setDeleteBusy(false);
      setDeleteConfirmOpen(false);
    }
  }

  function handleInvited(count: number) {
    setInviteOpen(false);
    toast.show({
      message: `Invited ${count} ${count === 1 ? 'person' : 'people'}.`,
      tone: 'success',
    });
    loadPod();
  }

  // ── Not-found / error / loading ─────────────────────────────────────────
  if (notFound) {
    return (
      <div className="pod-hub">
        <div className="empty-state" role="status">
          <p className="empty-state-tagline">Pod not found.</p>
          <p className="empty-state-hint">
            It may have been deleted, or you don't have access to it.
          </p>
          <Link to="/pods" className="btn btn-primary">
            Back to pods
          </Link>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="pod-hub">
        <BackLink />
        <p className="friends-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="friends-error-retry" onClick={loadPod}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  if (!pod) {
    return (
      <div className="pod-hub">
        <BackLink />
        <div className="pod-hub-skeleton" aria-label="Loading" aria-busy="true">
          <span className="pod-hub-skeleton-bar is-title" />
          <span className="pod-hub-skeleton-bar" />
          <span className="pod-hub-skeleton-bar" />
          <span className="pod-hub-skeleton-bar" />
        </div>
      </div>
    );
  }

  const isOwner = currentUserId != null && pod.ownerUserId === currentUserId;
  const activeMembers = pod.members.filter((m) => m.status === 'member');
  const invitedMembers = pod.members.filter((m) => m.status === 'invited');
  const existingMemberIds = new Set(pod.members.map((m) => m.userId));

  return (
    <div className="pod-hub">
      <BackLink />

      <header className="pod-hub-header">
        <h1 className="pod-hub-name">
          {renaming ? (
            <span
              className="pod-hub-name-edit"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void commitRename();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelRename();
              }}
            >
              <input
                autoFocus
                type="text"
                className="pod-hub-name-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename();
                }}
                maxLength={POD_NAME_MAX}
                aria-label="Pod name"
              />
              <button type="button" className="btn btn-primary" onClick={() => void commitRename()}>
                Done
              </button>
            </span>
          ) : isOwner ? (
            <button
              type="button"
              className="pod-hub-name-btn"
              onClick={startRename}
              title="Rename pod"
            >
              {pod.name}
              <Pencil width={14} height={14} strokeWidth={1.8} aria-hidden />
            </button>
          ) : (
            pod.name
          )}
        </h1>
        {isOwner && (
          <div className="pod-hub-header-actions">
            <button type="button" className="btn" onClick={() => setInviteOpen(true)}>
              Invite more people
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete pod
            </button>
          </div>
        )}
      </header>

      {pod.myStatus === 'invited' && (
        <div className="pod-hub-invite-banner" role="status">
          <p className="pod-hub-invite-banner-text">You've been invited to this pod.</p>
          <div className="pod-hub-invite-banner-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleAcceptInvite()}
              disabled={inviteRespondBusy}
            >
              {inviteRespondBusy ? '…' : 'Accept'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleDeclineInvite()}
              disabled={inviteRespondBusy}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <section className="pod-hub-section" aria-label="Pod roster">
        <h2 className="pod-hub-section-head">Members</h2>
        <ul className="pod-hub-roster">
          {activeMembers.map((m) => (
            <li key={m.userId} className="pod-hub-roster-row">
              <span className="pod-hub-roster-name">{m.username}</span>
              {m.userId === pod.ownerUserId && (
                <span className="pod-hub-roster-owner-tag">Owner</span>
              )}
              {isOwner && m.userId !== pod.ownerUserId && (
                <button
                  type="button"
                  className="pod-hub-roster-remove"
                  onClick={() => setRemoveTarget(m)}
                  aria-label={`Remove ${m.username} from pod`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {invitedMembers.length > 0 && (
          <>
            <h2 className="pod-hub-section-head">Invited</h2>
            <ul className="pod-hub-roster">
              {invitedMembers.map((m) => (
                <li key={m.userId} className="pod-hub-roster-row">
                  <span className="pod-hub-roster-name">{m.username}</span>
                  <span className="pod-hub-roster-pending">Invited</span>
                  {isOwner && (
                    <button
                      type="button"
                      className="pod-hub-roster-remove"
                      onClick={() => setRemoveTarget(m)}
                      aria-label={`Remove ${m.username} from pod`}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {isMember && (
        <>
          <div className="deck-stats-pair pod-hub-stats-pair">
            <div className="deck-stats-panel">
              <h2 className="deck-stats-panel-title">Shared history</h2>
              {gamesFetch.status === 'loading' ? (
                <div className="pod-hub-table-skeleton" aria-label="Loading" aria-busy="true" />
              ) : gamesFetch.status === 'error' ? (
                <p className="friends-error" role="alert">
                  <span>{gamesFetch.message}</span>
                  <button type="button" className="friends-error-retry" onClick={loadGames}>
                    Retry
                  </button>
                </p>
              ) : gamesFetch.games.length === 0 ? (
                <p className="pod-hub-stats-empty">No games yet — get a game night on the books.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="play-records-table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Format</th>
                        <th scope="col">Players</th>
                        <th scope="col">Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamesFetch.games.map((g) => {
                        const winner = g.participants.find((p) => p.seat === g.winnerSeat);
                        const names = g.participants.map((p) => p.name).join(', ');
                        return (
                          <tr key={g.sessionId}>
                            <td>{new Date(g.endedAt).toLocaleDateString()}</td>
                            <td>{gameFormatLabel(g.format) ?? g.format}</td>
                            <td className="pod-hub-players-cell" title={names}>
                              {names}
                            </td>
                            <td>{winner ? winner.name : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="deck-stats-panel">
              <h2 className="deck-stats-panel-title">Leaderboard</h2>
              {leaderboardFetch.status === 'loading' ? (
                <div className="pod-hub-table-skeleton" aria-label="Loading" aria-busy="true" />
              ) : leaderboardFetch.status === 'error' ? (
                <p className="friends-error" role="alert">
                  <span>{leaderboardFetch.message}</span>
                  <button type="button" className="friends-error-retry" onClick={loadLeaderboard}>
                    Retry
                  </button>
                </p>
              ) : leaderboardFetch.standings.length === 0 ? (
                <p className="pod-hub-stats-empty">No games yet — get a game night on the books.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="play-records-table">
                    <thead>
                      <tr>
                        <th scope="col">Member</th>
                        <th scope="col">Played</th>
                        <th scope="col">W</th>
                        <th scope="col">Win%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardFetch.standings.map((s) => (
                        <tr key={s.userId}>
                          <td>{s.username}</td>
                          <td>{s.played}</td>
                          <td>{s.wins}</td>
                          <td className="pod-hub-winrate-cell">
                            <StackedBar
                              className="pod-hub-winrate-bar"
                              segments={[
                                { key: 'w', value: s.wins, color: 'var(--success)' },
                                { key: 'l', value: s.played - s.wins, color: 'var(--err-text)' },
                              ]}
                              max={s.played}
                            />
                            <span>{s.played > 0 ? `${Math.round(s.winRate * 100)}%` : '—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {otherMembers.length > 0 && (
            <section className="pod-hub-section" aria-label="What the pod plays">
              <h2 className="pod-hub-section-head">What the pod plays</h2>
              <ul className="pod-hub-wtpp-list">
                {otherMembers.map((m) => {
                  const state = memberDeckState(m.userId);
                  return (
                    <li key={m.userId} className="pod-hub-wtpp-row">
                      <span className="pod-hub-wtpp-name">{m.username}</span>
                      {state.kind === 'loading' ? (
                        <span className="pod-hub-wtpp-status">Checking…</span>
                      ) : state.kind === 'not-friend' ? (
                        <span className="pod-hub-wtpp-status">Friend them to see decks</span>
                      ) : state.shares.length === 0 ? (
                        <span className="pod-hub-wtpp-status">No decks shared yet</span>
                      ) : (
                        <>
                          <span className="pod-hub-wtpp-status">
                            {state.shares.length} {state.shares.length === 1 ? 'deck' : 'decks'}
                          </span>
                          <ul className="pod-hub-wtpp-decks">
                            {state.shares.map((s) => (
                              <li key={s.token} className="pod-hub-wtpp-deck-row">
                                <Layers width={14} height={14} strokeWidth={1.8} aria-hidden />
                                <span className="pod-hub-wtpp-deck-name" title={s.label}>
                                  {s.label}
                                </span>
                                <Link
                                  to={`/s/${s.token}`}
                                  className="pod-hub-wtpp-deck-open"
                                  aria-label={`View ${s.label}`}
                                >
                                  View
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {inviteOpen && (
        <InviteMembersDialog
          podId={pod.id}
          existingIds={existingMemberIds}
          onClose={() => setInviteOpen(false)}
          onInvited={handleInvited}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          title={`Remove ${removeTarget.username} from ${pod.name}?`}
          body="They'll lose access to the pod immediately."
          confirmLabel={removeBusy ? 'Removing…' : 'Remove'}
          danger
          onConfirm={() => void handleRemoveMember()}
          onCancel={() => setRemoveTarget(null)}
        />
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={`Delete "${pod.name}"?`}
          body="This removes the pod for everyone in it. This cannot be undone."
          confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
          danger
          onConfirm={() => void handleDeletePod()}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function InviteMembersDialog({
  podId,
  existingIds,
  onClose,
  onInvited,
}: {
  podId: string;
  existingIds: Set<string>;
  onClose: () => void;
  onInvited: (count: number) => void;
}) {
  const titleId = useId();
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
        if (!cancelled) setFriendsFetch({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Friends already on the roster (member or still-invited) aren't candidates
  // — re-inviting them is a no-op the owner shouldn't have to think about.
  const candidates = useMemo(
    () =>
      friendsFetch.status === 'ready'
        ? friendsFetch.friends.filter((f) => !existingIds.has(f.id))
        : [],
    [friendsFetch, existingIds]
  );

  function toggleFriend(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (checked.size === 0) {
      setFormError('Pick at least one friend to invite.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const result = await invitePodMembers(podId, Array.from(checked));
      onInvited(result.invited.length);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't send invites — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} dismissable={!saving}>
      <form
        className="pod-hub-invite-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id={titleId} className="pod-hub-invite-dialog-title">
          Invite more people
        </h2>

        <fieldset className="pod-hub-invite-fieldset">
          <legend>Friends</legend>
          {friendsFetch.status === 'loading' ? (
            <p className="pod-hub-invite-hint">Loading friends…</p>
          ) : friendsFetch.status === 'error' ? (
            <p className="pod-hub-invite-hint">
              Couldn't load your friends list — try again shortly.
            </p>
          ) : candidates.length === 0 ? (
            <p className="pod-hub-invite-hint">
              {friendsFetch.friends.length === 0
                ? "You don't have any friends yet."
                : "Everyone you're friends with is already in this pod."}
            </p>
          ) : (
            <ul className="pod-hub-invite-list">
              {candidates.map((f) => (
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
          <p className="pod-hub-form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="pod-hub-invite-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
