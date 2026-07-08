import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearValueHistory,
  computeValueDelta,
  dayKey,
  formatDayKey,
  getValueHistory,
  recordValueSnapshot,
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
  it('records a point keyed by its local day', async () => {
    await recordValueSnapshot(120.5, atDay(0));
    expect(await getValueHistory()).toEqual([
      { day: dayKey(atDay(0)), value: 120.5, at: atDay(0) },
    ]);
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
