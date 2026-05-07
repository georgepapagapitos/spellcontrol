import { useMemo } from 'react';
import { useCollectionStore } from '../store/collection';
import type { EnrichedCard } from '../types';
import { getColorKey, COLOR_INFO } from '../lib/colors';
import { getCardType, TYPE_ORDER } from '../lib/card-types';

const COLOR_BUCKETS: Array<{ key: string; label: string; color: string; ms: string }> = [
  { key: 'W', label: 'White', color: COLOR_INFO.W.pip, ms: 'ms-w' },
  { key: 'U', label: 'Blue', color: COLOR_INFO.U.pip, ms: 'ms-u' },
  { key: 'B', label: 'Black', color: COLOR_INFO.B.pip, ms: 'ms-b' },
  { key: 'R', label: 'Red', color: COLOR_INFO.R.pip, ms: 'ms-r' },
  { key: 'G', label: 'Green', color: COLOR_INFO.G.pip, ms: 'ms-g' },
  { key: 'M', label: 'Multicolor', color: COLOR_INFO.M.pip, ms: 'ms-multicolor' },
  { key: 'C', label: 'Colorless', color: COLOR_INFO.C.pip, ms: 'ms-c' },
];

const TYPE_ICONS: Record<string, string> = {
  creature: 'ms-creature',
  instant: 'ms-instant',
  sorcery: 'ms-sorcery',
  artifact: 'ms-artifact',
  enchantment: 'ms-enchantment',
  land: 'ms-land',
  planeswalker: 'ms-planeswalker',
  battle: 'ms-battle',
};

const TYPE_LABELS: Record<string, string> = {
  creature: 'Creature',
  instant: 'Instant',
  sorcery: 'Sorcery',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  land: 'Land',
  planeswalker: 'Planeswalker',
  battle: 'Battle',
  other: 'Other',
};

const RARITY_BUCKETS: Array<{ key: string; label: string; color: string }> = [
  { key: 'mythic', label: 'Mythic', color: 'var(--rarity-mythic-to)' },
  { key: 'rare', label: 'Rare', color: 'var(--rarity-rare-to)' },
  { key: 'uncommon', label: 'Uncommon', color: 'var(--rarity-uncommon-to)' },
  { key: 'common', label: 'Common', color: 'var(--rarity-common-to)' },
];

