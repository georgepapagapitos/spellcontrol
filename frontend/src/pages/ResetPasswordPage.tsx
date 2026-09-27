import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../store/auth';
import { preventFocusSteal } from '../lib/keyboard';
import { toast } from '../store/toasts';
import { BrandMark } from '../components/shared/BrandMark';
import { Button } from '@/components/shared/Button';

/** Mirrors AuthPage's register-mode password rules. */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams]);
  const navigate = useNavigate();

  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);
  const resetPasswordWithToken = useAuth((s) => s.resetPasswordWithToken);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authed') {
      toast.show({ message: 'Password reset. You are signed in.', tone: 'success' });
      navigate('/', { replace: true });
    }
  }, [status, navigate]);

  // Drop any stale error the shared store carried over from elsewhere (e.g.
  // a failed AuthPage attempt) so this fresh page doesn't open already red.
  // Mount-only — clearError is a stable Zustand action reference.
  useEffect(() => {
    clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      clearError();
      setConfirmError('Passwords do not match.');
      return;
    }
    setConfirmError(null);
    setSubmitting(true);
    await resetPasswordWithToken(token, password);
    setSubmitting(false);
    // Success navigates via the status effect above; failure shows `error`.
  }

  if (!token) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand-hero" aria-hidden="true">
            <BrandMark size={48} motion="idle" />
          </div>
          <h1 className="auth-title">That link isn't valid</h1>
          <p className="auth-subtitle">
            This reset link is missing its token. Request a new one to continue.
          </p>
          <Button variant="primary" to="/forgot-password" className="auth-submit">
            Request a new link
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand-hero" aria-hidden="true">
          <BrandMark size={48} motion="idle" />
        </div>
        <h1 className="auth-title">Choose a new password</h1>
        <p className="auth-subtitle">Pick a new password for your account.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>New password</span>
            <div className="auth-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                autoFocus
              />
              <button
                type="button"
                className="auth-reveal"
                onMouseDown={preventFocusSteal}
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
            <ul className="auth-rules" aria-label="Password requirements" aria-live="polite">
              <li
                className={`auth-rule${password.length >= 10 ? ' is-met' : ''}`}
                aria-label={`At least 10 characters: ${password.length >= 10 ? 'met' : 'not yet met'}`}
              >
                <span className="auth-rule-mark" aria-hidden="true">
                  {password.length >= 10 ? '✓' : '•'}
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
                className={`auth-rule${confirm.length > 0 && confirm === password ? ' is-met' : ''}${confirmError ? ' is-error' : ''}`}
                aria-label={`Passwords match: ${confirm.length > 0 && confirm === password ? 'met' : 'not yet met'}`}
              >
                <span className="auth-rule-mark" aria-hidden="true">
                  {confirm.length > 0 && confirm === password ? '✓' : '•'}
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

          <Button type="submit" variant="primary" className="auth-submit" disabled={submitting}>
            {submitting ? 'Resetting…' : 'Reset password'}
          </Button>
        </form>

        {error ? (
          <Link to="/forgot-password" className="auth-back">
            Request a new link
          </Link>
        ) : (
          <Link to="/auth" className="auth-back">
            Back to sign in
          </Link>
        )}
      </div>
    </main>
  );
}
