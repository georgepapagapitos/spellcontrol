import { beforeEach, describe, it, expect } from 'vitest';
import { useDailyStore } from './daily';

const s = () => useDailyStore.getState();

beforeEach(() => {
  useDailyStore.setState({ guesses: {}, results: [], unposted: [] });
});

describe('addGuess', () => {
  it('appends in order, ignoring repeats', () => {
    s().addGuess('2026-10-03', 'Lightning Bolt');
    s().addGuess('2026-10-03', 'Path to Exile');
    s().addGuess('2026-10-03', 'Lightning Bolt');
    expect(s().guesses['2026-10-03']).toEqual(['Lightning Bolt', 'Path to Exile']);
  });

  it('stops at six guesses and after the day is finished', () => {
    for (let i = 0; i < 8; i++) s().addGuess('2026-10-03', `Card ${i}`);
    expect(s().guesses['2026-10-03']).toHaveLength(6);
    s().finish('2026-10-04', { solved: true, guesses: 1 });
    s().addGuess('2026-10-04', 'Late');
    expect(s().guesses['2026-10-04']).toBeUndefined();
  });

  it('drops guess lists older than two weeks', () => {
    s().addGuess('2026-09-01', 'Old');
    s().addGuess('2026-10-03', 'New');
    expect(Object.keys(s().guesses)).toEqual(['2026-10-03']);
  });
});

describe('finish', () => {
  it('records one result per day and queues it for the server', () => {
    s().finish('2026-10-03', { solved: true, guesses: 3 });
    s().finish('2026-10-03', { solved: false, guesses: 6 });
    expect(s().results).toEqual([{ date: '2026-10-03', solved: true, guesses: 3 }]);
    expect(s().unposted).toEqual(['2026-10-03']);
  });
});

describe('finish without queueing', () => {
  it("records the day but doesn't queue it when the server already has it", () => {
    s().finish('2026-10-03', { solved: true, guesses: 2 }, { queue: false });
    expect(s().results).toEqual([{ date: '2026-10-03', solved: true, guesses: 2 }]);
    expect(s().unposted).toEqual([]);
  });
});

describe('adoptServerResults / markPosted', () => {
  it("lets the server's result win for a day both have, keeping local-only days", () => {
    s().finish('2026-10-03', { solved: true, guesses: 2 });
    s().finish('2026-10-02', { solved: true, guesses: 4 });
    s().adoptServerResults([{ date: '2026-10-03', solved: true, guesses: 5 }]);
    expect(s().results).toEqual([
      { date: '2026-10-03', solved: true, guesses: 5 },
      { date: '2026-10-02', solved: true, guesses: 4 },
    ]);
  });

  it('clears posted dates from the queue', () => {
    s().finish('2026-10-03', { solved: true, guesses: 2 });
    s().finish('2026-10-02', { solved: true, guesses: 4 });
    s().markPosted(['2026-10-03']);
    expect(s().unposted).toEqual(['2026-10-02']);
  });
});
