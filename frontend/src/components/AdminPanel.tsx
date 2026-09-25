import { formatBytes } from '../lib/format-bytes';
import { formatMoney } from '../lib/format-money';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverflowEdges } from '@/lib/use-overflow-edges';
import {
  listUsers,
  deleteUser,
  clearUserProfile,
  setUserAi,
  setUserRole,
  getAiSpend,
  listReports,
  resolveReport,
  type AdminUserSummary,
  type AdminReportRow,
  type AiSpend,
  type AiSpendWindow,
} from '../lib/admin-api';
import { toast } from '../store/toasts';
import { Modal } from './Modal';
import { OverflowMenu } from './OverflowMenu';

import { userMessage } from '@/lib/user-error';

/** A 404 from a row action means another tab or admin already handled that
 *  row — the outcome the action wanted is what's true, so the panel drops
 *  the row and says so instead of leaving it (and its dialog) in place. */
const isGone = (err: unknown) => (err as { status?: number } | null)?.status === 404;
const REPORT_KIND_LABEL: Record<AdminReportRow['kind'], string> = {
  deck: 'Deck',
  profile: 'Profile',
  'game-result': 'Game result',
};
/** What "Hide" takes down, per kind — the dialog and the toast name it. */
const HIDE_NOUN: Record<AdminReportRow['kind'], string> = {
  deck: 'deck',
  profile: 'profile',
  'game-result': 'game result',
};
const HIDE_BODY: Record<AdminReportRow['kind'], string> = {
  deck: 'This unpublishes the deck immediately. Its public link stops working for everyone, including the owner.',
  profile: 'This hides the profile page and unpublishes every deck this account has published.',
  'game-result':
    'This revokes the shared game result immediately. Its link stops working for everyone, including the person who shared it.',
};
/** Hide toast copy when the target was already taken down some other way —
 *  the UPDATE touched 0 rows, so "Hid the …" would be a lie (E352). */
const HIDE_ALREADY: Record<AdminReportRow['kind'], string> = {
  deck: 'Already unpublished; report closed.',
  profile: 'Already hidden; report closed.',
  'game-result': 'Already revoked; report closed.',
};

/** AI spend is billed in USD whatever the display currency is. */
const usd = (n: number) => formatMoney(n, { currency: 'USD' });

const SPEND_WINDOWS: { key: keyof AiSpend['windows']; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'd7', label: '7 days' },
  { key: 'd30', label: '30 days' },
];

