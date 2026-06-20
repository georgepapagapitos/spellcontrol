// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { countUnseen, markInboxSeen, INBOX_LAST_SEEN_KEY } from './use-inbox';
import type { InboxShareRow } from './share-client';

function row(createdAt: number): InboxShareRow {
  return { token: `t${createdAt}`, kind: 'deck', fromUsername: 'alice', label: 'X', createdAt };
}

describe('countUnseen', () => {
  it('returns 0 for null items (not yet loaded)', () => {
    expect(countUnseen(null, 0)).toBe(0);
  });

  it('counts only items newer than the last-seen mark', () => {
    const items = [row(100), row(200), row(300)];
    expect(countUnseen(items, 0)).toBe(3);
    expect(countUnseen(items, 150)).toBe(2);
    expect(countUnseen(items, 300)).toBe(0);
  });
});

describe('markInboxSeen', () => {
  beforeEach(() => localStorage.clear());

  it('stamps a timestamp into localStorage under the shared key', () => {
    expect(localStorage.getItem(INBOX_LAST_SEEN_KEY)).toBeNull();
    markInboxSeen();
    const stored = Number(localStorage.getItem(INBOX_LAST_SEEN_KEY));
    expect(stored).toBeGreaterThan(0);
  });
});
