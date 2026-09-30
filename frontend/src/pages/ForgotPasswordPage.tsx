import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '@/lib/account/auth-api';
import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';

/**
 * Request a password-reset email. Always shows the same confirmation
 * copy on submit, whether or not the address is on a (verified) account —
 * the backend's `/forgot-password` is deliberately always-200 (T117
 * enumeration protection), so the UI must never distinguish the two.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      // A genuine network/server failure — distinct from "no such account",
      // which never reaches here (the backend always 200s for that case).
      setError(userMessage(err, "Couldn't send that. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <Surface as="div" variant="framed" className="auth-card">
        <h1 className="auth-title">Reset your password</h1>

        {sent ? (
          <>
            <p className="auth-subtitle" role="status">
              If an account uses that email, we've sent a link to reset the password. Check your
              spam folder too.
            </p>
            <Button variant="primary" to="/auth" className="auth-submit">
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <p className="auth-subtitle">Enter your account email and we'll send a reset link.</p>
            <form onSubmit={handleSubmit} className="auth-form">
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

              <Button type="submit" variant="primary" className="auth-submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
            <Link to="/auth" className="auth-back">
              Back to sign in
            </Link>
          </>
        )}
      </Surface>
    </main>
  );
}
