// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { hasEverVisited, markEverVisited } from './first-run';

beforeEach(() => {
  localStorage.clear();
});

describe('first-run flag', () => {
  it('reports false on a brand-new device', () => {
    expect(hasEverVisited()).toBe(false);
  });

  it('flips to true after markEverVisited', () => {
    markEverVisited();
    expect(hasEverVisited()).toBe(true);
  });

  it('is idempotent — calling mark twice still reads as visited', () => {
    markEverVisited();
    markEverVisited();
    expect(hasEverVisited()).toBe(true);
  });

  it('uses the documented localStorage key', () => {
    markEverVisited();
    expect(localStorage.getItem('sc-ever-visited-app')).toBe('1');
  });
});
