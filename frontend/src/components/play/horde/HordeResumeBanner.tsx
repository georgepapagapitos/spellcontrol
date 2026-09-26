import { useHordeGameStore } from '@/store/horde-game';
import { Button } from '@/components/shared/Button';

/** The Horde table's own resume banner — same shape as the real local game's
 *  `ResumeBanner`, reusing its `.play-resume-banner` classes (loaded by
 *  PlayPage already). Shown instead of it whenever a horde game exists and
 *  was minimized (`onMinimize`, GameBoard's convention). */
export function HordeResumeBanner() {
  const config = useHordeGameStore((s) => s.config);
  const survivorsLife = useHordeGameStore((s) => s.survivorsLife);
  const outcome = useHordeGameStore((s) => s.outcome);
  const showBoard = useHordeGameStore((s) => s.showBoard);
  const leaveGame = useHordeGameStore((s) => s.leaveGame);
  if (!config) return null;

  const status = outcome === 'won' ? 'won' : outcome === 'lost' ? 'lost' : `${survivorsLife} life`;
  return (
    <section className="play-resume-banner" aria-label="Active horde game">
      <div className="play-resume-banner-body">
        <span className="play-resume-banner-label">
          {config.hordeName}
          <span className="play-resume-banner-status"> · {status}</span>
        </span>
        <span className="play-resume-banner-players">
          {config.survivors.map((p) => p.name).join(' · ')}
        </span>
      </div>
      <div className="play-resume-banner-actions">
        <Button variant="primary" onClick={showBoard}>
          Resume
        </Button>
        <Button onClick={leaveGame}>Discard</Button>
      </div>
    </section>
  );
}
