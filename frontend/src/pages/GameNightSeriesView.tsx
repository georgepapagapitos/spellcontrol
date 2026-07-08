import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GameNightNotFoundError, resolveGameNightSeries } from '../lib/game-nights-api';
import { SharedShell } from '../components/shared/SharedShell';
import { BrandMark } from '../components/shared/BrandMark';

/**
 * Landing for the stable weekly-series link /gn/s/:token (E125) — the URL a
 * group pins in its chat. It resolves to whichever occurrence is current
 * (materializing the next one server-side when due) and forwards to that
 * night's regular /gn/:token page, so RSVPs and guest credentials stay
 * per-occurrence. Mirrors GameNightView's shell and state contract.
 */
export function GameNightSeriesView() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'notFound' } | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    resolveGameNightSeries(token)
      .then((nightToken) => {
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
  }, [token, navigate]);

  if (!token || state.status === 'notFound') {
    return (
      <SharedShell ctaLabel="Plan your own game nights">
        <main className="shared-view shared-view--missing">
          <h1>Link not found</h1>
          <p>This game night link is invalid or no longer exists.</p>
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
