import { describe, expect, it } from 'vitest';
import { readSpeed, TURN_EXPECTATIONS } from '@spellcontrol/deck-metrics';
import { pregameShareText, pregameSpeed } from './pregame-card';

const clock = (by5: number, runs = 1000) => ({
  runs,
  assembledBy: [0, 0, 0, 0, 0, by5, 0.5, 0.6, 0.7, 0.8],
});

describe('pregameSpeed', () => {
  it('names the share, the turn and the Wizards band', () => {
    expect(pregameSpeed(readSpeed(clock(0.22), 3)!)).toEqual({
      value: '22% of games',
      when: 'before turn 6',
      band: 'Bracket 3 expects turn 6 or later',
      sample: '1,000 simulated games',
    });
  });

  it('quotes every bracket band from the package, not a copy', () => {
    for (const b of [1, 2, 3, 4] as const) {
      const s = pregameSpeed(readSpeed(clock(0.3), b)!);
      expect(s.band).toBe(`Bracket ${b} expects turn ${TURN_EXPECTATIONS[b]} or later`);
      expect(s.when).toBe(`before turn ${TURN_EXPECTATIONS[b]}`);
    }
  });

  it('reads Bracket 5 against turn 4 and says it sets no expectation', () => {
    const s = pregameSpeed(
      readSpeed({ runs: 1000, assembledBy: [0, 0, 0.05, 0.12, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9] }, 5)!
    );
    expect(s.when).toBe('before turn 4');
    expect(s.band).toBe('Bracket 5 sets no turn expectation');
  });

  it('puts the ends in words', () => {
    expect(pregameSpeed(readSpeed(clock(0), 3)!).value).toBe('none of 1,000 games');
    expect(pregameSpeed(readSpeed(clock(1, 2000), 3)!).value).toBe('all 2,000 games');
    expect(pregameSpeed(readSpeed(clock(0.002), 3)!).value).toBe('under 1% of games');
  });
});

describe('pregameShareText', () => {
  const base = {
    deckName: 'Kinnan Tempo',
    bracketText: 'Bracket 3',
    gameChangers: 2,
    speed: readSpeed(clock(0.22), 3),
    url: 'https://spellcontrol.com/d/abc',
  };

  it('puts bracket, Game Changers, speed and the link on one line', () => {
    expect(pregameShareText(base)).toBe(
      'Kinnan Tempo: Bracket 3, 2 Game Changers, Win path before turn 6 in 22% of games. https://spellcontrol.com/d/abc'
    );
  });

  it('leaves out what the deck has no number for', () => {
    expect(pregameShareText({ ...base, gameChangers: null, speed: null })).toBe(
      'Kinnan Tempo: Bracket 3. https://spellcontrol.com/d/abc'
    );
  });

  it('keeps zero Game Changers, which is a fact and not an absence', () => {
    expect(pregameShareText({ ...base, gameChangers: 0, speed: null })).toContain(
      '0 Game Changers'
    );
  });
});
