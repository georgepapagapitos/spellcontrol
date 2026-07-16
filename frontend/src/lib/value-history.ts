import { openDB, type IDBPDatabase } from 'idb';
import { getCurrency } from './currency';

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
}

const DB_NAME = 'spellcontrol-value-history';
const STORE = 'daily';
const MAX_POINTS = 90;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'day' });
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
 * Upsert today's point (last write per day wins) and trim the log to the
 * newest MAX_POINTS. Stamped with the active display currency. `at` is
 * injectable for tests.
 */
export async function recordValueSnapshot(value: number, at = Date.now()): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.put({ day: dayKey(at), value, at, currency: getCurrency() } satisfies ValuePoint);
  // Day keys are YYYY-MM-DD, so IDB's ascending key order IS chronological —
  // getAllKeys()[0..excess] are the oldest points.
  const keys = await tx.store.getAllKeys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_POINTS))) {
    await tx.store.delete(key);
  }
  await tx.done;
}

/** All points in the ACTIVE display currency, oldest → newest. Points logged
 *  under the other currency are kept in the DB (switching back restores that
 *  trend) but never surfaced into a mixed-currency series. */
export async function getValueHistory(): Promise<ValuePoint[]> {
  const db = await getDB();
  const active = getCurrency();
  return ((await db.getAll(STORE)) as ValuePoint[]).filter((p) => (p.currency ?? 'USD') === active);
}

export async function clearValueHistory(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
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
  let baseline = points[0];
  for (const p of points) {
    if (daysBetween(p.day, latest.day) >= 7) baseline = p;
    else break;
  }
  return {
    amount: latest.value - baseline.value,
    baselineDay: baseline.day,
    latestDay: latest.day,
    spanDays: daysBetween(baseline.day, latest.day),
  };
}
