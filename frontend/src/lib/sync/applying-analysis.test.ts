import { describe, it, expect, afterEach } from 'vitest';
import { isApplyingAnalysis, setApplyingAnalysis } from './applying-analysis';

describe('applying-analysis flag', () => {
  afterEach(() => {
    // Always reset to false so tests don't bleed into each other.
    setApplyingAnalysis(false);
  });

  it('is false by default', () => {
    expect(isApplyingAnalysis()).toBe(false);
  });

  it('setApplyingAnalysis(true) makes isApplyingAnalysis() return true', () => {
    setApplyingAnalysis(true);
    expect(isApplyingAnalysis()).toBe(true);
  });

  it('setApplyingAnalysis(false) resets the flag', () => {
    setApplyingAnalysis(true);
    setApplyingAnalysis(false);
    expect(isApplyingAnalysis()).toBe(false);
  });
});
