import './BinderRanking.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCommanderData,
  fetchTagPageData,
  fetchTopCommanders,
} from '@/deck-builder/services/edhrec/client';
import { getCardByName, getCardPrice } from '@/deck-builder/services/scryfall/client';
import type { EDHRECTheme } from '@/deck-builder/types';
import { getCurrency } from '@/lib/currency';
import { formatMoney } from '@/lib/format-money';
import {
  compareCoverage,
  computeCoverage,
  computeReasonLine,
  type CommanderCoverage,
} from '@/lib/commander-coverage';
import { computeReadiness, type ReadinessScore } from '@/lib/commander-readiness';
import type { EnrichedCard } from '@/types';
import { MeterBar } from '../shared/MeterBar';
import { CommanderResultCard } from './CommanderResultCard';
import { Button } from '@/components/shared/Button';

/** Parallel EDHREC page fetches per ranking run (the client throttles too). */
const CONCURRENCY = 4;
/** Rows shown before "Show all"; the reason line loads eagerly for these. */
const PREVIEW_COUNT = 10;

interface Candidate {
  name: string;
  colors: string[];
  /** The owned copy, for printing-exact selection. Absent for EDHREC picks. */
  owned?: EnrichedCard;
  imageUrl?: string;
}

interface RowData {
  coverage: CommanderCoverage;
  readiness: ReadinessScore;
  theme?: EDHRECTheme;
  numDecks: number;
  /** Formatted commander price, not-owned rows only. Null when unknown. */
  price?: string | null;
}

interface Props {
  colorFilter: Set<string>;
  colorLabel: string;
  /** "Commanders I own" on: hide the not-owned section. */
  ownedOnly: boolean;
  collectionLegends: EnrichedCard[];
  collectionCards: EnrichedCard[];
  /** All owned card names, lowercased. */
  ownedCardNames: Set<string>;
  landCount: number;
  disabled: boolean;
  onSelectOwned: (card: EnrichedCard) => void;
  onSelectByName: (name: string) => void;
}

async function runPool<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
  cancelled: () => boolean
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (!cancelled() && next < items.length) await fn(items[next++]);
    })
  );
}

const rowKey = (epoch: number, name: string) => `${epoch}:${name.toLowerCase()}`;

function exactColors(ci: string[] | undefined, filter: Set<string>): boolean {
  const ident = ci && ci.length > 0 ? ci : ['C'];
  return ident.length === filter.size && ident.every((c) => filter.has(c));
}

/**
 * "Build from my binder": every commander you own in the chosen colors, ranked
 * by how much of its deck your collection already covers (E283, the E282
 * coverage metric), with EDHREC's top commanders for those colors ranked the
 * same way underneath. Coverage loads eagerly and batched; the per-row reason
 * line (the top archetype page's owned share) loads for the visible rows and
 * on hover for the rest.
 */
