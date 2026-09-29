import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { verifyEmail, resendEmailVerification } from '../lib/auth-api';
import { userMessage } from '@/lib/user-error';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';

type Phase = 'verifying' | 'verified' | 'error' | 'missing';

/**
 * Lands from the "Verify your SpellControl email" link. Public route — the
 * link may open in a different browser/device than the one that's signed
 * in, so verification itself needs no auth. Signed-in-here state only
 * changes the resend affordance on failure.
 */
export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams]);
  const username = useAuth((s) => s.user?.username ?? null);

  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'missing');
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    verifyEmail(token)
      .then(() => {
        if (!cancelled) setPhase('verified');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(userMessage(err, 'That verification link has expired or was already used.'));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleResend() {
    setResending(true);
    try {
      await resendEmailVerification();
      setResent(true);
    } catch {
      // Best-effort — the button stays available to retry.
    } finally {
      setResending(false);
    }
  }

  let heading: string;
  let body: React.ReactNode;
  if (phase === 'verifying') {
    heading = 'Verifying your email…';
    body = (
      <p className="auth-subtitle">
        <span className="spinner" aria-hidden="true" />
        One moment.
      </p>
    );
  } else if (phase === 'verified') {
    heading = 'Email verified';
    body = (
      <p className="auth-subtitle" role="status">
        Your email is confirmed. You can use it to reset your password.
      </p>
    );
  } else if (phase === 'missing') {
    heading = "There's nothing to verify here";
    body = (
      <p className="auth-subtitle">This link is missing its token. Check the link and try again.</p>
    );
  } else {
    heading = "That link didn't work";
    body = (
      <>
        <div role="alert" className="auth-error">
          {error}
        </div>
        {username ? (
          <p className="auth-subtitle">
            {resent
              ? "We've sent a new link. Check your spam folder too."
              : 'Request a new link below.'}
          </p>
        ) : (
          <p className="auth-subtitle">Sign in, then request a new verification email from You.</p>
        )}
      </>
    );
  }

  return (
    <main className="auth-page">
      <Surface as="div" variant="framed" className="auth-card">
        <h1 className="auth-title">{heading}</h1>
        {body}

        {phase === 'error' && username && !resent ? (
          <Button
            variant="primary"
            className="auth-submit"
            onClick={() => void handleResend()}
            disabled={resending}
          >
            {resending ? 'Sending…' : 'Send a new link'}
          </Button>
        ) : null}

        {phase !== 'verifying' ? (
          <Link to={username ? '/you' : '/auth'} className="auth-back">
            {username ? 'Back to Settings' : 'Back to sign in'}
          </Link>
        ) : null}
      </Surface>
    </main>
  );
}
