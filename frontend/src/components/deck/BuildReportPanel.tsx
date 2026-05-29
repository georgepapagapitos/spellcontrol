import './BuildReportPanel.css';
import type { BuildReport, DeckDataSource } from '@/deck-builder/types';

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

      {roleGaps && roleGaps.length > 0 && (
        <div className="build-report-gaps">
          <span className="build-report-gaps-label">Role gaps</span>
          <ul className="build-report-gaps-list">
            {roleGaps.map((g) => (
              <li key={g.role} className="build-report-gap">
                {g.role}{' '}
                <span className="build-report-gap-count">
                  {g.have}/{g.want}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
