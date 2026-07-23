import { describe, expect, it } from 'vitest';
import { shouldCelebrateFirstPublish } from './first-publish-celebration';

// Every case uses its own deckId — the guard is a module-level Set shared
// across the whole test run, so reusing an id would leak state between cases.

describe('shouldCelebrateFirstPublish', () => {
  it('celebrates a genuine first publish', () => {
    expect(shouldCelebrateFirstPublish('deck-a', true)).toBe(true);
  });

  it('never celebrates a republish (isFirstPublish: false), even for a fresh deckId', () => {
    expect(shouldCelebrateFirstPublish('deck-b', false)).toBe(false);
  });

  it('does not celebrate the same deck twice, even across two genuine-first-publish reports', () => {
    expect(shouldCelebrateFirstPublish('deck-c', true)).toBe(true);
    expect(shouldCelebrateFirstPublish('deck-c', true)).toBe(false);
  });

  it('a later republish of an already-celebrated deck still reads false', () => {
    expect(shouldCelebrateFirstPublish('deck-d', true)).toBe(true);
    expect(shouldCelebrateFirstPublish('deck-d', false)).toBe(false);
  });

  it('celebrates each distinct deck independently', () => {
    expect(shouldCelebrateFirstPublish('deck-e', true)).toBe(true);
    expect(shouldCelebrateFirstPublish('deck-f', true)).toBe(true);
  });
});
