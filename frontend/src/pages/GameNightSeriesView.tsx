import { useParams } from 'react-router-dom';
import { resolveGameNightSeries } from '../lib/game-nights-api';
import { GameNightLinkForward } from './GameNightLinkForward';

/**
 * Landing for the stable weekly-series link /gn/s/:token (E125) — the URL a
 * group pins in its chat. It resolves to whichever occurrence is current
 * (materializing the next one server-side when due) and forwards to that
 * night's regular /gn/:token page, so RSVPs and guest credentials stay
 * per-occurrence.
 */
export function GameNightSeriesView() {
  const { token } = useParams<{ token: string }>();
  return (
    <GameNightLinkForward
      token={token}
      resolve={resolveGameNightSeries}
      notFoundMessage="This game night link is invalid or no longer exists."
    />
  );
}
