import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { Button } from '@/components/shared/Button';

/**
 * One-time banner shown right after the OAuth callback auto-linked a new
 * external sign-in (currently Google) to this account by matching the
 * verified email. Confirms the link and gives the user an immediate
 * unlink path so a surprise attachment is reversible without hunting
 * through Settings.
 *
 * Lifecycle: rendered at the App root, returns null unless
 * `useAuth().autoLinkedAt` is set. Dismiss → POST acknowledge-auto-link.
 * Unlink → navigate to the Sign-in methods card on /you, which handles the
 * actual unlink + clears the same flag server-side.
 */
export function AutoLinkBanner() {
  const autoLinkedAt = useAuth((s) => s.autoLinkedAt);
  const username = useAuth((s) => s.user?.username);
  const acknowledge = useAuth((s) => s.acknowledgeAutoLink);
  const navigate = useNavigate();

  if (!autoLinkedAt) return null;

  return (
    <div className="auto-link-banner" role="status" aria-live="polite">
      <div className="auto-link-banner-text">
        <strong>Google sign-in linked.</strong> Your Google account now signs in to
        {username ? ` @${username}` : ' your account'}. If that wasn&apos;t you, unlink it below.
      </div>
      <div className="auto-link-banner-actions">
        <Button
          onClick={() => {
            void acknowledge();
            navigate('/you?section=sign-in');
          }}
        >
          Manage sign-in methods
        </Button>
        <Button variant="primary" onClick={() => void acknowledge()}>
          Got it
        </Button>
      </div>
    </div>
  );
}
