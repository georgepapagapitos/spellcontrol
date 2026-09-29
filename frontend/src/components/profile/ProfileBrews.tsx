import { Link } from 'react-router-dom';
import { ColorPip } from '../shared/ManaSymbol';
import { StackedBar, type StackedBarSegment } from '../shared/MeterBar';
import { formatCount } from '@/lib/util/format-count';
import type { ProfileColor, ProfileGameRecord, PublicProfile } from '@/lib/social/profile-client';
import './ProfileBrews.css';

const COLOR_ORDER: ProfileColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];
const COLOR_NAME: Record<ProfileColor, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};
const COLOR_VAR: Record<ProfileColor, string> = {
  W: 'var(--mtg-w)',
  U: 'var(--mtg-u)',
  B: 'var(--mtg-b)',
  R: 'var(--mtg-r)',
  G: 'var(--mtg-g)',
  C: 'var(--mtg-colorless)',
};

function ColorSpread({ spread }: { spread: PublicProfile['colorSpread'] }) {
  const present = COLOR_ORDER.filter((c) => spread[c] > 0);
  if (present.length === 0) return null;
  const segments: StackedBarSegment[] = present.map((c) => ({
    key: c,
    value: spread[c],
    color: COLOR_VAR[c],
    title: `${COLOR_NAME[c]}: ${spread[c]}`,
  }));
  return (
    <div className="profile-brews-colors">
      <StackedBar segments={segments} size="md" />
      <ul className="profile-brews-legend" aria-label="Decks by color">
        {present.map((c) => (
          <li key={c} aria-label={`${spread[c]} ${COLOR_NAME[c]}`}>
            <ColorPip color={c} />
            <span aria-hidden="true">{spread[c]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Brews most": their top commanders (each opens Discover filtered to it) and
 * the colours their decks lean on. Renders nothing for a brewer with no live
 * decks, so an empty shelf never wears an empty panel.
 */
export function ProfileBrews({ profile }: { profile: PublicProfile }) {
  const { topCommanders, colorSpread } = profile;
  const hasColors = COLOR_ORDER.some((c) => colorSpread[c] > 0);
  if (topCommanders.length === 0 && !hasColors) return null;
  return (
    <section className="profile-brews" aria-labelledby="profile-brews-title">
      <h2 id="profile-brews-title" className="profile-panel-title">
        Brews most
      </h2>
      {topCommanders.length > 0 && (
        <ul className="profile-brews-commanders">
          {topCommanders.map((c) => (
            <li key={c.name}>
              <Link
                className="profile-brews-commander"
                to={`/decks/discover?commander=${encodeURIComponent(c.name)}`}
              >
                {c.image ? (
                  <img className="profile-brews-thumb" src={c.image} alt="" loading="lazy" />
                ) : (
                  <span className="profile-brews-thumb" aria-hidden="true" />
                )}
                <span className="profile-brews-commander-text">
                  <span className="profile-brews-commander-name">{c.name}</span>
                  <span className="profile-brews-commander-count">
                    {formatCount(c.deckCount)} {c.deckCount === 1 ? 'deck' : 'decks'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ColorSpread spread={colorSpread} />
    </section>
  );
}

/** Games · wins · win rate, and the deck they reach for. Only when the owner opted in. */
export function ProfileGameRecordPanel({ record }: { record: ProfileGameRecord }) {
  const rate = record.games > 0 ? Math.round((record.wins / record.games) * 100) : null;
  return (
    <section className="profile-record" aria-labelledby="profile-record-title">
      <h2 id="profile-record-title" className="profile-panel-title">
        Game record
      </h2>
      <dl className="profile-record-stats">
        <div>
          <dt>Games</dt>
          <dd>{formatCount(record.games)}</dd>
        </div>
        <div>
          <dt>Wins</dt>
          <dd>{formatCount(record.wins)}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{rate === null ? 'None yet' : `${rate}%`}</dd>
        </div>
      </dl>
      {record.mostPlayed && (
        <p className="profile-record-most">
          Most played:{' '}
          {record.mostPlayed.slug ? (
            <Link className="text-link" to={`/d/${record.mostPlayed.slug}`}>
              {record.mostPlayed.name}
            </Link>
          ) : (
            <strong>{record.mostPlayed.name}</strong>
          )}
        </p>
      )}
    </section>
  );
}