export function StatsBar() {
  const cards = useCollectionStore((s) => s.cards);
  const scryfallMisses = useCollectionStore((s) => s.scryfallMisses);
  const binderDefs = useCollectionStore((s) => s.binders);

  const totalValue = cards.reduce((sum, c) => sum + c.purchasePrice, 0);

  // Unique printings (by scryfallId) — breakdowns count one per unique printing,
  // matching the reference UI where 3,365 unique sums to 6,440 total copies.
  const uniqueCards = useMemo(() => {
    const seen = new Map<string, EnrichedCard>();
    for (const c of cards) {
      if (!seen.has(c.scryfallId)) seen.set(c.scryfallId, c);
    }
    return [...seen.values()];
  }, [cards]);

  const colorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of uniqueCards) {
      const k = getColorKey(c);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [uniqueCards]);

  const typeBreakdown = useMemo(() => {
    // Per-type total count + per-color split for the stacked mini-bars.
    const totals: Record<string, number> = {};
    const splits: Record<string, Record<string, number>> = {};
    for (const c of uniqueCards) {
      const t = getCardType(c);
      const colorKey = getColorKey(c);
      totals[t] = (totals[t] ?? 0) + 1;
      if (!splits[t]) splits[t] = {};
      splits[t][colorKey] = (splits[t][colorKey] ?? 0) + 1;
    }
    return TYPE_ORDER.filter((t) => (totals[t] ?? 0) > 0).map((t) => ({
      key: t,
      label: TYPE_LABELS[t] ?? t,
      total: totals[t] ?? 0,
      splits: splits[t] ?? {},
    }));
  }, [uniqueCards]);

  const rarityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of uniqueCards) {
      const r = (c.rarity || '').toLowerCase();
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }, [uniqueCards]);

  const uniqueTotal = uniqueCards.length;
  const denom = Math.max(1, uniqueTotal);

  // Stale-import detection (kept from previous version).
  const usesNewFilters = binderDefs.some((b) =>
    (b.filterGroups || []).some((g) => {
      const f = g.filter || {};
      return (
        (f.legalities && f.legalities.length > 0) ||
        (f.oracleChips && f.oracleChips.length > 0) ||
        (f.layouts && f.layouts.length > 0) ||
        (f.finishes && f.finishes.length > 0) ||
        f.manaCost
      );
    })
  );
  const cardsLackNewFields = cards.length > 0 && !cards.some((c) => c.legalities !== undefined);
  const showStaleBanner = usesNewFilters && cardsLackNewFields;

  return (
    <>
      <div className="breakdown-overview">
        <span className="breakdown-overview-label">Overview</span>
        <span className="breakdown-overview-stats">
          <span className="breakdown-overview-num">{cards.length.toLocaleString()}</span>
          <span className="breakdown-overview-unit">cards</span>
          <span className="breakdown-overview-sep">·</span>
          <span className="breakdown-overview-num">${totalValue.toFixed(0)}</span>
          <span className="breakdown-overview-unit">value</span>
        </span>
      </div>

      <div className="breakdown-grid">
        {/* Colors */}
        <section className="breakdown-card" aria-label="Cards by color">
          <h3 className="breakdown-title">Colors</h3>
          <ul className="breakdown-list">
            {COLOR_BUCKETS.map((b) => {
              const count = colorCounts[b.key] ?? 0;
              const pct = uniqueTotal > 0 ? Math.round((count / uniqueTotal) * 100) : 0;
              const width = (count / denom) * 100;
              return (
                <li key={b.key} className="breakdown-row">
                  <div className="breakdown-row-head">
                    <i className={`ms ${b.ms} ms-cost color-pip-mana`} aria-hidden />
                    <span className="breakdown-row-label">{b.label}</span>
                    <span className="breakdown-row-count">{count.toLocaleString()}</span>
                    <span className="breakdown-row-pct">({pct}%)</span>
                  </div>
                  <div className="breakdown-bar">
                    <div
                      className="breakdown-bar-fill"
                      style={{ width: `${width}%`, background: b.color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Types */}
        <section className="breakdown-card" aria-label="Cards by type">
          <h3 className="breakdown-title">Types</h3>
          <ul className="breakdown-list breakdown-list-types">
            {typeBreakdown.map((t) => {
              const width = (t.total / denom) * 100;
              return (
                <li key={t.key} className="breakdown-row">
                  <div className="breakdown-row-head">
                    {TYPE_ICONS[t.key] && (
                      <i className={`ms ${TYPE_ICONS[t.key]} breakdown-icon`} aria-hidden />
                    )}
                    <span className="breakdown-row-label">{t.label}</span>
                    <span className="breakdown-row-count">{t.total.toLocaleString()}</span>
                  </div>
                  <div className="breakdown-bar">
                    <div className="breakdown-bar-fill segmented" style={{ width: `${width}%` }}>
                      {COLOR_BUCKETS.map((b) => {
                        const seg = t.splits[b.key] ?? 0;
                        if (seg === 0) return null;
                        const segPct = (seg / t.total) * 100;
                        return (
                          <div
                            key={b.key}
                            className="breakdown-bar-seg"
                            style={{ width: `${segPct}%`, background: b.color }}
                            title={`${b.label}: ${seg}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Rarity */}
        <section className="breakdown-card" aria-label="Cards by rarity">
          <h3 className="breakdown-title">Rarity</h3>
          <ul className="breakdown-list">
            {RARITY_BUCKETS.map((b) => {
              const count = rarityCounts[b.key] ?? 0;
              const pct = uniqueTotal > 0 ? Math.round((count / uniqueTotal) * 100) : 0;
              const width = (count / denom) * 100;
              return (
                <li key={b.key} className="breakdown-row">
                  <div className="breakdown-row-head">
                    <i
                      className={`ms ms-planeswalker breakdown-icon breakdown-icon-rarity rarity-${b.key}`}
                      aria-hidden
                    />
                    <span className="breakdown-row-label">{b.label}</span>
                    <span className="breakdown-row-count">{count.toLocaleString()}</span>
                    <span className="breakdown-row-pct">({pct}%)</span>
                  </div>
                  <div className="breakdown-bar">
                    <div
                      className="breakdown-bar-fill"
                      style={{ width: `${width}%`, background: b.color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {showStaleBanner && (
        <div className="warn-banner">
          ⚠️ Your cards are missing some Scryfall fields — re-import your collection to use the new
          format / oracle / layout / finish filters.
        </div>
      )}
      {scryfallMisses > 0 && (
        <div className="warn-banner">
          ⚠️ {scryfallMisses} card{scryfallMisses !== 1 ? 's' : ''} could not be enriched with
          Scryfall data — color/CMC/type sorting may be inaccurate for those cards.
        </div>
      )}
    </>
  );
}
