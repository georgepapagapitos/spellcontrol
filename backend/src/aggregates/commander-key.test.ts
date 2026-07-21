import { describe, it, expect } from 'vitest';
import { buildCommanderKey } from './commander-key';

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
});
