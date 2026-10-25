import { describe, expect, it } from 'vitest';
import { readSpeed } from '@spellcontrol/deck-metrics';
import { bracketSpeedLine } from './bracket-speed-line';

const clock = (by5: number, runs = 1000) => ({
  runs,
  assembledBy: [0, 0, 0, 0, 0, by5, 0.5, 0.6, 0.7, 0.8],
});

describe('bracketSpeedLine', () => {
  it('names the share, the sample and the bracket expectation', () => {
    expect(bracketSpeedLine(readSpeed(clock(0.22), 3)!)).toBe(
      'Comes together before turn 6 in 22% of games (1,000 simulated); Bracket 3 expects turn 6 or later.'
    );
  });

  it('reads each bracket against its own turn', () => {
    expect(bracketSpeedLine(readSpeed(clock(0.3), 2)!)).toContain('before turn 8');
    expect(bracketSpeedLine(readSpeed(clock(0.3), 1)!)).toContain('Bracket 1 expects turn 9');
  });

  it('says Bracket 5 sets no expectation and reads against turn 4', () => {
    const r = readSpeed(
      { runs: 1000, assembledBy: [0, 0, 0.05, 0.12, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9] },
      5
    )!;
    expect(bracketSpeedLine(r)).toBe(
      'Comes together before turn 4 in 12% of games (1,000 simulated); Bracket 5 sets no turn expectation.'
    );
  });

  it('puts the ends in words', () => {
    expect(bracketSpeedLine(readSpeed(clock(0), 3)!)).toContain('in none of 1,000 simulated games');
    expect(bracketSpeedLine(readSpeed(clock(1, 2000), 3)!)).toContain(
      'in every one of 2,000 simulated games'
    );
    expect(bracketSpeedLine(readSpeed(clock(0.002), 3)!)).toContain('under 1% of games');
  });
});
