import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  GameNightNotFoundError,
  resolveGuestInvite,
  saveGuestInviteToken,
} from '../lib/game-nights-api';
import { SharedShell } from '../components/shared/SharedShell';
import { BrandMark } from '../components/shared/BrandMark';

/**
 * Shared landing for the two link types that resolve to a night rather than
 * being one: the stable weekly-series link (/gn/s/:token, E125) and a named
 * guest invite (/gn/i/:token, E208). Both resolve server-side, then forward to
 * the ordinary /gn/:token page so RSVPs and guest credentials stay
 * per-occurrence. Mirrors GameNightView's shell and state contract.
 */
export function GameNightLinkForward({
  token,
  resolve,
  notFoundMessage,
}: {
  token: string | undefined;
  /** Resolves the link to the night token to forward to. */
  resolve: (token: string) => Promise<string>;
  notFoundMessage: string;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'notFound' } | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    resolve(token)
      .then((nightToken) => {
        // `replace` so the credential-bearing URL leaves no history entry.
        if (!cancelled) navigate(`/gn/${nightToken}`, { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof GameNightNotFoundError) {
          setState({ status: 'notFound' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : "Couldn't load the game night.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // `resolve` is a stable module-level closure at both call sites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate]);

  if (!token || state.status === 'notFound') {
    return (
      <SharedShell ctaLabel="Plan your own game nights">
        <main className="shared-view shared-view--missing">
          <h1>Link not found</h1>
          <p>{notFoundMessage}</p>
          <Link to="/" className="btn btn-primary shared-copy-btn">
            Go to SpellControl
          </Link>
        </main>
      </SharedShell>
    );
  }
  if (state.status === 'error') {
    return (
      <SharedShell ctaLabel="Plan your own game nights">
        <main className="shared-view shared-view--error">
          <h1>Something went wrong</h1>
          <p>{state.message}</p>
          <Link to="/" className="btn btn-primary shared-copy-btn">
            Go to SpellControl
          </Link>
        </main>
      </SharedShell>
    );
  }
  return (
    <SharedShell ctaLabel="Plan your own game nights">
      <main className="shared-view shared-view--loading" aria-busy="true">
        <BrandMark size={64} motion="busy" aria-hidden />
        <p>Loading…</p>
      </main>
    </SharedShell>
  );
}

/**
 * Landing for a named guest invite link /gn/i/:token (E208) — the personal
 * link a host sends someone who doesn't have SpellControl.
 *
 * It stores the token as that person's reply credential for the night, then
 * forwards. After the redirect the credential is no longer in the address bar
 * and (thanks to `replace`) never in history — the same posture the guest
 * `rsvpId` already has, and why the token is never sent as a query param.
 */
export function GameNightInviteView() {
  const { token } = useParams<{ token: string }>();
  return (
    <GameNightLinkForward
      token={token}
      resolve={async (inviteToken) => {
        const { nightToken } = await resolveGuestInvite(inviteToken);
        saveGuestInviteToken(nightToken, inviteToken);
        return nightToken;
      }}
      notFoundMessage="This invite link is no longer valid — ask the host for a new one."
    />
  );
}
