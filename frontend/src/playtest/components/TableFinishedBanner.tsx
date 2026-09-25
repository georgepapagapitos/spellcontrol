import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { usePlayStore } from '@/store/play';
import './TableFinishedBanner.css';

/**
 * The persistent counterpart to TableMoments' win ceremony (E351). That
 * celebration is transient — it auto-dismisses, and deliberately never fires
 * on a mount into an already-finished game (see its own doc comment). Once
 * it's gone, or for a seat that reloads straight into a finished table,
 * nothing else on this board said the game was over: every non-host seat
 * stayed on a live-looking battlefield with no notice and no way off it.
 *
 * Not edge-triggered — renders for as long as the linked online game's
 * `status` is `'finished'`, so both "I watched it happen" and "I just got
 * here" show the same thing. States the result the way `/play`'s
 * `FinishedPanel` does (same winner/draw copy), so the host on `/play` and
 * every other seat on this board agree on one outcome. Non-modal by design
 * (no backdrop, no focus trap — mirrors `TakebackConsentPrompt`): a player
 * mid-drag or with a menu open keeps whatever they're doing; this floats
 * above it without displacing or interrupting anything.
 */
export function TableFinishedBanner() {
  const online = usePlayStore((s) => s.online);
  const leaveOnline = usePlayStore((s) => s.leaveOnline);
  const navigate = useNavigate();

  if (!online || online.status !== 'finished') return null;

  const winner =
    online.winnerSeat == null
      ? null
      : (online.players.find((p) => p.seat === online.winnerSeat) ?? null);

  const handleLeave = () => {
    void leaveOnline();
    navigate('/play');
  };

  return createPortal(
    <div className="playtest-finished-banner">
      <div className="playtest-finished-banner__panel" role="status">
        <span className="playtest-finished-banner__headline">
          {winner ? `${winner.name} wins the game` : 'Game over. No winner.'}
        </span>
        <button
          type="button"
          className="btn btn-primary playtest-finished-banner__leave"
          onClick={handleLeave}
        >
          Leave table
        </button>
      </div>
    </div>,
    document.body
  );
}
