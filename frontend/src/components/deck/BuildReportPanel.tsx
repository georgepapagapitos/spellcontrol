import type { JSX } from 'react';
import './BuildReportPanel.css';
import type { BuildReport, DeckDataSource } from '@/deck-builder/types';
import { ROLE_TITLES, type RoleKey } from '@/lib/role-badges';

/**
 * Canonical label for a role-gap key. Prefers the shared ROLE_TITLES map
 * (e.g. cardDraw → "Card Advantage"); for any unknown key, humanizes the
 * raw key by splitting camelCase and capitalizing instead of leaking it.
 */
function humanizeRole(role: string): string {
  const known = ROLE_TITLES[role as RoleKey];
  if (known) return known;
  const spaced = role.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Plain-English description of which EDHREC pool the generator ended up using. */
function humanizeDataSource(source: DeckDataSource): string {
  switch (source) {
    case 'theme+bracket':
      return 'used theme-specific EDHREC pool at your bracket';
    case 'theme':
      return 'used theme-specific EDHREC pool (bracket list unavailable)';
    case 'base+bracket':
      return 'used base EDHREC pool at your bracket';
    case 'base':
      return 'used base EDHREC pool (bracket list unavailable)';
    case 'scryfall':
      return 'used Scryfall search (no EDHREC data available)';
    default:
      return source;
  }
}

export function BuildReportPanel({ report }: { report: BuildReport }): JSX.Element {
  const {
    targetBracket,
    estimatedBracket,
    dataSource,
    builtFromCollection,
    collectionStrategy,
    ownedPercentActual,
    ownedPercentTarget,
    basicsPadded,
    roleGaps,
    claimedConflicts,
  } = report;

  const isPartial = collectionStrategy === 'partial';

  return (
    <div className="build-report">
      <p className="build-report-line build-report-bracket">
        Aimed Bracket <strong>{targetBracket}</strong> &rarr; estimated{' '}
        <strong>{estimatedBracket}</strong>
      </p>

      <p className="build-report-line build-report-source">{humanizeDataSource(dataSource)}</p>

      {builtFromCollection && typeof ownedPercentActual === 'number' && (
        <p className="build-report-line">
          <strong>{ownedPercentActual}%</strong> from your collection
          {isPartial && typeof ownedPercentTarget === 'number' && (
            <span className="build-report-muted"> (target {ownedPercentTarget}%)</span>
          )}
        </p>
      )}

      {typeof basicsPadded === 'number' && basicsPadded > 0 && (
        <p className="build-report-line">
          padded <strong>{basicsPadded}</strong> basic
          {basicsPadded === 1 ? '' : 's'}
        </p>
      )}

      {claimedConflicts != null && claimedConflicts > 0 && (
        <p className="build-report-conflict-note">
          {claimedConflicts} card{claimedConflicts === 1 ? ' you own is' : 's you own are'}{' '}
          committed to other decks — open “Review shared cards” to pull a copy in (you choose what
          the other deck does), or swap in free alternatives.
        </p>
      )}

      {roleGaps && roleGaps.length > 0 && (
        <div className="build-report-gaps">
          <span className="build-report-gaps-label">Role gaps</span>
          <ul className="build-report-gaps-list">
            {roleGaps.map((g) => (
              <li key={g.role} className="build-report-gap">
                <span className="build-report-gap-label">{humanizeRole(g.role)}</span>
                <span className="build-report-gap-count" aria-label={`${g.have} of ${g.want}`}>
                  {g.have}
                  <span className="build-report-gap-target">
                    {' / '}
                    {g.want}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
