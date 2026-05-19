import { useState, type FormEvent } from 'react';
import { useAuth } from '../store/auth';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);
  const loginAction = useAuth((s) => s.login);
  const registerAction = useAuth((s) => s.register);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'register' && password !== confirm) {
      setConfirmError('Passwords do not match.');
      return;
    }
    setConfirmError(null);
    setSubmitting(true);
    if (mode === 'login') {
      await loginAction(username.trim(), password);
    } else {
      await registerAction(username.trim(), password);
      setConfirm('');
    }
    setSubmitting(false);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setConfirm('');
    setConfirmError(null);
    clearError();
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">SpellControl</h1>
        <p className="auth-subtitle">
          {mode === 'login'
            ? 'Sign in to sync your collection across devices.'
            : 'Create an account to start syncing.'}
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
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 10 : 1}
            />
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
              <input
                type="password"
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
      </div>
    </div>
  );
}
