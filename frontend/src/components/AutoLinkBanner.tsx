import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

/**
 * One-time banner shown right after the OAuth callback auto-linked a new
 * external sign-in (currently Google) to this account by matching the
 * verified email. Confirms the link and gives the user an immediate
 * unlink path so a surprise attachment is reversible without hunting
 * through Settings.
 *
 * Lifecycle: rendered at the App root, returns null unless
 * `useAuth().autoLinkedAt` is set. Dismiss → POST acknowledge-auto-link.
 * Unlink → navigate to /settings where the existing identities card
 * handles the actual unlink + clears the same flag server-side.
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
        <strong>Google sign-in linked.</strong> We connected this Google account to your existing
        SpellControl account{username ? ` (@${username})` : ''}. If that wasn&apos;t you, unlink it
        below.
      </div>
      <div className="auto-link-banner-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void acknowledge();
            navigate('/settings');
          }}
        >
          Manage in Settings
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void acknowledge()}>
          Got it
        </button>
      </div>
    </div>
  );
}
