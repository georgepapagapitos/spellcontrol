// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWithoutBfcache } from './idb-open';

/** A Web Locks stand-in that records which locks are held right now. */
function installLocks() {
  const held = new Set<string>();
  const request = vi.fn(async (name: string, _opts: unknown, cb: () => Promise<unknown>) => {
    held.add(name);
    try {
      return await cb();
    } finally {
      held.delete(name);
    }
  });
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
  return { held, request };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
});

describe('openWithoutBfcache', () => {
  // E588: a page frozen into bfcache mid-open leaves the database's
  // version-change transaction pending forever, so every later open hangs.
  // A held Web Lock keeps the page out of bfcache for exactly that window.
  it('holds a Web Lock while the open is pending and releases it after', async () => {
    const { held } = installLocks();
    let finish!: (v: string) => void;
    const open = vi.fn(() => new Promise<string>((r) => (finish = r)));

    const result = openWithoutBfcache(open);
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
    expect(held.size).toBe(1);

    finish('db');
    await expect(result).resolves.toBe('db');
    expect(held.size).toBe(0);
  });

  it('releases the lock and rejects when the open fails', async () => {
    const { held } = installLocks();
    await expect(openWithoutBfcache(() => Promise.reject(new Error('nope')))).rejects.toThrow(
      'nope'
    );
    expect(held.size).toBe(0);
  });

  it('just opens when Web Locks are unavailable', async () => {
    await expect(openWithoutBfcache(() => Promise.resolve(7))).resolves.toBe(7);
  });
});

describe('every IndexedDB open goes through the helper', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
    });
  }

  it('wraps each idb openDB call in openWithoutBfcache', () => {
    const offenders = sources(join(process.cwd(), 'src')).filter((file) => {
      if (file.endsWith('idb-open.ts')) return false;
      const text = readFileSync(file, 'utf8');
      return /\bopenDB\(/.test(text) && !text.includes('openWithoutBfcache(');
    });
    expect(offenders, 'wrap the open in openWithoutBfcache (see lib/util/idb-open.ts)').toEqual([]);
  });
});
