import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

// Mirrors the backend USERNAME_REGEX.
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

/**
 * First-run screen for a brand-new Google account: the user picks their
 * username before the account is created. Reached only via the OAuth callback,
 * which puts a short-lived signup token (and a suggested username) in the URL
 * hash — on web by a redirect, on native by the deep-link handler.
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

  const [username, setUsername] = useState(suggested);
  const [submitting, setSubmitting] = useState(false);

  // No token → a stale or hand-typed URL; there's nothing to finish here.
  useEffect(() => {
    if (!token) navigate('/auth', { replace: true });
  }, [token, navigate]);

  // Account created (here, or already authed) → into the app.
  useEffect(() => {
    if (status === 'authed') navigate('/', { replace: true });
  }, [status, navigate]);

  const normalized = username.trim().toLowerCase();
  const valid = USERNAME_RE.test(normalized);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    // On success the status effect navigates away; on failure `error` shows.
    await completeGoogleSignup(token, normalized);
    setSubmitting(false);
  }

  if (!token) return null;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Pick a username</h1>
        <p className="auth-subtitle">
          This is how you&apos;ll appear in SpellControl. It can be anything — it doesn&apos;t have
          to match your email.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
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
              }}
              required
              minLength={3}
              maxLength={32}
              autoFocus
            />
            <ul className="auth-rules" aria-label="Username requirements">
              <li
                className={`auth-rule${valid ? ' is-met' : ''}`}
                role="checkbox"
                aria-checked={valid}
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
      </div>
    </div>
  );
}
