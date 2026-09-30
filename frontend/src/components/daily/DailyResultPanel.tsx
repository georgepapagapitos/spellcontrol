import { useEffect, useState } from 'react';
import { Check, Copy, Share2, X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { canShare, openShareSheet } from '@/lib/util/web-share';
import { useCopyFeedback } from '@/lib/util/use-copy-feedback';
import { msUntilNextPuzzle, type DailyPuzzle } from '@/lib/daily/schedule';

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Ticks once a second; announces nothing (a live countdown would be noise). */
function Countdown() {
  const [ms, setMs] = useState(() => msUntilNextPuzzle());
  useEffect(() => {
    const id = window.setInterval(() => setMs(msUntilNextPuzzle()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="daily-countdown">{formatCountdown(ms)}</span>;
}

interface Props {
  puzzle: DailyPuzzle;
  solved: boolean;
  guesses: number;
  /** Null when this device has no grid for the day (played on another device). */
  shareText: string | null;
  streak: number;
}

/**
 * The day's end: said in words first (the seal burst beside it is decoration),
 * then the card, then Share and the countdown. There's no retry: today's card is
 * the same for everyone.
 */
export function DailyResultPanel({ puzzle, solved, guesses, shareText, streak }: Props) {
  const { copied, announcement, copy } = useCopyFeedback({ what: 'your result' });
  const nativeShare = canShare();
  const image = useCardThumb(puzzle.name, 'normal');
  return (
    <Surface
      variant="framed"
      as="section"
      className="daily-result"
      aria-labelledby="daily-result-title"
    >
      <div className="daily-result-verdict" data-solved={solved}>
        {solved ? (
          <Check width={20} height={20} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <X width={20} height={20} strokeWidth={1.8} aria-hidden="true" />
        )}
        <h2 id="daily-result-title" className="daily-result-title">
          {solved ? `Solved in ${guesses}` : `Out of guesses`}
        </h2>
        <span className="daily-result-streak">
          {solved ? `Streak ${streak}` : streak > 0 ? `Streak ${streak}` : 'Streak reset'}
        </span>
      </div>
      <div className="daily-result-body">
        {image ? (
          <img
            className="daily-result-card"
            src={image}
            alt={puzzle.name}
            width={244}
            height={340}
          />
        ) : (
          <div className="daily-result-card is-loading" aria-hidden="true" />
        )}
        <div className="daily-result-detail">
          <p className="daily-result-name">{puzzle.name}</p>
          <p className="daily-result-meta">
            {puzzle.typeLine} · {puzzle.setName}, {puzzle.year}
          </p>
          <div className="daily-result-actions">
            {shareText && nativeShare && (
              <Button
                variant="primary"
                icon={<Share2 width={16} height={16} strokeWidth={2} />}
                onClick={() => void openShareSheet({ text: shareText })}
              >
                Share
              </Button>
            )}
            {shareText && (
              <Button
                variant={nativeShare ? 'secondary' : 'primary'}
                icon={<Copy width={16} height={16} strokeWidth={2} />}
                onClick={() => copy(shareText)}
              >
                {copied ? 'Copied' : 'Copy result'}
              </Button>
            )}
            <Button to={`/search?q=${encodeURIComponent(`!"${puzzle.name}"`)}`}>Open card</Button>
          </div>
          <span className="sr-only" aria-live="polite">
            {announcement}
          </span>
          <p className="daily-result-next">
            Next card in <Countdown />
          </p>
        </div>
      </div>
    </Surface>
  );
}
