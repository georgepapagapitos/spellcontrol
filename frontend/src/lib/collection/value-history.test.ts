import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { useCurrencyStore } from './currency';
import {
  clearMovers,
  clearValueHistory,
  computeMarketMove,
  computeMovers,
  computeValueDelta,
  dayKey,
  formatDayKey,
  formatValueDeltaChip,
  getLatestMovers,
  getValueHistory,
  onValueHistoryChange,
  recordDailyMovers,
  recordCollectionSnapshot,
  recordValueSnapshot,
  type CardMover,
  type ValueDelta,
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
      { day: dayKey(atDay(0)), value: 120.5, at: atDay(0), currency: 'USD', market: 0 },
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

describe('recordCollectionSnapshot', () => {
  it('logs $0 so an emptied collection stops reporting its old total', async () => {
    await recordValueSnapshot(420, atDay(0));
    await recordCollectionSnapshot(0, atDay(1));
    // The deleted collection's history is gone from every surface; no $0 hero.
    expect(await getValueHistory()).toEqual([]);
  });

  it('does nothing when the log is empty — a user who never imported keeps no trend', async () => {
    await recordCollectionSnapshot(0, atDay(0));
    expect(await getValueHistory()).toEqual([]);
  });

  it('overwrites the same day, so deleting the collection empties the trend at once', async () => {
    await recordValueSnapshot(420, atDay(0));
    await recordCollectionSnapshot(0, atDay(0));
    expect(await getValueHistory()).toEqual([]);
  });

  it('re-values the same day when the cards come back, no price refresh needed', async () => {
    await recordValueSnapshot(420, atDay(0));
    await recordCollectionSnapshot(0, atDay(0));
    await recordCollectionSnapshot(360, atDay(0));
    expect((await getValueHistory()).map((p) => p.value)).toEqual([360]);
  });
});

describe('a full delete resets the trend', () => {
  it('starts a re-import on a later day as a fresh trend, not old history and a cliff', async () => {
    await recordValueSnapshot(5000, atDay(0));
    await recordValueSnapshot(5100, atDay(1));
    await recordCollectionSnapshot(0, atDay(2)); // deleted
    await recordCollectionSnapshot(0, atDay(3)); // boot catch-all while still empty
    await recordValueSnapshot(800, atDay(5)); // a different collection, priced
    await recordValueSnapshot(820, atDay(6));
    const points = await getValueHistory();
    expect(points.map((p) => p.value)).toEqual([800, 820]);
    // The headline measures the new collection only: no "+$800 from cards added".
    expect(computeValueDelta(points)?.amount).toBe(20);
  });

  it('brings the whole history back when the delete is undone the same day', async () => {
    await recordValueSnapshot(5000, atDay(0));
    await recordValueSnapshot(5100, atDay(1));
    await recordCollectionSnapshot(0, atDay(1)); // deleted
    expect(await getValueHistory()).toEqual([]);
    await recordCollectionSnapshot(5100, atDay(1)); // undo restores the cards
    expect((await getValueHistory()).map((p) => p.value)).toEqual([5000, 5100]);
  });

  it('hides movers that name the deleted cards, and shows them again on undo', async () => {
    const mover: CardMover = {
      scryfallId: 'a',
      finish: 'nonfoil',
      name: 'A',
      setCode: 'lea',
      before: 1,
      after: 3,
      copies: 1,
    };
    await recordValueSnapshot(5000, atDay(0));
    await recordDailyMovers([mover], atDay(0));
    await recordCollectionSnapshot(0, atDay(0) + 1000);
    expect(await getLatestMovers()).toBeNull();
    await recordCollectionSnapshot(5000, atDay(0) + 2000);
    expect((await getLatestMovers())?.movers).toEqual([mover]);
  });

  it('keeps movers logged after the reset', async () => {
    await recordValueSnapshot(5000, atDay(0));
    await recordCollectionSnapshot(0, atDay(1));
    await recordValueSnapshot(800, atDay(2));
    await recordDailyMovers(
      [
        {
          scryfallId: 'b',
          finish: 'nonfoil',
          name: 'B',
          setCode: 'm21',
          before: 1,
          after: 2,
          copies: 1,
        },
      ],
      atDay(2)
    );
    expect((await getLatestMovers())?.day).toBe(dayKey(atDay(2)));
  });
});

describe('clearValueHistory / clearMovers', () => {
  it('notify, so a mounted hero or chart drops the cleared log at once', async () => {
    await recordValueSnapshot(420, atDay(0));
    let calls = 0;
    const off = onValueHistoryChange(() => calls++);
    await clearValueHistory();
    await clearMovers();
    off();
    expect(calls).toBe(2);
    expect(await getValueHistory()).toEqual([]);
  });
});

describe('onValueHistoryChange', () => {
  it('fires on every write to either store, so a mounted surface can re-read', async () => {
    const seen: string[] = [];
    const off = onValueHistoryChange(() => seen.push('tick'));
    try {
      await recordValueSnapshot(100, atDay(0));
      await recordDailyMovers([mover({ before: 1, after: 4 })], atDay(0));
      expect(seen).toHaveLength(2);
    } finally {
      off();
    }
    // Unsubscribed listeners stop hearing about it.
    await recordValueSnapshot(200, atDay(1));
    expect(seen).toHaveLength(2);
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
      market: null,
    });
  });

  it('falls back to the oldest point when history is younger than a week', () => {
    const points = [point(0, 100), point(1, 110), point(3, 90)];
    expect(computeValueDelta(points)).toEqual({
      amount: -10,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(3)),
      spanDays: 3,
      market: null,
    });
  });

  it('spans a gap honestly — baseline can be much older than a week', () => {
    const points = [point(0, 100), point(30, 160)];
    expect(computeValueDelta(points)).toEqual({
      amount: 60,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(30)),
      spanDays: 30,
      market: null,
    });
  });

  it('sums the market moves logged after the baseline, not the baseline itself', () => {
    const points: ValuePoint[] = [
      { ...point(0, 100), market: 40 },
      { ...point(2, 110), market: 10 },
      { ...point(4, 1110), market: 0 },
      { ...point(5, 1105), market: -5 },
    ];
    expect(computeValueDelta(points)?.market).toBe(5);
  });

  it('is null on market when a point after the baseline predates the split', () => {
    const points: ValuePoint[] = [point(0, 100), point(2, 110), { ...point(4, 120), market: 10 }];
    expect(computeValueDelta(points)?.market).toBeNull();
  });

  it('accepts a baseline that predates the split, since its market is never read', () => {
    const points: ValuePoint[] = [point(0, 100), { ...point(3, 130), market: 30 }];
    expect(computeValueDelta(points)?.market).toBe(30);
  });
});

