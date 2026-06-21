import { describe, it, expect } from 'vitest';
import { makeFlag } from './make-flag';

describe('makeFlag', () => {
  it('starts as false', () => {
    const { get } = makeFlag();
    expect(get()).toBe(false);
  });

  it('set(true) makes get() return true', () => {
    const { get, set } = makeFlag();
    set(true);
    expect(get()).toBe(true);
  });

  it('set(false) resets the flag', () => {
    const { get, set } = makeFlag();
    set(true);
    set(false);
    expect(get()).toBe(false);
  });

  it('each makeFlag() call returns an independent flag', () => {
    const a = makeFlag();
    const b = makeFlag();
    a.set(true);
    expect(a.get()).toBe(true);
    expect(b.get()).toBe(false);
  });
});
