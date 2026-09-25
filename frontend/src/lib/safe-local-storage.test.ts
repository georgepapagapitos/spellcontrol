import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeLocalStorage } from './safe-local-storage';
import { logger } from './logger';

function quotaError(): Error {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

function stubStorage(overrides: Partial<Storage>) {
  const base = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  vi.stubGlobal('localStorage', { ...base, ...overrides });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('safeLocalStorage', () => {
  it('swallows and logs a write that overflows the quota', () => {
    stubStorage({
      setItem: () => {
        throw quotaError();
      },
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(() => safeLocalStorage.setItem('spellcontrol-horde-game', 'x'.repeat(10))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads as empty when storage itself is blocked', () => {
    stubStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(safeLocalStorage.getItem('anything')).toBeNull();
  });

  it('passes a normal write and read straight through', () => {
    const store = new Map<string, string>();
    stubStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    safeLocalStorage.setItem('k', 'v');
    expect(safeLocalStorage.getItem('k')).toBe('v');
  });
});

/* Guard: every zustand `persist` store that keeps its state in localStorage
 * goes through `safeLocalStorage`. A raw `createJSONStorage(() => localStorage)`
 * throws QuotaExceededError out of the middle of a store action (the paper
 * Horde table's damage sheet stuck open that way). Fix a failure by passing
 * `safeLocalStorage` instead. */
describe('persist stores never use raw localStorage', () => {
  const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it('finds no createJSONStorage over bare localStorage', () => {
    const offenders = walk(srcDir)
      .filter((f) =>
        /createJSONStorage\(\s*\(\)\s*=>\s*localStorage\s*\)/.test(readFileSync(f, 'utf8'))
      )
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });
});
