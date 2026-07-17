import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { useCurrencyStore } from './currency';
import {
  clearMovers,
  clearValueHistory,
  computeMovers,
  computeValueDelta,
  dayKey,
  formatDayKey,
  getLatestMovers,
  getValueHistory,
  recordDailyMovers,
  recordValueSnapshot,
  type CardMover,
  type ValuePoint,
} from './value-history';

// Local noon on a fixed calendar day — TZ-safe (local noon always falls on
// that local date), and deterministic: every timestamp is injected.
const atDay = (offset: number) => new Date(2026, 0, 1 + offset, 12, 0, 0).getTime();

const point = (dayOffset: number, value: number): ValuePoint => ({
  day: dayKey(atDay(dayOffset)),
  value,
  at: atDay(dayOffset),
});

afterEach(async () => {
  await clearValueHistory();
  await clearMovers();
});

/** Minimal priced-card fixture for computeMovers. */
const card = (scryfallId: string, price: number, finish = 'nonfoil', name = scryfallId) => ({
  scryfallId,
  finish,
  purchasePrice: price,
  name,
  setCode: 'cmr',
});

const mover = (overrides: Partial<CardMover>): CardMover => ({
  scryfallId: 'a',
  finish: 'nonfoil',
  name: 'a',
  setCode: 'cmr',
  before: 1,
  after: 2,
  copies: 1,
  ...overrides,
});

describe('dayKey', () => {
  it('formats a local-calendar day with zero padding', () => {
    expect(dayKey(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 10, 23, 12).getTime())).toBe('2026-11-23');
  });
});

describe('formatDayKey', () => {
  it('renders a short human date', () => {
    expect(formatDayKey('2026-06-30')).toBe('Jun 30');
  });
});

describe('recordValueSnapshot / getValueHistory', () => {
  it('records a point keyed by its local day, stamped with the active currency', async () => {
    await recordValueSnapshot(120.5, atDay(0));
    expect(await getValueHistory()).toEqual([
      { day: dayKey(atDay(0)), value: 120.5, at: atDay(0), currency: 'USD' },
    ]);
  });

  it('filters points to the active currency — a $ trend and a € trend never mix', async () => {
    await recordValueSnapshot(100, atDay(0)); // USD point
    useCurrencyStore.getState().setCurrency('EUR');
    try {
      await recordValueSnapshot(85, atDay(1)); // EUR point
      expect((await getValueHistory()).map((p) => p.value)).toEqual([85]);
      // Switching back restores the USD trend (points are kept, not dropped) —
      // an untagged pre-feature point counts as USD.
      useCurrencyStore.getState().setCurrency('USD');
      expect((await getValueHistory()).map((p) => p.value)).toEqual([100]);
    } finally {
      useCurrencyStore.getState().setCurrency('USD');
    }
  });

  it('upserts within a day — the last snapshot of the day wins', async () => {
    await recordValueSnapshot(100, atDay(0));
    await recordValueSnapshot(105, atDay(0) + 3600000);
    const points = await getValueHistory();
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(105);
  });

  it('returns multi-day history oldest → newest', async () => {
    await recordValueSnapshot(300, atDay(2));
    await recordValueSnapshot(100, atDay(0));
    await recordValueSnapshot(200, atDay(1));
    expect((await getValueHistory()).map((p) => p.value)).toEqual([100, 200, 300]);
  });

  it('trims the log to the newest 90 points', async () => {
    for (let i = 0; i < 95; i++) await recordValueSnapshot(i, atDay(i));
    const points = await getValueHistory();
    expect(points).toHaveLength(90);
    expect(points[0].day).toBe(dayKey(atDay(5)));
    expect(points[89].day).toBe(dayKey(atDay(94)));
  });
});

describe('computeMovers', () => {
  it('captures per-copy moves of at least $0.25, either direction', () => {
    const before = [card('up', 5), card('down', 10), card('wobble', 2)];
    const after = [card('up', 6.5), card('down', 8), card('wobble', 2.1)];
    expect(computeMovers(before, after)).toEqual([
      mover({ scryfallId: 'down', name: 'down', before: 10, after: 8 }),
      mover({ scryfallId: 'up', name: 'up', before: 5, after: 6.5 }),
    ]);
  });

  it('ignores first-time pricing (0 → x) and unpriced cards (x → 0)', () => {
    const before = [card('new', 0), card('gone', 4)];
    const after = [card('new', 12), card('gone', 0)];
    expect(computeMovers(before, after)).toEqual([]);
  });

  it('aggregates copies of the same printing+finish and keys finishes apart', () => {
    const before = [card('a', 5), card('a', 5), card('a', 20, 'foil')];
    const after = [card('a', 6), card('a', 6), card('a', 26, 'foil')];
    const movers = computeMovers(before, after);
    // Foil impact $6 > nonfoil impact $2 (2 copies × $1).
    expect(movers).toEqual([
      mover({ scryfallId: 'a', name: 'a', finish: 'foil', before: 20, after: 26 }),
      mover({ scryfallId: 'a', name: 'a', before: 5, after: 6, copies: 2 }),
    ]);
  });

  it('sorts by total impact (delta × copies) and caps the list at 20', () => {
    const before = Array.from({ length: 25 }, (_, i) => card(`c${i}`, 10));
    const after = Array.from({ length: 25 }, (_, i) => card(`c${i}`, 10 + (i + 1) * 0.5));
    const movers = computeMovers(before, after);
    expect(movers).toHaveLength(20);
    expect(movers[0].scryfallId).toBe('c24');
  });
});

