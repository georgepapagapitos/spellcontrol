import { describe, it, expect } from 'vitest';
import { pickWelcomeHeroCard, EVERGREEN_COMMANDERS } from './welcome-hero';

const DAY_A = '2026-07-20';
const DAY_B = '2026-07-21';

describe('pickWelcomeHeroCard', () => {
  it('always returns a name from the evergreen pool', () => {
    expect(EVERGREEN_COMMANDERS).toContain(pickWelcomeHeroCard(DAY_A));
  });

  it('is deterministic for a fixed day', () => {
    expect(pickWelcomeHeroCard(DAY_A)).toBe(pickWelcomeHeroCard(DAY_A));
  });

  it('rotates daily rather than pinning to the same card forever', () => {
    // Adjacent days land on adjacent pool slots (epoch-day % pool.length),
    // so they are expected to differ here specifically — same reasoning as
    // home-hero.test.ts's identical assertion.
    expect(pickWelcomeHeroCard(DAY_A)).not.toBe(pickWelcomeHeroCard(DAY_B));
  });

  it('exercises the full pool across consecutive days', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const day = `2026-08-${String((i % 28) + 1).padStart(2, '0')}`;
      seen.add(pickWelcomeHeroCard(day));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const name of seen) expect(EVERGREEN_COMMANDERS).toContain(name);
  });

  it('defaults to today when no day is passed', () => {
    expect(() => pickWelcomeHeroCard()).not.toThrow();
    expect(EVERGREEN_COMMANDERS).toContain(pickWelcomeHeroCard());
  });
});
