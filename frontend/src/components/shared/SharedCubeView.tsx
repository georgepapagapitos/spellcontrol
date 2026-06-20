import { useMemo, useState } from 'react';
import type { PublicCube, PublicCubeCard } from '../../lib/shared-types';
import { normalizeForSearch } from '../../lib/normalize-search';
import { SearchPill } from '../SearchPill';

interface Props {
  data: PublicCube;
}

/** Color-bucket section order + labels, mirroring the cube generator's BUCKETS. */
const BUCKET_ORDER = ['W', 'U', 'B', 'R', 'G', 'multicolor', 'colorless', 'land'] as const;
const BUCKET_LABEL: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  multicolor: 'Multicolor',
  colorless: 'Colorless',
  land: 'Lands',
};

/**
 * Read-only view for a shared cube. Cube cards are oracle-level (no set/image),
 * so this is a sectioned text list grouped by color bucket — not an image grid.
 */
export function SharedCubeView({ data }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = normalizeForSearch(search);
    if (!q) return data.cards;
    return data.cards.filter((c) => normalizeForSearch(c.name).includes(q));
  }, [data.cards, search]);

  const sections = useMemo(() => {
    const map = new Map<string, PublicCubeCard[]>();
    for (const c of filtered) {
      const arr = map.get(c.bucket);
      if (arr) arr.push(c);
      else map.set(c.bucket, [c]);
    }
    // Known buckets first in canonical order, then any unexpected bucket keys.
    const keys = [
      ...BUCKET_ORDER.filter((b) => map.has(b)),
      ...[...map.keys()].filter((k) => !BUCKET_ORDER.includes(k as (typeof BUCKET_ORDER)[number])),
    ];
    return keys.map((key) => ({ key, cards: map.get(key) ?? [] }));
  }, [filtered]);

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Shared by @{data.ownerUsername}</p>
        <h1 className="shared-view-title">{data.name}</h1>
        <p className="shared-view-subtitle">
          {data.cards.length.toLocaleString()} {data.cards.length === 1 ? 'card' : 'cards'} ·{' '}
          {data.size}-card cube
          {data.shortfall > 0 && ` · ${data.shortfall} short`}
        </p>
      </header>

      {data.gaps.length > 0 && (
        <ul className="shared-cube-gaps" aria-label="Cube notes">
          {data.gaps.map((g, i) => (
            <li key={i} className={`shared-cube-gap is-${g.severity}`}>
              {g.text}
            </li>
          ))}
        </ul>
      )}

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards…"
          ariaLabel="Search cards"
          className="shared-toolbar-search"
        />
      </div>

      {sections.length === 0 ? (
        <p className="shared-empty">
          {data.cards.length === 0 ? 'This cube is empty.' : 'No cards match your search.'}
        </p>
      ) : (
        <div className="shared-cube-sections">
          {sections.map(({ key, cards }) => (
            <section
              key={key}
              className="shared-cube-section"
              aria-label={BUCKET_LABEL[key] ?? key}
            >
              <h2 className="shared-cube-section-head">
                {BUCKET_LABEL[key] ?? key}
                <span className="shared-cube-section-count">{cards.length}</span>
              </h2>
              <ul className="shared-cube-card-list">
                {cards.map((c) => (
                  <li key={c.oracleId} className="shared-cube-card-row">
                    <span className="shared-cube-card-name">{c.name}</span>
                    <span className="shared-cube-card-type">{c.typeLine}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
