import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { BrandMark } from '../components/shared/BrandMark';

// Mirrors the backend USERNAME_REGEX.
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

/**
 * First-run screen for a brand-new Google account: the user picks their
 * username before the account is created. Reached only via the OAuth callback,
 * which puts a short-lived signup token (and a suggested username) in the URL
 * hash — on web by a redirect, on native by the deep-link handler.
 *
 * If the chosen username is already taken, the screen also offers a
 * password-confirmed link: prove ownership of the existing account and the
 * Google identity gets attached to it instead of creating a duplicate.
 */
export default function ChooseUsernamePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(
    () => new URLSearchParams(location.hash.replace(/^#/, '')),
    [location.hash]
  );
  const token = params.get('token') ?? '';
  const suggested = params.get('suggested') ?? '';

  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);
  const completeGoogleSignup = useAuth((s) => s.completeGoogleSignup);
  const linkGoogleWithPassword = useAuth((s) => s.linkGoogleWithPassword);

  const [username, setUsername] = useState(suggested);
  const [submitting, setSubmitting] = useState(false);
  // The exact username that triggered a "taken" 409, plus the link panel's
  // own state. Clearing `takenName` hides the panel; we clear it whenever the
  // user edits the username away from it, so picking a new name returns to
  // the plain create flow.
  const [takenName, setTakenName] = useState<string | null>(null);
  const [linkPassword, setLinkPassword] = useState('');
  const [linking, setLinking] = useState(false);

  // No token → a stale or hand-typed URL; there's nothing to finish here.
  useEffect(() => {
    if (!token) navigate('/auth', { replace: true });
  }, [token, navigate]);

  // Account created or linked (here, or already authed) → into the app.
  useEffect(() => {
    if (status === 'authed') navigate('/', { replace: true });
  }, [status, navigate]);

  const normalized = username.trim().toLowerCase();
  const valid = USERNAME_RE.test(normalized);
  const showLinkPanel = takenName !== null && takenName === normalized;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    const result = await completeGoogleSignup(token, normalized);
    setSubmitting(false);
    if (!result.ok && result.status === 409) {
      setTakenName(normalized);
      setLinkPassword('');
    }
    // On success the status effect navigates; on other failures `error` shows.
  }

  async function handleLink(e: FormEvent) {
    e.preventDefault();
    if (!takenName || !linkPassword || linking) return;
    setLinking(true);
    await linkGoogleWithPassword(token, takenName, linkPassword);
    setLinking(false);
    // Success → status effect navigates; failure → error displays.
  }

  if (!token) return null;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand-hero" aria-hidden="true">
          <BrandMark size={48} motion="idle" />
        </div>
        <h1 className="auth-title">Pick a username</h1>
        <p className="auth-subtitle">
          This is how you&apos;ll appear in SpellControl. It can be anything — it doesn&apos;t have
          to match your email.
        </p>

        <form onSubmit={handleCreate} className="auth-form">
          <label className="auth-field">
            <span>Username</span>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) clearError();
                // Editing away from the taken name returns to plain create-mode.
                if (takenName && e.target.value.trim().toLowerCase() !== takenName) {
                  setTakenName(null);
                }
              }}
              required
              minLength={3}
              maxLength={32}
              autoFocus
            />
            <ul className="auth-rules" aria-label="Username requirements" aria-live="polite">
              <li
                className={`auth-rule${valid ? ' is-met' : ''}`}
                aria-label={`3–32 characters: lowercase letters, digits, _ or - — ${valid ? 'met' : 'not yet met'}`}
              >
                <span className="auth-rule-mark" aria-hidden="true">
                  {valid ? '✓' : '•'}
                </span>
                3–32 characters: lowercase letters, digits, _ or -
              </li>
            </ul>
          </label>

          {error ? (
            <div role="alert" className="auth-error">
              {error}
            </div>
          ) : null}

          <button type="submit" className="auth-submit" disabled={submitting || !valid}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        {showLinkPanel ? (
          <>
            <div className="auth-divider">or</div>
            <form onSubmit={handleLink} className="auth-form">
              <p className="auth-subtitle">
                Already have a <strong>{takenName}</strong> account? Enter its password to link
                Google to it instead of creating a new account.
              </p>
              <label className="auth-field">
                <span>Password for {takenName}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={linkPassword}
                  onChange={(e) => {
                    setLinkPassword(e.target.value);
                    if (error) clearError();
                  }}
                  required
                />
              </label>
              <button
                type="submit"
                className="auth-submit"
                disabled={linking || linkPassword.length === 0}
              >
                {linking ? 'Linking…' : `Link Google to ${takenName}`}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
