import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import type { EnrichedCard } from '../types';
import { getColorKey, COLOR_INFO } from '../lib/colors';
import { getCardType, TYPE_ORDER } from '../lib/card-types';
import { ColorPip, ManaSymbol, TypeIcon } from './shared/ManaSymbol';
import { MeterBar, StackedBar } from './shared/MeterBar';

const COLOR_BUCKETS: Array<{ key: string; label: string; color: string }> = [
  { key: 'W', label: 'White', color: COLOR_INFO.W.pip },
  { key: 'U', label: 'Blue', color: COLOR_INFO.U.pip },
  { key: 'B', label: 'Black', color: COLOR_INFO.B.pip },
  { key: 'R', label: 'Red', color: COLOR_INFO.R.pip },
  { key: 'G', label: 'Green', color: COLOR_INFO.G.pip },
  { key: 'M', label: 'Multicolor', color: COLOR_INFO.M.pip },
  { key: 'C', label: 'Colorless', color: COLOR_INFO.C.pip },
];

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

interface Props {
  open: boolean;
  onClose: () => void;
}

export function StatsBar({ open, onClose }: Props) {
  const cards = useCollectionStore((s) => s.cards);
  const scryfallMisses = useCollectionStore((s) => s.scryfallMisses);
  const binderDefs = useCollectionStore((s) => s.binders);

  // True if any rule references the post-v1 filter fields (legalities /
  // oracle / layouts / finishes / manaCost).
  const usesNewFilters = binderDefs.some((b) =>
    (b.filterGroups || []).some((g) => {
      const f = g.filter || {};
      return (
        (f.legalities?.chips.length ?? 0) > 0 ||
        (f.oracleChips?.chips.length ?? 0) > 0 ||
        (f.layouts?.chips.length ?? 0) > 0 ||
        (f.finishes?.chips.length ?? 0) > 0 ||
        f.manaCost
      );
    })
  );
  const cardsLackNewFields = cards.length > 0 && !cards.some((c) => c.legalities !== undefined);
  const showStaleBanner = usesNewFilters && cardsLackNewFields;

  return (
    <>
      {showStaleBanner && (
        <div className="warn-banner">
          Your cards are missing some Scryfall fields — re-import your collection to use the new
          format / oracle / layout / finish filters.
        </div>
      )}
      {scryfallMisses > 0 && (
        <div className="warn-banner">
          {scryfallMisses} card{scryfallMisses !== 1 ? 's' : ''} couldn't be enriched with Scryfall
          data — color/mana value/type sorting may be inaccurate for those cards.
        </div>
      )}

      {open && <StatsDrawer cards={cards} onClose={onClose} />}
    </>
  );
}

/**
 * The drawer itself, split out so it mounts fresh on every open — that
 * replays the entry slide and resets useSheetExit's closing state (the
 * hook is one-shot; it must unmount with the drawer, not live in the
 * always-mounted StatsBar shell).
 */
function StatsDrawer({ cards, onClose }: { cards: EnrichedCard[]; onClose: () => void }) {
  useLockBodyScroll();

  // Symmetric slide-out exit (side drawer: in from the right, back out to
  // the right) so every dismiss path — backdrop, ✕, Escape — plays
  // `stats-drawer-slide-out` before unmount instead of vanishing.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'stats-drawer-slide-out');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') beginClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beginClose]);

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

  return (
    <div className="stats-drawer-root">
      <div
        className={`stats-drawer-backdrop${isClosing ? ' is-closing' : ''}`}
        onClick={() => beginClose()}
        aria-hidden
      />
      <aside
        className={`stats-drawer${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Collection breakdown"
        onAnimationEnd={onAnimationEnd}
      >
        <header className="stats-drawer-header">
          <h2 className="stats-drawer-title">Breakdown</h2>
          <button
            type="button"
            className="stats-drawer-close"
            onClick={() => beginClose()}
            aria-label="Close breakdown"
          >
            <X width={20} height={20} strokeWidth={1.8} aria-hidden />
          </button>
        </header>

        <div className="stats-drawer-body">
          <section className="breakdown-card" aria-label="Cards by color">
            <h3 className="breakdown-title">Colors</h3>
            <ul className="breakdown-list">
              {COLOR_BUCKETS.map((b) => {
                const count = colorCounts[b.key] ?? 0;
                const pct = uniqueTotal > 0 ? Math.round((count / uniqueTotal) * 100) : 0;
                return (
                  <li key={b.key} className="breakdown-row">
                    <div className="breakdown-row-head">
                      <ColorPip color={b.key} />
                      <span className="breakdown-row-label">{b.label}</span>
                      <span className="breakdown-row-count">{count.toLocaleString()}</span>
                      <span className="breakdown-row-pct">({pct}%)</span>
                    </div>
                    <MeterBar value={count} max={denom} color={b.color} />
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="breakdown-card" aria-label="Cards by type">
            <h3 className="breakdown-title">Types</h3>
            <ul className="breakdown-list breakdown-list-types">
              {typeBreakdown.map((t) => {
                return (
                  <li key={t.key} className="breakdown-row">
                    <div className="breakdown-row-head">
                      {t.key !== 'other' && <TypeIcon type={t.key} className="breakdown-icon" />}
                      <span className="breakdown-row-label">{t.label}</span>
                      <span className="breakdown-row-count">{t.total.toLocaleString()}</span>
                    </div>
                    <StackedBar
                      max={denom}
                      segments={COLOR_BUCKETS.map((b) => ({
                        key: b.key,
                        value: t.splits[b.key] ?? 0,
                        color: b.color,
                        title: `${b.label}: ${t.splits[b.key] ?? 0}`,
                      }))}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="breakdown-card" aria-label="Cards by rarity">
            <h3 className="breakdown-title">Rarity</h3>
            <ul className="breakdown-list">
              {RARITY_BUCKETS.map((b) => {
                const count = rarityCounts[b.key] ?? 0;
                const pct = uniqueTotal > 0 ? Math.round((count / uniqueTotal) * 100) : 0;
                return (
                  <li key={b.key} className="breakdown-row">
                    <div className="breakdown-row-head">
                      <ManaSymbol
                        symbol="planeswalker"
                        className={`breakdown-icon breakdown-icon-rarity rarity-${b.key}`}
                      />
                      <span className="breakdown-row-label">{b.label}</span>
                      <span className="breakdown-row-count">{count.toLocaleString()}</span>
                      <span className="breakdown-row-pct">({pct}%)</span>
                    </div>
                    <MeterBar value={count} max={denom} color={b.color} />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}
