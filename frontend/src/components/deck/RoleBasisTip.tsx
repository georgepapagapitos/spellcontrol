import type { JSX } from 'react';
import { InfoTip } from '@/components/overlays/InfoTip';
import { isThinSample } from '@/components/shared/ThinDataNote';
import { ROLE_TITLES } from '@/lib/deck-analysis/role-badges';
import {
  BASELINE_SAMPLE,
  bracketReference,
  roleBasisRows,
} from '@/deck-builder/services/deckBuilder/roleBasis';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

export interface RoleBasisTipProps {
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
 * estimate. One consolidated tip, not an icon per row (STYLE_GUIDE § Info
 * tooltips). Display only: the targets themselves are sized elsewhere.
 */
export function RoleBasisTip({
  targets,
  commanderCounts,
  commanderDecks,
  bracket,
}: RoleBasisTipProps): JSX.Element {
  const rows = roleBasisRows(
    { ramp: undefined, removal: undefined, boardwipe: undefined, cardDraw: undefined, ...targets },
    commanderCounts as Record<RoleKey, number> | null | undefined
  );
  const hasCommander = rows.some((r) => r.commander !== null);
  const bracketRef = bracket ? bracketReference(bracket.value) : null;
  return (
    <InfoTip
      wide
      label="role targets"
      ariaLabel="Where the role targets come from"
      text={
        <>
          <p className="info-tip-lead">
            {hasCommander
              ? 'Each target blends this commander’s EDHREC page with a general model. These references show where it sits.'
              : 'These references show where each target sits.'}
          </p>
          <ul className="info-tip-list">
            {rows.map((r) => (
              <li key={r.role}>
                <b>{ROLE_TITLES[r.role]}</b>
                {typeof r.target === 'number' ? ` target ${r.target}` : ''}
                {r.commander !== null ? `, this commander ${r.commander}` : ''}, average decks{' '}
                {r.baseline.median} ({r.baseline.q1} to {r.baseline.q3}), expert {r.expert}
              </li>
            ))}
          </ul>
          <ul className="info-tip-list">
            {hasCommander && (
              <li>
                This commander (estimate): cards in the role that 1 in 4 of its{' '}
                {commanderDecks ? `${commanderDecks.toLocaleString()} ` : ''}EDHREC decks play.
                {isThinSample(commanderDecks) ? ' A small sample, so a hunch.' : ''}
              </li>
            )}
            <li>
              Average decks (measured): the median and middle half across {BASELINE_SAMPLE} EDHREC
              average decks.
            </li>
            <li>
              Expert (estimate): the Command Zone&apos;s 2025 template, read from a secondary
              summary. Its removal and wipe counts include more than our tags do.
            </li>
          </ul>
          {bracketRef && bracket && (
            <p>
              Bracket {bracket.value} ({bracket.stated ? 'stated' : 'estimated'}), measured on
              EDHREC bracket pages: {bracketRef.lands} lands, average mana value{' '}
              {bracketRef.averageMv}, {bracketRef.tutors} tutors.
            </p>
          )}
        </>
      }
    />
  );
}
