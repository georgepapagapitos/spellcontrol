import { openDB, type IDBPDatabase } from 'idb';
import { getCurrency } from './currency';
import { formatMoney } from './format-money';

/**
 * Device-local daily log of total collection value (E76).
 *
 * One point per local calendar day, written by the client-side price-refresh
 * tick (prices change at most daily, so the tick is the natural cadence — see
 * the standing "never a server price cron" ruling). Capped at 90 points.
 *
 * Kept in its own tiny IndexedDB database, mirroring the card-price cache's
 * placement: device-local derived data that must NEVER ride the sync path —
 * it's not global reference data (so not `spellcontrol-offline`) and not
 * synced user state (so not the sync stores).
 */

export interface ValuePoint {
  /** Local-calendar-day bucket key, `YYYY-MM-DD`. */
  day: string;
  /** Total collection market value at the last snapshot that day. */
  value: number;
  /** Epoch ms of the snapshot. */
  at: number;
  /**
   * Display currency the total was computed in. Absent on points that predate
   * the currency setting — those are USD. A $-total and a €-total are
   * different market snapshots (TCGplayer vs Cardmarket), so reads filter to
   * the active currency rather than ever mixing them in one trend.
   */
  currency?: string;
  /**
   * Net market move logged this day: the sum, over every price refresh that
   * day, of (new price − old price) across the copies priced on both sides.
   * It is what lets a delta tell a price change from a collection change, since
   * `value` alone can't say whether it rose because prices rose or because an
   * import landed. Collection-only writes carry 0. Absent on points that
   * predate the split: those days are "unknown", never "no move".
   */
  market?: number;
}

export interface ValueDelta {
  /** Latest value minus the baseline value. */
  amount: number;
  /** Day key of the baseline point the delta is measured from. */
  baselineDay: string;
  /** Day key of the latest point. */
  latestDay: string;
  /** Whole days between baseline and latest. */
  spanDays: number;
  /**
   * The part of `amount` that came from price moves. `amount − market` is
   * what cards added or removed did. Null when any point after the baseline
   * predates the split, so an old log still shows its total and never a
   * guessed breakdown.
   */
  market: number | null;
}

const DB_NAME = 'spellcontrol-value-history';
const STORE = 'daily';
const MOVERS_STORE = 'movers';
const MAX_POINTS = 90;
const MAX_MOVER_DAYS = 7;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'day' });
        if (!db.objectStoreNames.contains(MOVERS_STORE))
          db.createObjectStore(MOVERS_STORE, { keyPath: 'day' });
      },
    });
  }
  return dbPromise;
}

/** Local-calendar-day key (`YYYY-MM-DD`) for an epoch-ms timestamp. */
export function dayKey(at: number): string {
  const d = new Date(at);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Whole days between two day keys (b − a). Parsed as UTC so DST can't skew it. */
export function daysBetween(a: string, b: string): number {
  const parse = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(b) - parse(a)) / 86400000);
}

/** Human-short form of a day key — `2026-06-30` → `Jun 30`. */
export function formatDayKey(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(y, m - 1, d)
  );
}

/**
 * Subscribe to writes into this log.
 *
 * Every writer is a fire-and-forget background path (the price-refresh tick,
 * the collection-store subscriber, the boot catch-all), so a surface that
 * rendered the log at mount has no way to learn it went stale a beat later —
 * it would show the old point until the next launch. Callers re-read on notify.
 */
const changeListeners = new Set<() => void>();

export function onValueHistoryChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyValueHistoryChange(): void {
  for (const listener of changeListeners) listener();
}

/**
 * Upsert today's point (last write per day wins) and trim the log to the
 * newest MAX_POINTS. Stamped with the active display currency. `marketMove` is
 * this write's price-driven change (the refresh tick passes it; collection
 * writes pass nothing) and accumulates into the day's `market`. A day first
 * written in the other currency starts its market over: a $ move and a € move
 * are different snapshots and never add. `at` is injectable for tests.
 */
export async function recordValueSnapshot(
  value: number,
  at = Date.now(),
  marketMove = 0
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  const day = dayKey(at);
  const currency = getCurrency();
  const existing = (await tx.store.get(day)) as ValuePoint | undefined;
  const carried =
    existing && (existing.currency ?? 'USD') === currency ? (existing.market ?? 0) : 0;
  const market = Math.round((carried + marketMove) * 100) / 100;
  await tx.store.put({ day, value, at, currency, market } satisfies ValuePoint);
  // Day keys are YYYY-MM-DD, so IDB's ascending key order IS chronological —
  // getAllKeys()[0..excess] are the oldest points.
  const keys = await tx.store.getAllKeys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_POINTS))) {
    await tx.store.delete(key);
  }
  await tx.done;
  notifyValueHistoryChange();
}