describe('computeMarketMove', () => {
  it('sums every copy priced on both sides, with no display threshold', () => {
    const before = [card('a', 10), card('a', 10), card('b', 1), card('c', 5, 'foil')];
    const after = [card('a', 12), card('a', 12), card('b', 1.1), card('c', 4, 'foil')];
    // a: +2 × 2 copies, b: +0.10 (under the movers threshold, still real), c: −1.
    expect(computeMarketMove(before, after)).toBe(3.1);
  });

  it('leaves out first pricings and cards that lost their price', () => {
    expect(computeMarketMove([card('a', 0), card('b', 3)], [card('a', 9), card('b', 0)])).toBe(0);
  });
});

describe('formatValueDeltaChip', () => {
  it('returns empty text and a flat direction for a null delta', () => {
    expect(formatValueDeltaChip(null, dayKey(atDay(0)))).toEqual({ text: '', direction: 'flat' });
  });

  it('says "this week" for a current, short-span positive delta', () => {
    const delta: ValueDelta = {
      amount: 30,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(7)),
      spanDays: 7,
      market: null,
    };
    expect(formatValueDeltaChip(delta, dayKey(atDay(7)))).toEqual({
      text: '+$30 this week',
      direction: 'up',
    });
  });

  it('names the baseline date instead of "this week" once the latest point is stale', () => {
    const delta: ValueDelta = {
      amount: -12,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(7)),
      spanDays: 7,
      market: null,
    };
    // "today" is 5 days after the latest point — past the freshness window.
    expect(formatValueDeltaChip(delta, dayKey(atDay(12)))).toEqual({
      text: `−$12 since ${formatDayKey(dayKey(atDay(0)))}`,
      direction: 'down',
    });
  });

  it('names the baseline date once the span is longer than about a week, even if current', () => {
    const delta: ValueDelta = {
      amount: 60,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(30)),
      spanDays: 30,
      market: null,
    };
    expect(formatValueDeltaChip(delta, dayKey(atDay(30)))).toEqual({
      text: `+$60 since ${formatDayKey(dayKey(atDay(0)))}`,
      direction: 'up',
    });
  });

  it('reads a zero delta as "Steady", never "+$0"', () => {
    const delta: ValueDelta = {
      amount: 0,
      baselineDay: dayKey(atDay(0)),
      latestDay: dayKey(atDay(7)),
      spanDays: 7,
      market: null,
    };
    expect(formatValueDeltaChip(delta, dayKey(atDay(7)))).toEqual({
      text: 'Steady this week',
      direction: 'flat',
    });
  });
});

