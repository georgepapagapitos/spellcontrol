// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readLocalStorage } from './local-storage';

describe('readLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns parsed value when key exists', () => {
    localStorage.setItem('test-key', '"hello"');
    const result = readLocalStorage('test-key', JSON.parse, 'fallback');
    expect(result).toBe('hello');
  });

  it('returns fallback when key is absent', () => {
    const result = readLocalStorage('missing', JSON.parse, 'fallback');
    expect(result).toBe('fallback');
  });

  it('returns fallback when parse throws', () => {
    localStorage.setItem('bad-key', 'not-json{{{');
    const result = readLocalStorage('bad-key', JSON.parse, 'fallback');
    expect(result).toBe('fallback');
  });

  it('returns fallback when localStorage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const result = readLocalStorage('any', JSON.parse, 'fallback');
    expect(result).toBe('fallback');
    getItem.mockRestore();
  });
});