function SpendTile({ label, w }: { label: string; w: AiSpendWindow }) {
  return (
    <div className="deck-stat">
      <span className="deck-stat-value">{usd(w.usd)}</span>
      <span className="deck-stat-label">
        {label} · {w.calls} {w.calls === 1 ? 'call' : 'calls'}
      </span>
    </div>
  );
}

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
  // Role change: the row being granted or revoked, and the in-flight flag.
  // Confirmed rather than one-click — it is the highest-privilege action here.
  const [pendingRole, setPendingRole] = useState<AdminUserSummary | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  // AI access dialog (T114): the row being edited plus its draft fields.
  const [pendingAi, setPendingAi] = useState<AdminUserSummary | null>(null);
  const [aiAccessDraft, setAiAccessDraft] = useState(false);
  const [aiLimitDraft, setAiLimitDraft] = useState('');
  const [savingAi, setSavingAi] = useState(false);

  // AI spend (T116): null while loading; per-user 30-day USD keyed by id so
  // the users table can show a column without a second fetch.
  const [spend, setSpend] = useState<AiSpend | null>(null);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [spendReloadKey, setSpendReloadKey] = useState(0);
  const spendByUser = new Map(spend?.users.map((u) => [u.userId, u.usd]) ?? []);

  useEffect(() => {
    let cancelled = false;
    getAiSpend()
      .then((s) => {
        if (!cancelled) {
          setSpend(s);
          setSpendError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSpendError(userMessage(err, "Couldn't load AI spend. Try again in a moment."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [spendReloadKey]);

  // Reports: null while the initial GET is in flight (mirrors
  // the shares===null loading-sentinel pattern).
  const [reports, setReports] = useState<AdminReportRow[] | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  // Bumped by Retry so the reports effect re-runs.
  const [reportsReloadKey, setReportsReloadKey] = useState(0);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [pendingHide, setPendingHide] = useState<AdminReportRow | null>(null);
  const [hiding, setHiding] = useState(false);

  // The users table scrolls horizontally on narrow viewports. Publish its
  // overflow state as `data-overflow` so the stylesheet can fade the edge with
  // more columns behind it (the Tabs.tsx scroll-strip idiom): without the cue
  // the actions column past the right edge read as clipped layout.
  const usersScrollRef = useRef<HTMLDivElement | null>(null);
  const usersTableMounted = !loading && !error && users.length > 0;
  useOverflowEdges(usersScrollRef, usersTableMounted);

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
      if (isGone(err)) {
        toast.show({ message: `${pending.username} was already deleted.`, tone: 'info' });
        setPending(null);
        await refresh();
        return;
      }
      toast.show({
        message: userMessage(err, "Couldn't delete that account. Try again."),
        tone: 'error',
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handleConfirmRole() {
    if (!pendingRole) return;
    const next = pendingRole.role === 'admin' ? 'user' : 'admin';
    setSavingRole(true);
    try {
      await setUserRole(pendingRole.id, next);
      toast.show({
        message:
          next === 'admin'
            ? `${pendingRole.username} is an admin`
            : `${pendingRole.username} is no longer an admin`,
        tone: 'success',
      });
      setPendingRole(null);
      await refresh();
    } catch (err) {
      if (isGone(err)) {
        toast.show({ message: `${pendingRole.username} was already deleted.`, tone: 'info' });
        setPendingRole(null);
        await refresh();
        return;
      }
      toast.show({
        message: userMessage(err, "Couldn't change that role. Try again."),
        tone: 'error',
      });
    } finally {
      setSavingRole(false);
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
      if (isGone(err)) {
        toast.show({ message: `${pendingClear.username} was already deleted.`, tone: 'info' });
        setPendingClear(null);
        await refresh();
        return;
      }
      toast.show({
        message: userMessage(err, "Couldn't clear that profile. Try again."),
        tone: 'error',
      });
    } finally {
      setClearingProfile(false);
    }
  }

  function openAiDialog(u: AdminUserSummary) {
    setAiAccessDraft(u.aiAccess);
    setAiLimitDraft(u.aiDailyLimit === null ? '' : String(u.aiDailyLimit));
    setPendingAi(u);
  }

  const aiLimitValid = aiLimitDraft.trim() === '' || /^\d+$/.test(aiLimitDraft.trim());

  async function handleSaveAi() {
    if (!pendingAi || !aiLimitValid) return;
    setSavingAi(true);
    try {
      const trimmed = aiLimitDraft.trim();
      await setUserAi(pendingAi.id, {
        access: aiAccessDraft,
        dailyLimit: trimmed === '' ? null : Number(trimmed),
      });
      toast.show({
        message: aiAccessDraft
          ? `AI features on for ${pendingAi.username}`
          : `AI features off for ${pendingAi.username}`,
        tone: 'success',
      });
      setPendingAi(null);
      await refresh();
    } catch (err) {
      if (isGone(err)) {
        toast.show({ message: `${pendingAi.username} was already deleted.`, tone: 'info' });
        setPendingAi(null);
        await refresh();
        return;
      }
      toast.show({
        message: userMessage(err, "Couldn't update AI access. Try again."),
        tone: 'error',
      });
    } finally {
      setSavingAi(false);
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
      if (isGone(err)) {
        setReports((prev) => (prev ? prev.filter((r) => r.id !== report.id) : prev));
        toast.show({ message: 'That report was already handled.', tone: 'info' });
        return;
      }
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
      const { changed } = await resolveReport(pendingHide.id, 'hide');
      setReports((prev) => (prev ? prev.filter((r) => r.id !== pendingHide.id) : prev));
      toast.show({
        message: changed
          ? `Hid the ${HIDE_NOUN[pendingHide.kind]}`
          : HIDE_ALREADY[pendingHide.kind],
        tone: 'success',
      });
      setPendingHide(null);
    } catch (err) {
      if (isGone(err)) {
        setReports((prev) => (prev ? prev.filter((r) => r.id !== pendingHide.id) : prev));
        toast.show({ message: 'That report was already handled.', tone: 'info' });
        setPendingHide(null);
        return;
      }
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
      <section className="settings-card" aria-labelledby="settings-ai-spend-title">
        <header className="settings-card-header">
          <h2 id="settings-ai-spend-title" className="settings-card-title">
            AI spend
          </h2>
          <p className="settings-card-hint">
            Estimated from token counts at list price
            {spend ? ` for ${spend.model}` : ''}. Cached replays cost nothing and aren't counted.
          </p>
        </header>
        <div className="settings-card-body">
          {spendError && (
            <div className="settings-row-hint" role="alert">
              {spendError}{' '}
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setSpendError(null);
                  setSpend(null);
                  setSpendReloadKey((k) => k + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}
          {spend === null && !spendError && (
            <div className="deck-stat-strip admin-spend-strip" aria-hidden="true">
              {SPEND_WINDOWS.map((w) => (
                <div className="deck-stat admin-spend-skeleton" key={w.key}>
                  <div className="admin-report-skeleton-bar is-wide" />
                  <div className="admin-report-skeleton-bar is-narrow" />
                </div>
              ))}
            </div>
          )}
          {spend && (
            <div className="deck-stat-strip admin-spend-strip">
              {SPEND_WINDOWS.map((w) => (
                <SpendTile key={w.key} label={w.label} w={spend.windows[w.key]} />
              ))}
            </div>
          )}
          {spend && spend.windows.d30.calls === 0 && (
            <div className="settings-row-hint">No AI calls in the last 30 days.</div>
          )}
        </div>
      </section>

      <section className="settings-card" aria-labelledby="settings-admin-title">
        <header className="settings-card-header">
          <h2 id="settings-admin-title" className="settings-card-title">
            Manage users
          </h2>
          <p className="settings-card-hint">
            Grant AI features, clear a public profile, or delete an account.
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
            <div className="admin-users-table-scroll" ref={usersScrollRef}>
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th scope="col">Username</th>
                    <th scope="col">Profile</th>
                    <th scope="col">Role</th>
                    <th scope="col">AI</th>
                    <th scope="col">AI spend (30d)</th>
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
                            <span className="admin-profile-cell">
                              {u.displayName}
                              {(u.bio || u.avatarCardName) && (
                                <span className="admin-profile-detail settings-row-hint">
                                  {[u.bio, u.avatarCardName ? `Avatar: ${u.avatarCardName}` : null]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="settings-row-hint">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`admin-role-pill is-${u.role}`}>{u.role}</span>
                        </td>
                        <td>
                          {u.role === 'admin' || u.aiAccess ? (
                            <span className="admin-profile-cell admin-ai-cell">
                              <span className="admin-role-pill is-admin">On</span>
                              {u.aiDailyLimit !== null && (
                                <span className="admin-profile-detail settings-row-hint">
                                  {u.aiDailyLimit}/day
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="admin-role-pill">Off</span>
                          )}
                        </td>
                        <td>
                          {spendByUser.has(u.id) ? (
                            usd(spendByUser.get(u.id)!)
                          ) : (
                            <span className="settings-row-hint">—</span>
                          )}
                        </td>
                        <td>{formatDate(u.createdAt)}</td>
                        <td>{formatBytes(u.dataBytes)}</td>
                        <td>
                          <OverflowMenu
                            ariaLabel={`Actions for ${u.username}`}
                            items={[
                              {
                                label: 'AI access…',
                                onClick: () => openAiDialog(u),
                              },
                              {
                                label: isSelf
                                  ? "Can't change your own role"
                                  : u.role === 'admin'
                                    ? 'Revoke admin…'
                                    : 'Make admin…',
                                disabled: isSelf,
                                onClick: () => setPendingRole(u),
                              },
                              {
                                label: 'Clear profile',
                                danger: true,
                                onClick: () => setPendingClear(u),
                              },
                              {
                                label: isSelf ? "Can't delete your own account here" : 'Delete',
                                danger: true,
                                disabled: isSelf,
                                onClick: () => setPending(u),
                              },
                            ]}
                          />
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

        {pendingAi && (
          <Modal
            onClose={() => !savingAi && setPendingAi(null)}
            labelledBy="admin-ai-title"
            dismissable={!savingAi}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveAi();
              }}
            >
              <h2 id="admin-ai-title" className="choice-dialog-title">
                AI access for {pendingAi.username}
              </h2>
              <p className="choice-dialog-body">
                {pendingAi.role === 'admin'
                  ? 'Admins always have AI features. The daily limit still applies.'
                  : 'Opens the AI features to this account. They still choose to turn them on from their own AI panel.'}
              </p>
              <div className="admin-ai-fields">
                <label className="field-checkbox">
                  <input
                    type="checkbox"
                    checked={aiAccessDraft}
                    onChange={(e) => setAiAccessDraft(e.target.checked)}
                    disabled={savingAi || pendingAi.role === 'admin'}
                  />
                  Allow AI features
                </label>
                <div className="field">
                  <label htmlFor="admin-ai-limit">Daily limit</label>
                  <input
                    id="admin-ai-limit"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    placeholder="App default"
                    value={aiLimitDraft}
                    onChange={(e) => setAiLimitDraft(e.target.value)}
                    disabled={savingAi}
                    aria-invalid={!aiLimitValid}
                    aria-describedby="admin-ai-limit-hint"
                  />
                  <span id="admin-ai-limit-hint" className="settings-row-hint">
                    {aiLimitValid
                      ? 'Reviews per day. Leave blank for the app default.'
                      : 'Use a whole number, or leave it blank.'}
                  </span>
                </div>
              </div>
              <div className="choice-dialog-actions admin-modal-actions">
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => setPendingAi(null)}
                  disabled={savingAi}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pill-btn pill-btn-primary"
                  disabled={savingAi || !aiLimitValid}
                >
                  {savingAi ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {pendingRole && (
          <Modal
            onClose={() => !savingRole && setPendingRole(null)}
            labelledBy="admin-role-title"
            dismissable={!savingRole}
          >
            <h2 id="admin-role-title" className="choice-dialog-title">
              {pendingRole.role === 'admin' ? 'Revoke admin?' : 'Make admin?'}
            </h2>
            <p className="choice-dialog-body">
              {pendingRole.role === 'admin' ? (
                <>
                  <strong>{pendingRole.username}</strong> loses the admin panel, and with it every
                  account, report, and AI control on this page. Their own data is untouched.
                </>
              ) : (
                <>
                  <strong>{pendingRole.username}</strong> gets this panel: every account, every
                  report, the AI controls, and the ability to delete accounts. Grant it to people
                  you would trust with all of it.
                </>
              )}
            </p>
            <div className="choice-dialog-actions admin-modal-actions">
              <button
                type="button"
                className="pill-btn"
                onClick={() => setPendingRole(null)}
                disabled={savingRole}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  pendingRole.role === 'admin'
                    ? 'pill-btn pill-btn-danger'
                    : 'pill-btn pill-btn-primary'
                }
                onClick={() => void handleConfirmRole()}
                disabled={savingRole}
              >
                {savingRole
                  ? 'Saving…'
                  : pendingRole.role === 'admin'
                    ? 'Revoke admin'
                    : 'Make admin'}
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
              They can set a new profile any time. This only removes what's there now.
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
          <p className="choice-dialog-body">{HIDE_BODY[pendingHide.kind]}</p>
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