describe('prices vs cards split', () => {
  const week = (market: number | null, amount: number): ValueDelta => ({
    amount,
    market,
    baselineDay: dayKey(atDay(0)),
    latestDay: dayKey(atDay(7)),
    spanDays: 7,
  });
  const today = dayKey(atDay(7));

  it('credits an import to cards, not to the market', () => {
    expect(formatValueDeltaChip(week(45, 1103), today)).toEqual({
      text: '+$45 from prices this week',
      direction: 'up',
      changes: '+$1,058 from cards added',
    });
  });

  it('says cards were removed when the collection shrank', () => {
    expect(formatValueDeltaChip(week(-12, -312), today)).toEqual({
      text: '−$12 from prices this week',
      direction: 'down',
      changes: '−$300 from cards removed',
    });
  });

  it('reads flat prices as a word even when cards moved the total', () => {
    expect(formatValueDeltaChip(week(0.3, 500), today)).toEqual({
      text: 'Prices steady this week',
      direction: 'flat',
      changes: '+$500 from cards added',
    });
  });

  it('keeps the single chip when the collection part rounds to nothing', () => {
    expect(formatValueDeltaChip(week(30.2, 30.4), today)).toEqual({
      text: '+$30 this week',
      direction: 'up',
    });
  });

  it('never guesses a split on a log that predates it', () => {
    expect(formatValueDeltaChip(week(null, 1103), today)).toEqual({
      text: '+$1,103 this week',
      direction: 'up',
    });
  });
});

describe('recordValueSnapshot market accumulation', () => {
  it('adds each refresh of the day into its market; a collection write adds nothing', async () => {
    await recordValueSnapshot(100, atDay(0), 3);
    await recordValueSnapshot(1100, atDay(0));
    await recordValueSnapshot(1098, atDay(0), -2);
    const [p] = await getValueHistory();
    expect(p.value).toBe(1098);
    expect(p.market).toBe(1);
  });

  it('starts the market over when the day was first written in the other currency', async () => {
    useCurrencyStore.setState({ currency: 'EUR' });
    try {
      await recordValueSnapshot(90, atDay(0), 7);
    } finally {
      useCurrencyStore.setState({ currency: 'USD' });
    }
    await recordValueSnapshot(100, atDay(0), 2);
    const [p] = await getValueHistory();
    expect(p.market).toBe(2);
  });

  // The guard for the defect this split fixes: a week with a small real price
  // move and a big import used to report the import as "+$1,103 this week".
  it('an import between two refreshes never reads as a price gain', async () => {
    await recordValueSnapshot(10_000, atDay(0), 0);
    await recordValueSnapshot(10_020, atDay(3), 20); // refresh: prices up $20
    await recordCollectionSnapshot(11_020, atDay(5)); // import: +$1,000 of cards
    await recordValueSnapshot(11_045, atDay(7), 25); // refresh: prices up $25
    const chip = formatValueDeltaChip(computeValueDelta(await getValueHistory()), dayKey(atDay(7)));
    expect(chip.text).toBe('+$45 from prices this week');
    expect(chip.changes).toBe('+$1,000 from cards added');
  });
});
