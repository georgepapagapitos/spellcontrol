import { describe, it, expect } from 'vitest';
import { parseMarkAllAsProxies } from './import-proxy-flag';

describe('parseMarkAllAsProxies', () => {
  it('accepts the JSON boolean true', () => {
    expect(parseMarkAllAsProxies({ proxy: true })).toBe(true);
  });

  it("accepts multer's stringified 'true' from a multipart field", () => {
    expect(parseMarkAllAsProxies({ proxy: 'true' })).toBe(true);
  });

  it('rejects everything else (trust boundary — no truthy coercion)', () => {
    expect(parseMarkAllAsProxies({ proxy: false })).toBe(false);
    expect(parseMarkAllAsProxies({ proxy: 'false' })).toBe(false);
    expect(parseMarkAllAsProxies({ proxy: 1 })).toBe(false);
    expect(parseMarkAllAsProxies({ proxy: '1' })).toBe(false);
    expect(parseMarkAllAsProxies({ proxy: 'yes' })).toBe(false);
    expect(parseMarkAllAsProxies({ proxy: null })).toBe(false);
    expect(parseMarkAllAsProxies({})).toBe(false);
    expect(parseMarkAllAsProxies(undefined)).toBe(false);
    expect(parseMarkAllAsProxies(null)).toBe(false);
  });
});