/**
 * Correct today's point after the collection itself changed — but only if the
 * log already has points.
 *
 * The price-refresh tick is the only other writer, and it runs only when a
 * price is stale (never at all on an empty collection — there's nothing to
 * price). So without this the newest point stays whatever the last refresh
 * saw, FOREVER: the trim in recordValueSnapshot only runs on write, so a stale
 * total never even ages out. That's the home hero cheerfully valuing a
 * collection you deleted, or valuing at $0 one you just re-imported.
 *
 * The has-points check is what keeps this from being a plain
 * `recordValueSnapshot()` at the call sites: a user who has never imported
 * anything must keep an empty log, so the hero hides the value line instead of
 * greeting them with $0. The first point is always the price refresh's to make.
 */
export async function recordCollectionSnapshot(value: number, at = Date.now()): Promise<void> {
  const db = await getDB();
  if ((await db.count(STORE)) === 0) return;
  await recordValueSnapshot(value, at);
}

/** Every stored point in the ACTIVE display currency, resets included. */
async function getCurrencyPoints(db: IDBPDatabase): Promise<ValuePoint[]> {
  const active = getCurrency();
  return ((await db.getAll(STORE)) as ValuePoint[]).filter((p) => (p.currency ?? 'USD') === active);
}

/**
 * The points that describe the collection as it is now: everything after the
 * newest $0 point.
 *
 * A $0 point means the collection was emptied (the store records one on a
 * full delete, and nothing else writes a zero: an unpriced collection is never
 * logged). The history before it belongs to cards that are gone, so a
 * re-import a week later starts a fresh trend instead of charting the old
 * collection, a cliff, and "+$5,000 from cards added". The zero is kept on
 * disk rather than clearing the log because the delete can still be undone:
 * the undo re-records today's point, which overwrites the zero and brings the
 * whole history back. While the collection is still empty this returns [].
 * Pure; `points` ascending.
 */
export function sinceLastReset(points: ValuePoint[]): ValuePoint[] {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value <= 0) return points.slice(i + 1);
  }
  return points;
}

/** The current collection's points in the ACTIVE display currency, oldest →
 *  newest. Points logged under the other currency are kept in the DB
 *  (switching back restores that trend) but never surfaced into a
 *  mixed-currency series; points from before a full delete are left out (see
 *  sinceLastReset). */
export async function getValueHistory(): Promise<ValuePoint[]> {
  return sinceLastReset(await getCurrencyPoints(await getDB()));
}

export async function clearValueHistory(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
  notifyValueHistoryChange();
}

/* ── Value movers (E133) ──────────────────────────────────────────────────
   Which cards in THIS collection moved on the latest price refresh — the
   per-card companion to the aggregate daily point above. Captured by diffing
   the collection's prices before/after a refresh (prices change at most
   daily, so refresh-to-refresh IS day-to-day), stored per local day in the
   same device-local DB, and never synced. */

/** One printing+finish whose market price moved on the latest refresh. */
export interface CardMover {
  scryfallId: string;
  finish: string;
  name: string;
  setCode: string;
  /** Per-copy price before/after the refresh, in `MoverRecord.currency`. */
  before: number;
  after: number;
  /** Owned copies of this printing+finish (delta × copies = impact). */
  copies: number;
}

export interface MoverRecord {
  /** Local-calendar-day bucket key, `YYYY-MM-DD`. */
  day: string;
  /** Epoch ms of the refresh that produced these movers. */
  at: number;
  /** Display currency of the prices. Absent = USD (mirrors ValuePoint). */
  currency?: string;
  /** Sorted by |delta × copies| descending, capped at MAX_MOVERS. */
  movers: CardMover[];
}

const MAX_MOVERS = 20;
/** Ignore per-copy moves under this — daily sub-quarter wobble is noise. */
const MIN_MOVE = 0.25;

interface PricedCardLike {
  scryfallId: string;
  finish?: string;
  purchasePrice?: number;
  name: string;
  setCode: string;
}

