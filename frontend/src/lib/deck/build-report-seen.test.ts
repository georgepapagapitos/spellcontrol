// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markBuildReportSeen, isBuildReportSeen } from './build-report-seen';

describe('build-report-seen', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns false for an unseen deck', () => {
    expect(isBuildReportSeen('deck-abc')).toBe(false);
  });

  it('returns true after markBuildReportSeen is called', () => {
    markBuildReportSeen('deck-xyz');
    expect(isBuildReportSeen('deck-xyz')).toBe(true);
  });

  it('does not mark other decks as seen', () => {
    markBuildReportSeen('deck-1');
    expect(isBuildReportSeen('deck-2')).toBe(false);
  });

  it('is idempotent — calling mark twice does not break anything', () => {
    markBuildReportSeen('deck-1');
    markBuildReportSeen('deck-1');
    expect(isBuildReportSeen('deck-1')).toBe(true);
  });

  it('persists across calls (reads from localStorage each time)', () => {
    markBuildReportSeen('deck-persist');
    // Simulate another call site reading later.
    expect(isBuildReportSeen('deck-persist')).toBe(true);
  });

  it('survives corrupted localStorage without throwing', () => {
    localStorage.setItem('build-report-seen-ids', 'not-json-at-all!!');
    expect(() => isBuildReportSeen('deck-any')).not.toThrow();
    expect(isBuildReportSeen('deck-any')).toBe(false);
  });

  it('survives non-array JSON without throwing', () => {
    localStorage.setItem('build-report-seen-ids', '{"foo":1}');
    expect(() => isBuildReportSeen('deck-any')).not.toThrow();
    expect(isBuildReportSeen('deck-any')).toBe(false);
  });
});
