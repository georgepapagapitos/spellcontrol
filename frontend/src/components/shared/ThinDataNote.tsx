import './ThinDataNote.css';
import type { JSX } from 'react';
import { LIFT_STRICT_FLOOR } from '@/deck-builder/services/edhrec/client';

/**
 * Below this many decks, an EDHREC-derived number is a hunch rather than a
 * statistic. Reuses the lift pipeline's strict floor so the app has exactly one
 * definition of "thin sample" — the same 50 that already flags a lift entry
 * `lowSample` decides what the UI discloses.
 */
export const THIN_SAMPLE_FLOOR = LIFT_STRICT_FLOOR;

/**
 * `0`/null/undefined mean "no data at all", which the surfaces already handle
 * (they render nothing rather than a zero) — only a real-but-small sample is
 * thin.
 */
export function isThinSample(sampleSize: number | null | undefined): boolean {
  return typeof sampleSize === 'number' && sampleSize > 0 && sampleSize < THIN_SAMPLE_FLOOR;
}

export interface ThinDataNoteProps {
  /** The actual number of decks behind the stat. */
  sampleSize: number | null | undefined;
  /** What was counted, e.g. "decks on EDHREC", "decks pairing these cards". */
  noun?: string;
  className?: string;
}

/**
 * The app's one way of saying "this number is thin" — the exact sample size
 * plus a plain statement that it isn't yet a statistic. Renders nothing unless
 * the sample really is below {@link THIN_SAMPLE_FLOOR}, so it costs nothing on
 * the common path and never displaces content.
 *
 * Honesty about limits is a house rule (STYLE_GUIDE § Voice): the alternative
 * is a percentage computed from twelve decks looking exactly like one computed
 * from forty thousand.
 */
export function ThinDataNote({
  sampleSize,
  noun = 'decks on EDHREC',
  className,
}: ThinDataNoteProps): JSX.Element | null {
  if (!isThinSample(sampleSize)) return null;
  return (
    <p className={`thin-data-note${className ? ` ${className}` : ''}`}>
      Based on only {sampleSize!.toLocaleString()} {noun} — treat this as a hunch, not a stat.
    </p>
  );
}
