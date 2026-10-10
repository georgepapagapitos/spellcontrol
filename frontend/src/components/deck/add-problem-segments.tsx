import { Fragment } from 'react';
import type { CastabilityRow } from '@/lib/deck-analysis/castability';
import { SYMBOL_WORD } from '@/lib/deck-analysis/castability';
import type { AddProblems } from './use-add-castability';

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

/**
 * "▾ Cascades into a mana creature 42%": the chance card would often roll a
 * result this deck doesn't want. Exact odds, so no interval.
 */
function chanceSegment(name: string, problems: AddProblems): React.ReactElement | null {
  const problem = problems.chance.get(name);
  if (!problem) return null;
  return (
    <span
      key="chance"
      className="card-search-problem"
      title="Exact odds for the cards in this deck."
    >
      <span aria-hidden="true">▾ </span>
      {problem.text}
    </span>
  );
}

/** What is wrong with a suggested card in this deck, one segment per kind, only the ones that apply. */
export function problemSegmentsFor(name: string, problems: AddProblems): React.ReactElement[] {
  return [castSegment(name, problems.cast.get(name)), chanceSegment(name, problems)].filter(
    (segment) => segment !== null
  );
}

/** A row's problem segments, each after a " · " like the rest of its trailing line. */
export function ProblemSegments({ segments }: { segments: React.ReactElement[] }) {
  return segments.map((segment) => (
    <Fragment key={segment.key}>
      <span className="card-search-sep">{' · '}</span>
      {segment}
    </Fragment>
  ));
}
