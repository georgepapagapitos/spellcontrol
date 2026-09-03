import { formatBytes } from '../lib/format-bytes';
import { useCallback, useEffect, useState } from 'react';
import {
  listUsers,
  deleteUser,
  clearUserProfile,
  listReports,
  resolveReport,
  type AdminUserSummary,
  type AdminReportRow,
} from '../lib/admin-api';
import { toast } from '../store/toasts';
import { Modal } from './Modal';

import { userMessage } from '@/lib/user-error';
const REPORT_KIND_LABEL: Record<AdminReportRow['kind'], string> = {
  deck: 'Deck',
  profile: 'Profile',
  'game-result': 'Game result',
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminUserSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingClear, setPendingClear] = useState<AdminUserSummary | null>(null);
  const [clearingProfile, setClearingProfile] = useState(false);

  // Reports: null while the initial GET is in flight (mirrors
  // SharedLinksSettings' shares===null loading sentinel).
  const [reports, setReports] = useState<AdminReportRow[] | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  // Bumped by Retry so the reports effect re-runs.
  const [reportsReloadKey, setReportsReloadKey] = useState(0);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [pendingHide, setPendingHide] = useState<AdminReportRow | null>(null);
  const [hiding, setHiding] = useState(false);

  // Refreshes the list (used after mount and after a successful delete). The
  // *initial* load goes through the useEffect below directly to avoid a
  // synchronous setLoading(true) inside an effect body (react-hooks lint rule).
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listUsers();
      setUsers(list);
    } catch (err) {
      setError(userMessage(err, "Couldn't load accounts. Try again in a moment."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listUsers();
        if (!cancelled) setUsers(list);
      } catch (err) {
        if (!cancelled) {
          setError(userMessage(err, "Couldn't load accounts. Try again in a moment."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConfirmDelete() {
    if (!pending) return;
    setDeleting(true);
    try {
      await deleteUser(pending.id);
      toast.show({ message: `Deleted ${pending.username}`, tone: 'success' });
      setPending(null);
      await refresh();
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't delete that account. Try again."),
        tone: 'error',
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handleConfirmClearProfile() {
    if (!pendingClear) return;
    setClearingProfile(true);
    try {
      await clearUserProfile(pendingClear.id);
      toast.show({ message: `Cleared ${pendingClear.username}'s profile`, tone: 'success' });
      setPendingClear(null);
      await refresh();
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't clear that profile. Try again."),
        tone: 'error',
      });
    } finally {
      setClearingProfile(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    listReports()
      .then((rows) => {
        if (!cancelled) {
          setReports(rows);
          setReportsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setReportsError(userMessage(err, "Couldn't load reports. Try again in a moment."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reportsReloadKey]);

  async function handleDismiss(report: AdminReportRow) {
    setDismissingId(report.id);
    try {
      await resolveReport(report.id, 'dismiss');
      // Optimistic: drop it locally rather than re-fetching the whole list.
      setReports((prev) => (prev ? prev.filter((r) => r.id !== report.id) : prev));
      toast.show({ message: 'Dismissed report', tone: 'success' });
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't dismiss that report. Try again."),
        tone: 'error',
      });
    } finally {
      setDismissingId(null);
    }
  }

  async function handleConfirmHide() {
    if (!pendingHide) return;
    setHiding(true);
    try {
      await resolveReport(pendingHide.id, 'hide');
      setReports((prev) => (prev ? prev.filter((r) => r.id !== pendingHide.id) : prev));
      toast.show({
        message: `Hid the ${pendingHide.kind === 'profile' ? 'profile' : 'deck'}`,
        tone: 'success',
      });
      setPendingHide(null);
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't hide that content. Try again."),
        tone: 'error',
      });
    } finally {
      setHiding(false);
    }
  }

  return (
    <>
      <section className="settings-card" aria-labelledby="settings-admin-title">
        <header className="settings-card-header">
          <h2 id="settings-admin-title" className="settings-card-title">
            Admin — manage users
          </h2>
          <p className="settings-card-hint">
            Visible because your role is <strong>admin</strong>. Other users won't see this card.
          </p>
        </header>
        <div className="settings-card-body">
          {loading && <div className="settings-row-hint">Loading users…</div>}
          {error && (
            <div className="settings-row-hint" role="alert">
              {error}{' '}
              <button type="button" className="btn-link" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {!loading && !error && users.length === 0 && (
            <div className="settings-row-hint">No users yet.</div>
          )}
          {!loading && !error && users.length > 0 && (
            <div className="admin-users-table-scroll">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th scope="col">Username</th>
                    <th scope="col">Profile</th>
                    <th scope="col">Role</th>
                    <th scope="col">Registered</th>
                    <th scope="col">Data</th>
                    <th scope="col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === currentUserId;
                    return (
                      <tr key={u.id}>
                        <td>{u.username}</td>
                        <td>
                          {u.displayName ? (
                            <span
                              title={
                                [u.bio, u.avatarCardName ? `Avatar: ${u.avatarCardName}` : null]
                                  .filter(Boolean)
                                  .join(' · ') || undefined
                              }
                            >
                              {u.displayName}
                            </span>
                          ) : (
                            <span className="settings-row-hint">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`admin-role-pill is-${u.role}`}>{u.role}</span>
                        </td>
                        <td>{formatDate(u.createdAt)}</td>
                        <td>{formatBytes(u.dataBytes)}</td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="pill-btn pill-btn-danger"
                              aria-label={`Clear profile for ${u.username}`}
                              onClick={() => setPendingClear(u)}
                            >
                              Clear profile
                            </button>
                            <button
                              type="button"
                              className="pill-btn pill-btn-danger"
                              disabled={isSelf}
                              title={
                                isSelf ? "You can't delete your own account here." : 'Delete user'
                              }
                              onClick={() => setPending(u)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pending && (
          <Modal
            onClose={() => !deleting && setPending(null)}
            labelledBy="admin-delete-title"
            dismissable={!deleting}
          >
            <h2 id="admin-delete-title" className="choice-dialog-title">
              Delete {pending.username}?
            </h2>
            <p className="choice-dialog-body">
              This permanently removes the account and all of <strong>{pending.username}</strong>
              's synced collection, binders, decks, and game history. This can't be undone.
            </p>
            <div className="choice-dialog-actions admin-modal-actions">
              <button
                type="button"
                className="pill-btn"
                onClick={() => setPending(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pill-btn pill-btn-danger"
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </Modal>
        )}

        {pendingClear && (
          <Modal
            onClose={() => !clearingProfile && setPendingClear(null)}
            labelledBy="admin-clear-profile-title"
            dismissable={!clearingProfile}
          >
            <h2 id="admin-clear-profile-title" className="choice-dialog-title">
              Clear profile?
            </h2>
            <p className="choice-dialog-body">
              This clears <strong>{pendingClear.username}</strong>'s display name, bio, and avatar.
              They can set a new profile any time — this only removes what's there now.
            </p>
            <div className="choice-dialog-actions admin-modal-actions">
              <button
                type="button"
                className="pill-btn"
                onClick={() => setPendingClear(null)}
                disabled={clearingProfile}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pill-btn pill-btn-danger"
                onClick={() => void handleConfirmClearProfile()}
                disabled={clearingProfile}
              >
                {clearingProfile ? 'Clearing…' : 'Clear profile'}
              </button>
            </div>
          </Modal>
        )}
      </section>

      <section className="settings-card" role="group" aria-labelledby="settings-reports-title">
        <header className="settings-card-header">
          <h2 id="settings-reports-title" className="settings-card-title">
            Reports
          </h2>
          <p className="settings-card-hint">
            Content reported by users. Hiding a deck or profile takes it off the platform
            immediately.
          </p>
        </header>
        <div className="settings-card-body">
          {reportsError && (
            <div className="settings-row-hint" role="alert">
              {reportsError}{' '}
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setReportsError(null);
                  setReports(null);
                  setReportsReloadKey((k) => k + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}
          {reports === null &&
            !reportsError &&
            [0, 1].map((i) => (
              <div className="settings-row" key={`report-skeleton-${i}`} aria-hidden="true">
                <div className="settings-row-text">
                  <div className="admin-report-skeleton-bar is-wide" />
                  <div className="admin-report-skeleton-bar is-narrow" />
                </div>
              </div>
            ))}
          {reports?.length === 0 && !reportsError && (
            <div className="settings-row-hint">No open reports.</div>
          )}
          {reports?.map((r) => {
            const dismissing = dismissingId === r.id;
            return (
              <div className="settings-row" key={r.id}>
                <div className="settings-row-text">
                  <div className="settings-row-value">
                    <span className="settings-share-kind">{REPORT_KIND_LABEL[r.kind]}</span>{' '}
                    {r.targetLabel}
                  </div>
                  <div className="settings-row-hint">
                    {r.reporterUsername ?? 'Anonymous'} · {new Date(r.createdAt).toLocaleString()}
                  </div>
                  <div className="settings-row-hint">{r.reason}</div>
                </div>
                <div className="settings-row-actions">
                  <button
                    type="button"
                    className="pill-btn"
                    disabled={dismissing}
                    onClick={() => void handleDismiss(r)}
                  >
                    {dismissing ? 'Dismissing…' : 'Dismiss'}
                  </button>
                  <button
                    type="button"
                    className="pill-btn pill-btn-danger"
                    disabled={dismissing}
                    onClick={() => setPendingHide(r)}
                  >
                    Hide
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {pendingHide && (
        <Modal
          onClose={() => !hiding && setPendingHide(null)}
          labelledBy="admin-hide-report-title"
          dismissable={!hiding}
        >
          <h2 id="admin-hide-report-title" className="choice-dialog-title">
            Hide this content?
          </h2>
          <p className="choice-dialog-body">
            {pendingHide.kind === 'profile'
              ? 'This hides the profile page and unpublishes every deck this account has published.'
              : 'This unpublishes the deck immediately — its public link stops working for everyone, including the owner.'}
          </p>
          <div className="choice-dialog-actions admin-modal-actions">
            <button
              type="button"
              className="pill-btn"
              onClick={() => setPendingHide(null)}
              disabled={hiding}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pill-btn pill-btn-danger"
              onClick={() => void handleConfirmHide()}
              disabled={hiding}
            >
              {hiding ? 'Hiding…' : 'Hide'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
