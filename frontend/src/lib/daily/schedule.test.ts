import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  loadSchedule,
  msUntilNextPuzzle,
  puzzleFor,
  resetScheduleCache,
  todayUtc,
  type DailyPuzzle,
  type DailySchedule,
} from './schedule';

function puzzle(date: string, number: number, name: string): DailyPuzzle {
  return {
    date,
    number,
    name,
    colors: 'W',
    mv: 1,
    typeLine: 'Instant',
    rarity: 'uncommon',
    year: 1993,
    setName: 'Alpha',
    rulesText: 'Exile target creature.',
    flavor: '',
    art: 'https://img/a.jpg',
  };
}

const schedule: DailySchedule = {
  version: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  epoch: '2026-10-01',
  puzzles: [
    puzzle('2026-10-01', 1, 'A'),
    puzzle('2026-10-02', 2, 'B'),
    puzzle('2026-10-03', 3, 'C'),
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetScheduleCache();
});

describe('todayUtc / msUntilNextPuzzle', () => {
  it('uses the UTC day, and counts down to UTC midnight', () => {
    const t = Date.parse('2026-10-02T23:30:00Z');
    expect(todayUtc(t)).toBe('2026-10-02');
    expect(msUntilNextPuzzle(t)).toBe(30 * 60 * 1000);
  });
});

describe('puzzleFor', () => {
  it('returns the scheduled day', () => {
    expect(puzzleFor(schedule, '2026-10-02')?.name).toBe('B');
  });

  it('cycles past the end of a stale schedule, keeping the day number', () => {
    // 2026-10-05 is 4 days past the first entry; 4 mod 3 wraps to the second.
    const p = puzzleFor(schedule, '2026-10-05');
    expect(p).toMatchObject({ name: 'B', date: '2026-10-05', number: 5 });
  });

  it('has nothing before the schedule starts or for an empty one', () => {
    expect(puzzleFor(schedule, '2026-09-30')).toBeNull();
    expect(puzzleFor({ ...schedule, puzzles: [] }, '2026-10-01')).toBeNull();
  });
});

describe('loadSchedule', () => {
  it('fetches once and memoises', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(schedule)));
    vi.stubGlobal('fetch', fetchMock);
    await loadSchedule();
    await loadSchedule();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed fetch so a retry refetches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(schedule)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadSchedule()).rejects.toThrow("Couldn't load today's card.");
    await expect(loadSchedule()).resolves.toMatchObject({ epoch: '2026-10-01' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