describe('recordDailyMovers / getLatestMovers', () => {
  it('records movers stamped with day and currency; empty diffs write nothing', async () => {
    await recordDailyMovers([], atDay(0));
    expect(await getLatestMovers()).toBeNull();
    await recordDailyMovers([mover({})], atDay(0));
    expect(await getLatestMovers()).toEqual({
      day: dayKey(atDay(0)),
      at: atDay(0),
      currency: 'USD',
      movers: [mover({})],
    });
  });

  it('merges a same-day re-refresh per key — earliest before, latest after', async () => {
    await recordDailyMovers([mover({ before: 5, after: 6 })], atDay(0));
    await recordDailyMovers(
      [mover({ before: 6, after: 7 }), mover({ scryfallId: 'b', name: 'b', before: 2, after: 3 })],
      atDay(0) + 3600000
    );
    const rec = await getLatestMovers();
    expect(rec?.movers).toEqual([
      mover({ before: 5, after: 7 }),
      mover({ scryfallId: 'b', name: 'b', before: 2, after: 3 }),
    ]);
  });

  it('keeps the existing record when a same-day merge cancels out to nothing', async () => {
    await recordDailyMovers([mover({ before: 5, after: 6 })], atDay(0));
    // The move reverts: merged before=5, after=5 → under the floor → the
    // original record survives instead of being replaced by an empty one.
    await recordDailyMovers([mover({ before: 6, after: 5 })], atDay(0) + 3600000);
    expect((await getLatestMovers())?.movers).toEqual([mover({ before: 5, after: 6 })]);
  });

  it('returns the newest record in the active currency only', async () => {
    await recordDailyMovers([mover({})], atDay(0));
    await recordDailyMovers([mover({ before: 3, after: 4 })], atDay(1));
    expect((await getLatestMovers())?.day).toBe(dayKey(atDay(1)));

    useCurrencyStore.getState().setCurrency('EUR');
    try {
      expect(await getLatestMovers()).toBeNull();
      await recordDailyMovers([mover({ scryfallId: 'e', name: 'e' })], atDay(2));
      expect((await getLatestMovers())?.currency).toBe('EUR');
    } finally {
      useCurrencyStore.getState().setCurrency('USD');
    }
    expect((await getLatestMovers())?.day).toBe(dayKey(atDay(1)));
  });

  it('trims the movers log to the newest 7 days', async () => {
    for (let i = 0; i < 10; i++) await recordDailyMovers([mover({})], atDay(i));
    await recordDailyMovers([mover({})], atDay(0)); // too old — evicted slot stays evicted
    const rec = await getLatestMovers();
    expect(rec?.day).toBe(dayKey(atDay(9)));
  });
});

describe('computeValueDelta', () => {
  it('is null with fewer than two points', () => {
    expect(computeValueDelta([])).toBeNull();
    expect(computeValueDelta([point(0, 100)])).toBeNull();
  });

  it('measures from the most recent point at least 7 days before the latest', () => {
    const points = Array.from({ length: 11 }, (_, i) => point(i, 100 + i * 10));
    // Latest = day 10 (value 200); baseline = day 3 (value 130), the newest
    // point ≥7 days older.
    expect(computeValueDelta(points)).toEqual({
      amount: 70,
      baselineDay: dayKey(atDay(3)),
      latestDay: dayKey(atDay(10)),
      spanDays: 7,
    });
  });

  it('falls back to the oldest point when history is younger than a week', () => {
    const points = [point(0, 100), point(1, 110), point(3, 90)];
    expect(computeValueDelta(points)).toEqual({
      amount: -10,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(3)),
      spanDays: 3,
    });
  });

  it('spans a gap honestly — baseline can be much older than a week', () => {
    const points = [point(0, 100), point(30, 160)];
    expect(computeValueDelta(points)).toEqual({
      amount: 60,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(30)),
      spanDays: 30,
    });
  });
});
