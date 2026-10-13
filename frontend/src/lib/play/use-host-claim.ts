import { useCallback, useEffect, useState } from 'react';
import { claimHost, getHostClaimable } from '@/lib/play/games-api';
import { userMessage } from '@/lib/util/user-error';

/** The server owns the 2-minute rule; this only asks it how the table looks now. */
const CHECK_EVERY_MS = 15_000;

/**
 * E451: whether this seated non-host may take the table over, and the claim
 * itself. `enabled` is false for the host and for spectators, so they never ask.
 */
export function useHostClaim(code: string, enabled: boolean) {
  const [claimable, setClaimable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const check = () => {
      getHostClaimable(code)
        .then((ok) => live && setClaimable(ok))
        .catch(() => live && setClaimable(false));
    };
    check();
    const id = setInterval(check, CHECK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [code, enabled]);

  const claim = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await claimHost(code);
      setClaimable(false);
    } catch (err) {
      setError(userMessage(err, "Couldn't take over the table."));
      setClaimable(false);
    } finally {
      setBusy(false);
    }
  }, [code]);

  return { claimable: enabled && claimable, busy, error, claim };
}
