import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { useAuth } from '../store/auth';
import { fetchProviders, googleSignInUrl } from '../lib/auth-api';
import { isNativePlatform } from '../lib/platform';
import { preventFocusSteal } from '../lib/keyboard';
import { markEverVisited } from '../lib/first-run';

type Mode = 'login' | 'register';

/** Google's multi-colour "G" mark, inline so the button needs no asset. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const error = useAuth((s) => s.error);
  const status = useAuth((s) => s.status);
  const clearError = useAuth((s) => s.clearError);
  const loginAction = useAuth((s) => s.login);
  const registerAction = useAuth((s) => s.register);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthFailed = searchParams.get('error') === 'google';

  // Discover whether this deployment offers Google sign-in.
  useEffect(() => {
    let alive = true;
    void fetchProviders().then((p) => {
      if (alive) setGoogleEnabled(p.google);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Once authed — by password here, or by the Google deep link landing while
  // this screen is open — leave the auth screen for the app.
  useEffect(() => {
    if (status === 'authed') navigate('/', { replace: true });
  }, [status, navigate]);

  // Native: the system browser closing (success, our own close, or a user
  // cancel) ends the "busy" state so the button is usable again.
  useEffect(() => {
    if (!isNativePlatform()) return;
    const handle = Browser.addListener('browserFinished', () => setGoogleBusy(false));
    return () => {
      void handle.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'register' && password !== confirm) {
      setConfirmError('Passwords do not match.');
      return;
    }
    setConfirmError(null);
    setSubmitting(true);
    const ok =
      mode === 'login'
        ? await loginAction(username.trim(), password)
        : await registerAction(username.trim(), password);
    setSubmitting(false);
    if (ok) navigate('/', { replace: true });
    else if (mode === 'register') setConfirm('');
  }

  function handleGoogle() {
    clearError();
    setGoogleBusy(true);
    if (isNativePlatform()) {
      // Completion returns via the spellcontrol://oauth/callback deep link.
      void Browser.open({ url: googleSignInUrl('native') }).catch(() => setGoogleBusy(false));
    } else {
      // Top-level navigation; the callback sets the cookie and redirects back.
      window.location.href = googleSignInUrl('web');
    }
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setConfirm('');
    setConfirmError(null);
    setShowPassword(false);
    setShowConfirm(false);
    clearError();
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">SpellControl</h1>
        <p className="auth-subtitle">
          {mode === 'login'
            ? 'Sign in to sync your collection across devices.'
            : 'Create an account to sync across devices.'}
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' is-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab${mode === 'register' ? ' is-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Create account
          </button>
        </div>

        {oauthFailed ? (
          <div role="alert" className="auth-error">
            Google sign-in didn't complete. Please try again.
          </div>
        ) : null}

        {googleEnabled ? (
          <>
            <button
              type="button"
              className="auth-google"
              onClick={handleGoogle}
              disabled={googleBusy}
            >
              <GoogleMark />
              {googleBusy ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <div className="auth-divider">or</div>
          </>
        ) : null}

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
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_\-]{3,32}"
              title="3–32 characters: letters, digits, underscore, hyphen"
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <div className="auth-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 10 : 1}
              />
              <button
                type="button"
                className="auth-reveal"
                onMouseDown={preventFocusSteal}
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
            {mode === 'register' ? (
              <ul className="auth-rules" aria-label="Password requirements">
                <li
                  className={`auth-rule${password.length >= 10 ? ' is-met' : ''}`}
                  aria-checked={password.length >= 10}
                  role="checkbox"
                >
                  <span className="auth-rule-mark" aria-hidden="true">
                    {password.length >= 10 ? '✓' : '•'}
                  </span>
                  At least 10 characters
                </li>
                <li className="auth-rule auth-rule-note">
                  <span className="auth-rule-mark" aria-hidden="true">
                    !
                  </span>
                  No password reset — pick something you'll remember
                </li>
              </ul>
            ) : null}
          </label>

          {mode === 'register' ? (
            <label className="auth-field">
              <span>Confirm password</span>
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
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
              </div>
              <ul className="auth-rules" aria-label="Confirm requirements">
                <li
                  className={`auth-rule${confirm.length > 0 && confirm === password ? ' is-met' : ''}${confirmError ? ' is-error' : ''}`}
                  aria-checked={confirm.length > 0 && confirm === password}
                  role="checkbox"
                >
                  <span className="auth-rule-mark" aria-hidden="true">
                    {confirm.length > 0 && confirm === password ? '✓' : '•'}
                  </span>
                  Passwords match
                </li>
              </ul>
            </label>
          ) : null}

          {error ? (
            <div role="alert" className="auth-error">
              {error}
            </div>
          ) : null}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          className="auth-back"
          onClick={() => {
            // Choosing guest mode counts as an intentional first-run choice,
            // so we don't gate the user back here on every cold boot.
            markEverVisited();
            navigate('/');
          }}
        >
          Continue without an account
        </button>
      </div>
    </div>
  );
}
