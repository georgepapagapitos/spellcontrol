import { useCardThumb } from '@/lib/card-thumbs';
import { ProgressBar } from '../ProgressBar';
import './GenerationTakeover.css';

interface Props {
  commanderName?: string;
  commanderImageUrl?: string;
  message: string;
  percent: number;
}

/**
 * Full-page takeover shown while commander-deck generation is running.
 * Replaces the small inline progress strip so the build event feels
 * deliberate — commander art anchors the wait and keeps the user oriented.
 *
 * Reduced-motion safe: the fade-in and art overlay are CSS-only and
 * gated with prefers-reduced-motion. No new keyframes — reuses the
 * shared `fade-in` from styles/footer-card-preview.css.
 */
export function GenerationTakeover({ commanderName, commanderImageUrl, message, percent }: Props) {
  // Resolve from CDN if we only have a name; direct URL wins immediately.
  const resolvedThumb = useCardThumb(commanderImageUrl ? undefined : commanderName, 'normal');
  const artUrl = commanderImageUrl ?? resolvedThumb;

  return (
    <div className="gen-takeover" role="status" aria-live="polite" aria-label="Building deck…">
      {artUrl && (
        <div className="gen-takeover-art" aria-hidden>
          <img src={artUrl} alt="" className="gen-takeover-art-img" />
          <div className="gen-takeover-art-fade" aria-hidden />
        </div>
      )}
      <div className="gen-takeover-body">
        {commanderName && (
          <p className="gen-takeover-commander" aria-hidden>
            {commanderName}
          </p>
        )}
        <p className="gen-takeover-step">{message}</p>
        <ProgressBar percent={percent} className="gen-takeover-bar" />
      </div>
    </div>
  );
}
