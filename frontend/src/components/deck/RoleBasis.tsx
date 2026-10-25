import type { JSX } from 'react';
import { ChevronDown } from 'lucide-react';
import { isThinSample } from '@/components/shared/ThinDataNote';
import { ROLE_TITLES } from '@/lib/deck-analysis/role-badges';
import {
  BASELINE_SAMPLE,
  bracketReference,
  roleBasisRows,
} from '@/deck-builder/services/deckBuilder/roleBasis';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

export interface RoleBasisProps {
  /** The targets the bars are drawn against, by role. */
  targets: Readonly<Partial<Record<RoleKey, number>>>;
  /** Cards at least 1 in 4 of this commander's EDHREC decks play, by role; null without an EDHREC page. */
  commanderCounts?: Readonly<Record<string, number>> | null;
  /** EDHREC's deck count for this commander: the sample behind `commanderCounts`. */
  commanderDecks?: number | null;
  /** The deck's bracket, for the lands and mana value reference; absent until one is known. */
  bracket?: { value: 1 | 2 | 3 | 4 | 5; stated: boolean } | null;
}

/**
 * Where the Roles panel's targets come from (roadmap 3.3): each target beside
 * the three references it can be checked against, each labeled measured or
 * estimate. A disclosure under the bars, not a tooltip: a table is too tall for
 * a bubble to stay clear of the phone tab bar. Display only: the targets
 * themselves are sized elsewhere.
 */
export function RoleBasis({
  targets,
  commanderCounts,
  commanderDecks,
  bracket,
}: RoleBasisProps): JSX.Element {
  const rows = roleBasisRows(
    { ramp: undefined, removal: undefined, boardwipe: undefined, cardDraw: undefined, ...targets },
    commanderCounts as Record<RoleKey, number> | null | undefined
  );
  const hasCommander = rows.some((r) => r.commander !== null);
  const bracketRef = bracket ? bracketReference(bracket.value) : null;
  const deckCount = commanderDecks ? `${commanderDecks.toLocaleString()} ` : '';
  return (
    <details className="deck-role-basis">
      <summary className="deck-role-basis-summary">
        <span>Where the targets come from</span>
        <ChevronDown width={14} height={14} strokeWidth={1.8} aria-hidden />
      </summary>
      <table
        className="deck-role-basis-table"
        aria-label="Each role target beside three references"
      >
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Target</th>
            {hasCommander && <th scope="col">Cmdr</th>}
            <th scope="col">Avg</th>
            <th scope="col">Expert</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.role}>
              <th scope="row">{ROLE_TITLES[r.role]}</th>
              <td>{typeof r.target === 'number' ? r.target : ''}</td>
              {hasCommander && <td>{r.commander ?? ''}</td>}
              <td>
                {r.baseline.median}
                <span className="deck-role-basis-range">
                  {r.baseline.q1} to {r.baseline.q3}
                </span>
              </td>
              <td>{r.expert}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="deck-role-basis-legend">
        {hasCommander && (
          <li>
            <b>Cmdr</b> (estimate): cards in the role that 1 in 4 of its {deckCount}EDHREC decks
            play.
            {isThinSample(commanderDecks) ? ' A small sample, so a hunch.' : ''}
          </li>
        )}
        <li>
          <b>Avg</b> (measured): median and middle half across {BASELINE_SAMPLE} EDHREC average
          decks.
        </li>
        <li>
          <b>Expert</b> (estimate): the Command Zone&apos;s 2025 template, from a secondary summary.
          Its removal and wipe counts include more than our tags do.
        </li>
      </ul>
      {bracketRef && bracket && (
        <p className="deck-role-basis-bracket">
          Bracket {bracket.value} ({bracket.stated ? 'stated' : 'estimated'}), measured on EDHREC
          bracket pages: {bracketRef.lands} lands, average mana value {bracketRef.averageMv},{' '}
          {bracketRef.tutors} tutors.
        </p>
      )}
    </details>
  );
}