export function BinderRanking({
  colorFilter,
  colorLabel,
  ownedOnly,
  collectionLegends,
  collectionCards,
  ownedCardNames,
  landCount,
  disabled,
  onSelectOwned,
  onSelectByName,
}: Props) {
  const colorKey = [...colorFilter].sort().join('');

  const ownedCandidates = useMemo<Candidate[]>(
    () =>
      collectionLegends
        .filter((c) => exactColors(c.colorIdentity, colorFilter))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          name: c.name,
          colors: c.colorIdentity && c.colorIdentity.length > 0 ? c.colorIdentity : ['C'],
          owned: c,
          imageUrl: c.imageNormal,
        })),
    [collectionLegends, colorFilter]
  );
  const ownedLegendNames = useMemo(
    () => new Set(collectionLegends.map((c) => c.name.toLowerCase())),
    [collectionLegends]
  );
  const identityByName = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of collectionCards) map.set(c.name.toLowerCase(), c.colorIdentity ?? []);
    return map;
  }, [collectionCards]);

  // EDHREC's top commanders for these colors, minus the ones you own.
  const [topCandidates, setTopCandidates] = useState<Candidate[]>([]);
  const [topError, setTopError] = useState(false);
  const [topLoading, setTopLoading] = useState(false);
  const [topReloadKey, setTopReloadKey] = useState(0);
  useEffect(() => {
    if (ownedOnly || colorFilter.size === 0) return;
    let cancelled = false;
    void (async () => {
      setTopLoading(true);
      setTopError(false);
      try {
        const list = await fetchTopCommanders([...colorFilter]);
        if (cancelled) return;
        setTopCandidates(
          list
            .filter((c) => !c.name.includes('//') && !ownedLegendNames.has(c.name.toLowerCase()))
            .map((c) => ({
              name: c.name,
              colors: c.colorIdentity.length > 0 ? c.colorIdentity : ['C'],
            }))
        );
      } catch {
        if (!cancelled) {
          setTopCandidates([]);
          setTopError(true);
        }
      } finally {
        if (!cancelled) setTopLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownedOnly, colorFilter, ownedLegendNames, topReloadKey]);

  // Coverage per commander, keyed by `${epoch}:${lowercased name}`. A
  // commander's coverage depends only on its own identity and the collection,
  // never on the filter, so the map is a cache across filter changes: a run
  // only fetches the candidates not requested yet, and the effect cleanup
  // aborts it (and un-requests the unresolved names) on change. `epoch` bumps
  // when the collection or land count changes, which invalidates every key.
  const [rows, setRows] = useState<Map<string, RowData>>(new Map());
  const [epoch, setEpoch] = useState(0);
  const [prevInputs, setPrevInputs] = useState({ ownedCardNames, identityByName, landCount });
  if (
    prevInputs.ownedCardNames !== ownedCardNames ||
    prevInputs.identityByName !== identityByName ||
    prevInputs.landCount !== landCount
  ) {
    setPrevInputs({ ownedCardNames, identityByName, landCount });
    setEpoch((e) => e + 1);
  }
  const requested = useRef(new Set<string>());
  const candidates = useMemo(
    () => (ownedOnly ? ownedCandidates : [...ownedCandidates, ...topCandidates]),
    [ownedOnly, ownedCandidates, topCandidates]
  );
  useEffect(() => {
    const keyOf = (c: Candidate) => rowKey(epoch, c.name);
    const seen = requested.current;
    const pending = candidates.filter((c) => !seen.has(keyOf(c)));
    if (colorFilter.size === 0 || pending.length === 0) return;
    for (const c of pending) seen.add(keyOf(c));
    const resolved = new Set<string>();
    let cancelled = false;
    void runPool(
      pending,
      async (c) => {
        let data: RowData;
        try {
          const page = await fetchCommanderData(c.name);
          data = {
            coverage: computeCoverage(
              page.cardlists.allNonLand,
              ownedCardNames,
              identityByName,
              c.colors,
              landCount
            ),
            readiness: computeReadiness(page.cardlists.allNonLand, ownedCardNames),
            theme: page.themes[0],
            numDecks: page.stats.numDecks,
          };
        } catch {
          data = {
            coverage: computeCoverage([], ownedCardNames, identityByName, c.colors, landCount),
            readiness: computeReadiness([], ownedCardNames),
            numDecks: 0,
          };
        }
        if (!c.owned) {
          try {
            const card = await getCardByName(c.name);
            const raw = getCardPrice(card, getCurrency());
            // Whole dollars once the price is big enough for cents to be noise;
            // a $0.30 commander must not read as "$0".
            data.price = raw ? formatMoney(Number(raw), { wholeDollars: Number(raw) >= 10 }) : null;
          } catch {
            data.price = null;
          }
        }
        if (cancelled) return;
        resolved.add(keyOf(c));
        setRows((prev) => new Map(prev).set(keyOf(c), data));
      },
      () => cancelled
    );
    return () => {
      cancelled = true;
      for (const c of pending) if (!resolved.has(keyOf(c))) seen.delete(keyOf(c));
    };
  }, [colorFilter, candidates, epoch, ownedCardNames, identityByName, landCount]);
  const total = candidates.length;
  const done = candidates.filter((c) => rows.has(rowKey(epoch, c.name))).length;
  const ranked = total > 0 && done === total;

  // Reason line per row: the top archetype page's owned share. Cached per
  // tag × color inside the EDHREC client, so shared themes cost one fetch;
  // cached per commander here, since it never depends on the filter.
  const [reasons, setReasons] = useState<Map<string, string | null | 'loading'>>(new Map());
  const reasonSeen = useRef(new Set<string>());
  const ensureReason = useCallback(
    async (c: Candidate) => {
      const key = c.name.toLowerCase();
      const row = rows.get(rowKey(epoch, c.name));
      if (!row?.theme || reasonSeen.current.has(key)) return;
      reasonSeen.current.add(key);
      setReasons((prev) => new Map(prev).set(key, 'loading'));
      let line: string | null = null;
      try {
        const page = await fetchTagPageData(row.theme.slug, c.colors);
        line = page
          ? computeReasonLine(page.cardlists.allNonLand, ownedCardNames, row.theme.name)
          : null;
      } catch {
        line = null;
      }
      setReasons((prev) => new Map(prev).set(key, line));
    },
    [rows, epoch, ownedCardNames]
  );

  const ownedRanked = useMemo(
    () =>
      ranked
        ? [...ownedCandidates]
            .map((c) => ({ ...c, coverage: rows.get(rowKey(epoch, c.name))?.coverage }))
            .sort(compareCoverage)
        : ownedCandidates,
    [ranked, ownedCandidates, rows, epoch]
  );
  const topRanked = useMemo(
    () =>
      ranked
        ? [...topCandidates]
            .map((c) => ({ ...c, coverage: rows.get(rowKey(epoch, c.name))?.coverage }))
            .sort(compareCoverage)
        : topCandidates,
    [ranked, topCandidates, rows, epoch]
  );

  const [showAllOwned, setShowAllOwned] = useState(false);
  const [showAllTop, setShowAllTop] = useState(false);
  const [prevKey, setPrevKey] = useState(colorKey);
  if (prevKey !== colorKey) {
    setPrevKey(colorKey);
    setShowAllOwned(false);
    setShowAllTop(false);
  }

  // Eager reason lines for the rows on screen once the ranking has settled.
  useEffect(() => {
    if (!ranked) return;
    let cancelled = false;
    void (async () => {
      const visible = [
        ...ownedRanked.slice(0, showAllOwned ? undefined : PREVIEW_COUNT),
        ...topRanked.slice(0, showAllTop ? undefined : PREVIEW_COUNT),
      ];
      for (const c of visible) {
        if (cancelled) return;
        await ensureReason(c);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ranked, ownedRanked, topRanked, showAllOwned, showAllTop, ensureReason]);

  if (colorFilter.size === 0) {
    return (
      <p className="commander-suggestions-hint">
        Pick a color to rank the commanders you own by how much of the deck your collection already
        covers.
      </p>
    );
  }

  const status = !ranked
    ? total > 0
      ? `Checking ${total} commander${total === 1 ? '' : 's'} against your collection, ${done} done`
      : topLoading
        ? 'Loading commanders…'
        : ''
    : `${total} commander${total === 1 ? '' : 's'} ranked, best coverage first`;

  const renderRow = (c: Candidate) => {
    const key = c.name.toLowerCase();
    const row = rows.get(rowKey(epoch, c.name));
    const reason = reasons.get(key);
    const detail = row ? (
      <span className="binder-rank-detail">
        {row.coverage.available ? (
          <MeterBar
            value={row.coverage.owned}
            max={row.coverage.comfortable}
            color={row.coverage.thin ? 'var(--warn-border)' : 'var(--success)'}
            className="binder-rank-bar"
          />
        ) : (
          <MeterBar value={0} className="binder-rank-bar" />
        )}
        <span className="binder-rank-line">{row.coverage.line}</span>
        <span className="binder-rank-meta">
          {row.theme && <span>{row.theme.name}</span>}
          {row.numDecks > 0 && <span>{row.numDecks.toLocaleString()} decks on EDHREC</span>}
          {!c.owned && (
            <span className="binder-rank-unowned">
              Not in your binder{row.price ? ` · ${row.price}` : ''}
            </span>
          )}
        </span>
        {typeof reason === 'string' && <span className="binder-rank-reason">{reason}</span>}
      </span>
    ) : (
      <span className="binder-rank-detail">
        <MeterBar value={0} indeterminate className="binder-rank-bar" />
        <span className="binder-rank-line">Checking your collection…</span>
      </span>
    );
    return (
      <li key={key}>
        <CommanderResultCard
          name={c.name}
          imageUrl={c.imageUrl}
          colors={c.colors}
          readiness={row ? row.readiness : 'loading'}
          disabled={disabled}
          onSelect={() => (c.owned ? onSelectOwned(c.owned) : onSelectByName(c.name))}
          onPeek={() => void ensureReason(c)}
          detail={detail}
        />
      </li>
    );
  };

  const renderList = (
    list: Candidate[],
    showAll: boolean,
    setShowAll: (fn: (v: boolean) => boolean) => void
  ) => (
    <>
      <ul className="commander-result-grid binder-rank-grid">
        {(showAll ? list : list.slice(0, PREVIEW_COUNT)).map(renderRow)}
      </ul>
      {list.length > PREVIEW_COUNT && (
        <button
          type="button"
          className="commander-playstyle-more"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </>
  );

  return (
    <div className="binder-rank">
      <p className="commander-suggestions-label" role="status" aria-live="polite">
        {status}
      </p>

      <section className="binder-rank-section" aria-label={`${colorLabel} commanders you own`}>
        <h3 className="binder-rank-heading">Commanders you own</h3>
        {ownedCandidates.length === 0 ? (
          <p className="commander-suggestions-empty">
            None of your commanders are exactly {colorLabel}.
            {ownedOnly ? ' Uncheck “Commanders I own” to see what EDHREC suggests.' : ''}
          </p>
        ) : (
          renderList(ownedRanked, showAllOwned, setShowAllOwned)
        )}
      </section>

      {!ownedOnly && (
        <section
          className="binder-rank-section"
          aria-label={`${colorLabel} commanders not in your binder`}
        >
          <h3 className="binder-rank-heading">Not in your binder</h3>
          {topError ? (
            <p className="commander-suggestions-empty" role="alert">
              Couldn't reach EDHREC for top commanders. Check your connection and try again.{' '}
              <Button variant="link" onClick={() => setTopReloadKey((k) => k + 1)}>
                Retry
              </Button>
            </p>
          ) : topLoading ? (
            <p className="commander-suggestions-empty">Loading commanders…</p>
          ) : topCandidates.length === 0 ? (
            <p className="commander-suggestions-empty">
              You already own every top {colorLabel} commander on EDHREC.
            </p>
          ) : (
            renderList(topRanked, showAllTop, setShowAllTop)
          )}
        </section>
      )}
    </div>
  );
}
