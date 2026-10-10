import { Fragment } from 'react';
import type { CastabilityRow } from '@/lib/deck-analysis/castability';
import { SYMBOL_WORD } from '@/lib/deck-analysis/castability';

/**
 * "▾ Short on red in 14%": the card would miss its colors in this deck. Null
 * for a card with no clear shortfall, so a row with nothing to say stays quiet.
 * The glyph plus the words carry the problem; the warn tone only backs them.
 */
export function castSegment(
  name: string,
  row: CastabilityRow | undefined
): React.ReactElement | null {
  if (!row?.short) return null;
  const color = SYMBOL_WORD[row.short.symbol];
  const share = Math.round(row.short.share * 100);
  return (
    <span
      key="cast"
      className="card-search-problem"
      title={`In ${share}% of games where the mana for ${name} is there on time, ${color} is missing.`}
    >
      <span aria-hidden="true">▾ </span>
      Short on {color} in {share}%
    </span>
  );
}

/** A row's problem segments, each after a " · " like the rest of its trailing line. */
export function ProblemSegments({ segments }: { segments: React.ReactElement[] }) {
  return segments.map((segment) => (
    <Fragment key={segment.key}>
      {' · '}
      {segment}
    </Fragment>
  ));
}
