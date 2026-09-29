import { describe, it, expect } from 'vitest';
import { buildCommanderKey } from './commander-key';

// Mirrors backend/src/aggregates/commander-key.test.ts 1:1 — this frontend
// port must stay in sync with that file's algorithm.
describe('buildCommanderKey', () => {
  it('is order-independent for a partner pair (A+B === B+A)', () => {
    expect(buildCommanderKey('oracle-a', 'oracle-b')).toBe(
      buildCommanderKey('oracle-b', 'oracle-a')
    );
  });

  it('builds a single-commander key when there is no partner', () => {
    expect(buildCommanderKey('oracle-solo')).toBe('oracle-solo');
  });

  it('excludes a missing partner oracle id (undefined or null)', () => {
    expect(buildCommanderKey('oracle-a', undefined)).toBe('oracle-a');
    expect(buildCommanderKey('oracle-a', null)).toBe('oracle-a');
  });

  it('excludes an empty-string partner oracle id', () => {
    expect(buildCommanderKey('oracle-a', '')).toBe('oracle-a');
  });

  it('excludes a missing commander oracle id defensively', () => {
    expect(buildCommanderKey(undefined, 'oracle-b')).toBe('oracle-b');
    expect(buildCommanderKey()).toBe('');
  });
});