const moverKey = (c: PricedCardLike) => `${c.scryfallId}:${c.finish ?? 'nonfoil'}`;

/**
 * Diff a collection's per-copy prices before/after a refresh into movers.
 * Only printings priced on BOTH sides count — a card gaining its first price
 * (0 → x) is new data, not a market move. Pure; prices are in whatever
 * display currency `purchasePrice` carried (the active one on both sides,
 * since a currency switch reapplies prices outside the refresh path).
 */
export function computeMovers(before: PricedCardLike[], after: PricedCardLike[]): CardMover[] {
  const prior = new Map<string, number>();
  for (const c of before) {
    if ((c.purchasePrice ?? 0) > 0) prior.set(moverKey(c), c.purchasePrice as number);
  }
  const out = new Map<string, CardMover>();
  for (const c of after) {
    const price = c.purchasePrice ?? 0;
    if (price <= 0) continue;
    const key = moverKey(c);
    const was = prior.get(key);
    if (was === undefined) continue;
    const existing = out.get(key);
    if (existing) {
      existing.copies += 1;
      continue;
    }
    if (Math.abs(price - was) < MIN_MOVE) continue;
    out.set(key, {
      scryfallId: c.scryfallId,
      finish: c.finish ?? 'nonfoil',
      name: c.name,
      setCode: c.setCode,
      before: was,
      after: price,
      copies: 1,
    });
  }
  return [...out.values()]
    .sort(
      (a, b) =>
        Math.abs((b.after - b.before) * b.copies) - Math.abs((a.after - a.before) * a.copies)
    )
    .slice(0, MAX_MOVERS);
}

/**
 * The whole market move of one refresh: Σ (after − before) over every copy
 * priced on both sides, uncapped and unthresholded (computeMovers keeps only
 * the top moves for display; this is the total they are a sample of). First
 * pricings (0 → x) are excluded for the same reason they aren't movers: new
 * data is not a market move. Pure.
 */
export function computeMarketMove(before: PricedCardLike[], after: PricedCardLike[]): number {
  const prior = new Map<string, number>();
  for (const c of before) {
    if ((c.purchasePrice ?? 0) > 0) prior.set(moverKey(c), c.purchasePrice as number);
  }
  let move = 0;
  for (const c of after) {
    const price = c.purchasePrice ?? 0;
    if (price <= 0) continue;
    const was = prior.get(moverKey(c));
    if (was !== undefined) move += price - was;
  }
  return Math.round(move * 100) / 100;
}

/**
 * Upsert today's movers. A later same-day refresh MERGES per key — earliest
 * `before`, latest `after` — so a midday re-refresh can't erase the morning's
 * real moves; an empty diff writes nothing at all. Trimmed to the newest
 * MAX_MOVER_DAYS days. Best-effort like the snapshot: callers swallow errors.
 */
export async function recordDailyMovers(movers: CardMover[], at = Date.now()): Promise<void> {
  if (movers.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(MOVERS_STORE, 'readwrite');
  const day = dayKey(at);
  const currency = getCurrency();
  const existing = (await tx.store.get(day)) as MoverRecord | undefined;
  let merged = movers;
  if (existing && (existing.currency ?? 'USD') === currency) {
    const byKey = new Map(existing.movers.map((m) => [`${m.scryfallId}:${m.finish}`, m]));
    for (const m of movers) {
      const prev = byKey.get(`${m.scryfallId}:${m.finish}`);
      byKey.set(`${m.scryfallId}:${m.finish}`, prev ? { ...m, before: prev.before } : m);
    }
    merged = [...byKey.values()]
      .filter((m) => Math.abs(m.after - m.before) >= MIN_MOVE)
      .sort(
        (a, b) =>
          Math.abs((b.after - b.before) * b.copies) - Math.abs((a.after - a.before) * a.copies)
      )
      .slice(0, MAX_MOVERS);
    if (merged.length === 0) {
      await tx.done;
      return;
    }
  }
  await tx.store.put({ day, at, currency, movers: merged } satisfies MoverRecord);
  const keys = await tx.store.getAllKeys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_MOVER_DAYS))) {
    await tx.store.delete(key);
  }
  await tx.done;
  notifyValueHistoryChange();
}

/**
 * Newest movers record in the ACTIVE display currency, or null. A record from
 * before the newest full delete is null too: it names cards that are gone.
 */
