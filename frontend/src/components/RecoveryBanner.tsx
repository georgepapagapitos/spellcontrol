import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { Button } from '@/components/shared/Button';

/**
 * Standing bar for an account that cannot be recovered: no confirmed email,
 * so a forgotten password has no way back in and everything behind the
 * account — collection, binders, decks, game history — goes with it.
 *
 * Deliberately NOT dismissible, and deliberately not a toast. Every account
 * that predates the sign-up email requirement is in this state, and a prompt
 * that can be waved away once leaves those accounts unrecoverable forever.
 * It blocks nothing: it stays out of the way at the top of the app until the
 * address is confirmed, at which point it disappears on the next `/me`.
 *
 * `emailVerified` defaults to true in the store, so this never shows while
 * signed out, offline, or against a backend that does not report the field —
 * a banner nobody can act on is worse than no banner.
 */
export function RecoveryBanner() {
  const status = useAuth((s) => s.status);
  const emailVerified = useAuth((s) => s.emailVerified);
  const navigate = useNavigate();

  if (status !== 'authed' || emailVerified) return null;

  return (
    <div className="recovery-banner" role="status" aria-live="polite">
      <div className="recovery-banner-text">
        <strong>Confirm your email.</strong> It's the only way back in if you forget your password.
      </div>
      <Button variant="primary" onClick={() => navigate('/you?section=sign-in')}>
        Confirm email
      </Button>
    </div>
  );
}
