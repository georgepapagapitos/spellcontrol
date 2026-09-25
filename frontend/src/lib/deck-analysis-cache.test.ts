import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { clearAnalysisCache, readCachedAnalysis, writeCachedAnalysis } from './deck-analysis-cache';

describe('deck-analysis-cache', () => {
  it('reads back what was written, per deck', async () => {
    const analysis = { gradeBracketSignature: 'sig-a', bracketEstimation: { bracket: 4 } };
    writeCachedAnalysis('deck-a', analysis as never);
    await vi.waitFor(async () => expect(await readCachedAnalysis('deck-a')).toEqual(analysis));
    expect(await readCachedAnalysis('deck-b')).toBeNull();
  });

  it('a later write replaces the earlier one', async () => {
    writeCachedAnalysis('deck-c', { gradeBracketSignature: 'one' });
    writeCachedAnalysis('deck-c', { gradeBracketSignature: 'two' });
    await vi.waitFor(async () =>
      expect((await readCachedAnalysis('deck-c'))?.gradeBracketSignature).toBe('two')
    );
  });

  it('clear drops every deck', async () => {
    writeCachedAnalysis('deck-d', { gradeBracketSignature: 'd' });
    await vi.waitFor(async () => expect(await readCachedAnalysis('deck-d')).not.toBeNull());
    await clearAnalysisCache();
    expect(await readCachedAnalysis('deck-d')).toBeNull();
  });
});
