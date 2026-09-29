import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { preventFocusSteal } from '@/lib/util/keyboard';
import { useSignInPath } from '@/lib/account/sign-in-path';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toasts';
import { Modal } from '@/components/overlays/Modal';
import {
  fetchIdentities,
  googleLinkUrl,
  requestEmailChange,
  resendEmailVerification,
  setNotifyEmail,
  unlinkGoogle,
  updatePassword,
  type MyIdentities,
} from '@/lib/account/auth-api';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { SyncIndicator } from '@/components/account/SyncIndicator';
import { getPendingCount } from '@/lib/sync';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SwitchRow } from '@/components/shared/form';
import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';

/**
 * Account: how you sign in, what reaches your inbox, this device's session,
 * and deleting the account. A guest sees the one row that changes all of
 * that: sign in.
 */
export function AccountSection() {
  const username = useAuth((s) => s.user?.username ?? null);
  const signInHref = useSignInPath();
  const logout = useAuth((s) => s.logout);
  const deleteAccount = useAuth((s) => s.deleteAccount);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Linked sign-in methods, plus the in-flight states for each flow.
  const [identities, setIdentities] = useState<MyIdentities | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailResendBusy, setEmailResendBusy] = useState(false);
  const [notifyEmailBusy, setNotifyEmailBusy] = useState(false);
  // Sign-out confirmation. `signOutPending` snapshots the unsynced-change count
  // at the moment the dialog opens so the copy can warn about data loss.
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutPending, setSignOutPending] = useState(0);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Best-effort: a failure leaves `identities` null, which hides the
  // sign-in cards rather than blocking the page on them.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    fetchIdentities()
      .then((r) => {
        if (!cancelled) setIdentities(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  // The link-Google callback lands here (`/settings?linked=google` is
  // forwarded to this section with its query intact). Toast once, then clear
  // the query so a refresh doesn't fire it again.
  useEffect(() => {
    const linked = searchParams.get('linked');
    const linkError = searchParams.get('linkError');
    if (!linked && !linkError) return;
    if (linked === 'google') {
      toast.show({ message: 'Google account linked.', tone: 'success' });
    } else if (linkError) {
      const msg =
        linkError === 'already_linked'
          ? 'That Google account is already linked to a different SpellControl account.'
          : linkError === 'has_google'
            ? 'This account already has a Google account linked. Unlink it first.'
            : "Couldn't link Google account.";
      toast.show({ message: msg, tone: 'error' });
    }
    setSearchParams(
      (p) => {
        p.delete('linked');
        p.delete('linkError');
        return p;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  function handleLinkGoogle() {
    setLinkBusy(true);
    window.location.href = googleLinkUrl();
  }

  async function refreshIdentities() {
    try {
      setIdentities(await fetchIdentities());
    } catch {
      /* ignore — the row keeps showing whatever it last knew */
    }
  }

  async function handleResendVerification() {
    setEmailResendBusy(true);
    try {
      await resendEmailVerification();
      toast.show({ message: 'Verification email sent.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't resend the verification email."),
        tone: 'error',
      });
    } finally {
      setEmailResendBusy(false);
    }
  }

  async function handleToggleNotifyEmail() {
    if (!identities) return;
    const next = !identities.notifyEmail;
    setNotifyEmailBusy(true);
    setIdentities({ ...identities, notifyEmail: next }); // optimistic
    try {
      await setNotifyEmail(next);
    } catch (err) {
      setIdentities(identities); // revert
      toast.show({
        message: userMessage(err, "Couldn't update email notifications."),
        tone: 'error',
      });
    } finally {
      setNotifyEmailBusy(false);
    }
  }

  async function handleUnlinkGoogle() {
    setUnlinkBusy(true);
    try {
      await unlinkGoogle();
      setIdentities(await fetchIdentities());
      toast.show({ message: 'Google account unlinked.', tone: 'success' });
      setUnlinkOpen(false);
    } catch (err) {
      toast.show({ message: userMessage(err, "Couldn't unlink Google."), tone: 'error' });
    } finally {
      setUnlinkBusy(false);
    }
  }

  function openSignOut() {
    setSignOutPending(getPendingCount());
    setSignOutOpen(true);
  }

  async function handleLogout() {
    setSignOutBusy(true);
    try {
      await logout();
      // The sign-in screen is dismissable ("Continue without an account"),
      // so this is a convenience, not a wall.
      navigate('/auth');
    } finally {
      setSignOutBusy(false);
      setSignOutOpen(false);
    }
  }

  async function handleConfirmDelete() {
    setDeleteBusy(true);
    try {
      const ok = await deleteAccount();
      if (ok) {
        // Account and local data are gone. A toast would unmount with the
        // page, so landing on the sign-in screen is the feedback.
        setDeleteStep(0);
        navigate('/auth');
      } else {
        toast.show({
          message: useAuth.getState().error ?? "Couldn't delete your account. Try again.",
          tone: 'error',
        });
        setDeleteStep(0);
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  if (!username) {
    return (
      <SettingsSection id="settings-account-title" title="Sign in">
        <SettingsRow
          label="Not signed in"
          hint="Saved on this device. Sign in to sync it to your account."
          actions={
            <Button variant="primary" placement="row" to={signInHref}>
              Sign in to sync
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  return (
    <>
      {identities && (
        <SettingsSection id="settings-signin-title" title="Sign-in methods">
          <SettingsRow
            label="Password"
            hint={identities.password ? 'Set' : 'Not set'}
            actions={
              <Button onClick={() => setPasswordModalOpen(true)}>
                {identities.password ? 'Change password' : 'Set password'}
              </Button>
            }
          />
          <SettingsRow
            label="Email"
            hint={
              identities.emailVerified && identities.pendingEmail
                ? `${identities.email}, change to ${identities.pendingEmail} pending verification`
                : identities.emailVerified
                  ? identities.email
                  : identities.pendingEmail
                    ? `Pending verification, ${identities.pendingEmail}`
                    : 'Not set'
            }
            actions={
              <div className="settings-row-action-group">
                {identities.pendingEmail && (
                  <Button
                    onClick={() => void handleResendVerification()}
                    disabled={emailResendBusy}
                  >
                    {emailResendBusy ? 'Sending…' : 'Resend'}
                  </Button>
                )}
                <Button onClick={() => setEmailModalOpen(true)}>
                  {identities.emailVerified || identities.pendingEmail ? 'Change' : 'Add'}
                </Button>
              </div>
            }
          >
            {!identities.emailVerified && (
              <div className="settings-row-hint">
                Add a verified email so you can reset your password if you get locked out.
              </div>
            )}
          </SettingsRow>
          <SettingsRow
            label="Google"
            hint={identities.google ? 'Linked' : 'Not linked'}
            actions={
              identities.google ? (
                <Button variant="danger" onClick={() => setUnlinkOpen(true)}>
                  Unlink
                </Button>
              ) : (
                <Button onClick={() => void handleLinkGoogle()} disabled={linkBusy}>
                  {linkBusy ? 'Opening Google…' : 'Link Google account'}
                </Button>
              )
            }
          />
        </SettingsSection>
      )}

      {identities && (
        <SettingsSection id="settings-notifications-title" title="Notifications">
          <SwitchRow
            label="Email notifications"
            hint={
              identities.emailVerified
                ? 'Friend requests, trade offers, and game-night invites.'
                : 'Needs a verified email.'
            }
            checked={identities.notifyEmail}
            onChange={() => void handleToggleNotifyEmail()}
            disabled={!identities.emailVerified || notifyEmailBusy}
          />
        </SettingsSection>
      )}

      <SettingsSection id="settings-device-title" title="This device">
        <SettingsRow
          label="Signed in as"
          value={username}
          actions={<Button onClick={openSignOut}>Sign out</Button>}
        />
        <SettingsRow label="Sync status" actions={<SyncIndicator />} />
      </SettingsSection>

      <Surface
        as="section"
        variant="framed"
        className="settings-card settings-card--danger"
        aria-labelledby="settings-delete-account-title"
      >
        <header className="settings-card-header">
          <h2 id="settings-delete-account-title" className="settings-card-title">
            Delete account
          </h2>
        </header>
        <div className="settings-card-body">
          <SettingsRow
            hint="Permanently deletes your account and everything on the server. This can't be undone."
            actions={
              <Button variant="danger" onClick={() => setDeleteStep(1)}>
                Delete account
              </Button>
            }
          />
        </div>
      </Surface>

      {unlinkOpen && (
        <ConfirmDialog
          title="Unlink Google?"
          body="Your account and data stay. You can link Google again any time."
          confirmLabel={unlinkBusy ? 'Unlinking…' : 'Unlink'}
          danger
          onConfirm={() => void handleUnlinkGoogle()}
          onCancel={() => setUnlinkOpen(false)}
        />
      )}

      {passwordModalOpen && identities && (
        <PasswordModal
          hasPassword={identities.password}
          onClose={() => setPasswordModalOpen(false)}
          onSaved={() => void refreshIdentities()}
        />
      )}

      {emailModalOpen && identities && (
        <EmailModal
          currentEmail={identities.emailVerified ? identities.email : null}
          onClose={() => setEmailModalOpen(false)}
          onSaved={() => void refreshIdentities()}
        />
      )}

      {signOutOpen && (
        <ConfirmDialog
          title="Sign out?"
          body={
            signOutPending > 0
              ? `You have ${signOutPending} unsynced ${
                  signOutPending === 1 ? 'change' : 'changes'
                } that haven't reached the server yet. Signing out removes all data from this device, and those changes will be lost.`
              : `Your data is synced to @${username} and will be restored when you sign back in. It will be removed from this device.`
          }
          confirmLabel={signOutBusy ? 'Signing out…' : 'Sign out'}
          danger={signOutPending > 0}
          onConfirm={() => void handleLogout()}
          onCancel={() => setSignOutOpen(false)}
        />
      )}

      {deleteStep !== 0 && (
        <DeleteAccountDialog
          username={username}
          step={deleteStep}
          busy={deleteBusy}
          onAdvance={deleteStep === 1 ? () => setDeleteStep(2) : () => void handleConfirmDelete()}
          onCancel={() => setDeleteStep(0)}
        />
      )}
    </>
  );
}

interface PasswordModalProps {
  /** Whether the account already has a password — gates the "current
   *  password" field and swaps the modal between Set/Change copy. */
  hasPassword: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Set (no existing password — an SSO-only account) or change (existing
 * password, `currentPassword` required and verified server-side) the
 * account's password. Reuses AuthPage's `.auth-field`/`.auth-rules` markup
 * and reveal-toggle pattern so a password field looks and behaves the same
 * everywhere in the app.
 */
function PasswordModal({ hasPassword, onClose, onSaved }: PasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError(null);
      setConfirmError('Passwords do not match.');
      return;
    }
    setConfirmError(null);
    setError(null);
    setSaving(true);
    try {
      await updatePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      toast.show({ message: hasPassword ? 'Password changed.' : 'Password set.', tone: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      setError(userMessage(err, "Couldn't update your password."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      dismissable={!saving}
      className="choice-dialog"
      labelledBy="password-modal-title"
    >
      <h2 id="password-modal-title" className="choice-dialog-title">
        {hasPassword ? 'Change password' : 'Set a password'}
      </h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="auth-form">
        {hasPassword && (
          <label className="auth-field">
            <span>Current password</span>
            <div className="auth-input-wrap">
              <input
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
              />
              <button
                type="button"
                className="auth-reveal"
                onMouseDown={preventFocusSteal}
                onClick={() => setShowCurrent((v) => !v)}
                aria-pressed={showCurrent}
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
              >
                {showCurrent ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
          </label>
        )}

        <label className="auth-field">
          <span>New password</span>
          <div className="auth-input-wrap">
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={10}
              autoFocus={!hasPassword}
            />
            <button
              type="button"
              className="auth-reveal"
              onMouseDown={preventFocusSteal}
              onClick={() => setShowNew((v) => !v)}
              aria-pressed={showNew}
              aria-label={showNew ? 'Hide password' : 'Show password'}
            >
              {showNew ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
          <ul className="auth-rules" aria-label="Password requirements" aria-live="polite">
            <li
              className={`auth-rule${newPassword.length >= 10 ? ' is-met' : ''}`}
              aria-label={`At least 10 characters: ${newPassword.length >= 10 ? 'met' : 'not yet met'}`}
            >
              <span className="auth-rule-mark" aria-hidden="true">
                {newPassword.length >= 10 ? '✓' : '•'}
              </span>
              At least 10 characters
            </li>
          </ul>
        </label>

        <label className="auth-field">
          <span>Confirm new password</span>
          <div className="auth-input-wrap">
            <input
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (confirmError) setConfirmError(null);
              }}
              required
              minLength={10}
              aria-invalid={confirmError ? true : undefined}
            />
            <button
              type="button"
              className="auth-reveal"
              onMouseDown={preventFocusSteal}
              onClick={() => setShowConfirm((v) => !v)}
              aria-pressed={showConfirm}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
          <ul className="auth-rules" aria-label="Confirm requirements" aria-live="polite">
            <li
              className={`auth-rule${confirm.length > 0 && confirm === newPassword ? ' is-met' : ''}${confirmError ? ' is-error' : ''}`}
              aria-label={`Passwords match: ${confirm.length > 0 && confirm === newPassword ? 'met' : 'not yet met'}`}
            >
              <span className="auth-rule-mark" aria-hidden="true">
                {confirm.length > 0 && confirm === newPassword ? '✓' : '•'}
              </span>
              Passwords match
            </li>
          </ul>
        </label>

        {error || confirmError ? (
          <div role="alert" className="auth-error">
            {error || confirmError}
          </div>
        ) : null}

        <div className="choice-dialog-actions">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface EmailModalProps {
  /** The account's current verified email, or null (unset / still pending). */
  currentEmail: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add or change the account's email. Doesn't take effect immediately — the
 * backend mails a verification link and the row shows "Pending
 * verification" until it's clicked (see VerifyEmailPage).
 */
function EmailModal({ currentEmail, onClose, onSaved }: EmailModalProps) {
  const [email, setEmail] = useState(currentEmail ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { pendingEmail } = await requestEmailChange(email.trim());
      toast.show({ message: `Verification email sent to ${pendingEmail}.`, tone: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      setError(userMessage(err, "Couldn't update your email."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      dismissable={!saving}
      className="choice-dialog"
      labelledBy="email-modal-title"
    >
      <h2 id="email-modal-title" className="choice-dialog-title">
        {currentEmail ? 'Change email' : 'Add an email'}
      </h2>
      <p className="choice-dialog-body">We'll send a link to confirm this address.</p>
      <form onSubmit={(e) => void handleSubmit(e)} className="auth-form">
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        {error ? (
          <div role="alert" className="auth-error">
            {error}
          </div>
        ) : null}

        <div className="choice-dialog-actions">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Sending…' : 'Send verification link'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface DeleteAccountDialogProps {
  username: string;
  step: 1 | 2;
  busy: boolean;
  onAdvance: () => void;
  onCancel: () => void;
}

/**
 * Two-step confirmation for permanent account deletion. Step 1 spells out the
 * scope (every server-side record); step 2 is the final irreversible gate.
 * Mirrors DeleteCollectionDialog so the destructive-action UX is consistent.
 */
function DeleteAccountDialog({
  username,
  step,
  busy,
  onAdvance,
  onCancel,
}: DeleteAccountDialogProps) {
  const isFinal = step === 2;
  return (
    <Modal
      onClose={onCancel}
      dismissable={!busy}
      className="choice-dialog"
      labelledBy="delete-account-title"
    >
      <h2 id="delete-account-title" className="choice-dialog-title">
        {isFinal ? 'Last chance: delete your account?' : 'Delete your account?'}
      </h2>
      <p className="choice-dialog-body">
        {isFinal ? (
          <>
            This permanently deletes <strong>{username}</strong> and erases every server-side
            record: collection, binders, decks, games, backups, share links. This can't be undone.
          </>
        ) : (
          <>
            This permanently deletes the account <strong>{username}</strong> and all of its data
            from the server. Download a backup first if you want to keep your collection.
          </>
        )}
      </p>
      <div className="choice-dialog-actions">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={isFinal ? 'danger' : 'secondary'}
          onClick={onAdvance}
          disabled={busy}
          autoFocus
        >
          {busy ? 'Deleting…' : isFinal ? 'Delete account' : 'Continue'}
        </Button>
      </div>
    </Modal>
  );
}
