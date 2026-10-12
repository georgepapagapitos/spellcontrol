import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  clearAnalysisCache,
  pruneAnalysisCache,
  readCachedAnalysis,
  writeCachedAnalysis,
} from './deck-analysis-cache';

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

  it('prune drops decks that no longer exist and keeps live ones', async () => {
    writeCachedAnalysis('live-1', { gradeBracketSignature: 'a' });
    writeCachedAnalysis('gone-1', { gradeBracketSignature: 'b' });
    writeCachedAnalysis('gone-2', { gradeBracketSignature: 'c' });
    await vi.waitFor(async () => expect(await readCachedAnalysis('gone-2')).not.toBeNull());
    await vi.waitFor(async () => expect(await readCachedAnalysis('live-1')).not.toBeNull());

    const dropped = await pruneAnalysisCache(['live-1']);

    expect(dropped).toBeGreaterThanOrEqual(2);
    expect(await readCachedAnalysis('live-1')).not.toBeNull();
    expect(await readCachedAnalysis('gone-1')).toBeNull();
    expect(await readCachedAnalysis('gone-2')).toBeNull();
  });

  it('clear drops every deck', async () => {
    writeCachedAnalysis('deck-d', { gradeBracketSignature: 'd' });
    await vi.waitFor(async () => expect(await readCachedAnalysis('deck-d')).not.toBeNull());
    await clearAnalysisCache();
    expect(await readCachedAnalysis('deck-d')).toBeNull();
  });
});