export async function getLatestMovers(): Promise<MoverRecord | null> {
  const db = await getDB();
  const active = getCurrency();
  const records = ((await db.getAll(MOVERS_STORE)) as MoverRecord[]).filter(
    (r) => (r.currency ?? 'USD') === active
  );
  const latest = records.length ? records[records.length - 1] : null;
  if (!latest) return null;
  const lastReset = (await getCurrencyPoints(db)).filter((p) => p.value <= 0).at(-1);
  return lastReset && lastReset.at >= latest.at ? null : latest;
}

export async function clearMovers(): Promise<void> {
  const db = await getDB();
  await db.clear(MOVERS_STORE);
  notifyValueHistoryChange();
}

/**
 * Change in value over roughly the trailing week: latest point vs the most
 * recent point at least 7 days older (falling back to the oldest point when
 * the log is younger than a week). Null with fewer than two points — callers
 * should render nothing rather than an empty state.
 *
 * `points` must be ascending by day (as returned by getValueHistory).
 */
export function computeValueDelta(points: ValuePoint[]): ValueDelta | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  let baselineIdx = 0;
  for (let i = 0; i < points.length; i++) {
    if (daysBetween(points[i].day, latest.day) >= 7) baselineIdx = i;
    else break;
  }
  const baseline = points[baselineIdx];
  // The baseline's own market is already inside its value; only the moves
  // logged after it explain the change.
  let market: number | null = 0;
  for (const p of points.slice(baselineIdx + 1)) {
    if (p.market === undefined) {
      market = null;
      break;
    }
    market += p.market;
  }
  return {
    amount: latest.value - baseline.value,
    baselineDay: baseline.day,
    latestDay: latest.day,
    spanDays: daysBetween(baseline.day, latest.day),
    market: market === null ? null : Math.round(market * 100) / 100,
  };
}

export interface ValueDeltaChip {
  /** Empty when there's nothing to show (`delta` is null) — callers render
   *  nothing rather than a placeholder chip. */
  text: string;
  direction: 'up' | 'down' | 'flat';
  /**
   * What cards added or removed did to the value over the same window, as its
   * own phrase ("+$1,058 from cards added"). Present only when the log can
   * split the change and the collection part rounds to at least a dollar;
   * `text` then speaks for prices alone. Rendered neutral, never in the
   * direction colors: adding cards is not a gain.
   */
  changes?: string;
}

const signedDollars = (amount: number) =>
  `${amount > 0 ? '+' : '−'}${formatMoney(Math.abs(amount), { wholeDollars: true })}`;

/**
 * Renders a `ValueDelta` into the headline chip's text + direction, per
 * STYLE_GUIDE "Money deltas & value sparklines": "this week" only when the
 * latest point is fresh and the span is short, otherwise the honest
 * baseline date; a zero delta reads as "Steady", never "+$0". When the window
 * held a collection change (an import, a deletion), the chip says how much of
 * the move was prices and how much was cards, so an import never reads as the
 * market going up. Shared by every surface that shows this headline delta
 * (the Home hero's value chip, the Breakdown drawer's Value section) — see
 * STYLE_GUIDE's "color every rendering of the same delta" — so they can't
 * drift out of sync with each other over independent edits.
 */
export function formatValueDeltaChip(
  delta: ValueDelta | null,
  today: string,
  freshnessDays = 2
): ValueDeltaChip {
  if (!delta) return { text: '', direction: 'flat' };
  const isCurrent = daysBetween(delta.latestDay, today) <= freshnessDays;
  const period =
    isCurrent && delta.spanDays <= 8 ? 'this week' : `since ${formatDayKey(delta.baselineDay)}`;
  const directionOf = (n: number): ValueDeltaChip['direction'] =>
    n > 0 ? 'up' : n < 0 ? 'down' : 'flat';

  const collection = delta.market === null ? 0 : Math.round(delta.amount - delta.market);
  if (delta.market !== null && collection !== 0) {
    const market = Math.round(delta.market);
    return {
      text:
        market === 0 ? `Prices steady ${period}` : `${signedDollars(market)} from prices ${period}`,
      direction: directionOf(market),
      changes: `${signedDollars(collection)} from cards ${collection > 0 ? 'added' : 'removed'}`,
    };
  }

  const amount = Math.round(delta.amount);
  return {
    text: amount === 0 ? `Steady ${period}` : `${signedDollars(amount)} ${period}`,
    direction: directionOf(amount),
  };
}
