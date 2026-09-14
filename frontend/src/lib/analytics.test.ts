// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clsSessionMax,
  describeError,
  normalizePath,
  reportError,
  setUsageSuppressed,
  track,
} from './analytics';

describe('normalizePath', () => {
  it('collapses ids, tokens and slugs', () => {
    expect(normalizePath('/s/abc123')).toBe('/s/:id');
    expect(normalizePath('/d/urianger-deck-453d5e02')).toBe('/d/:id');
    expect(normalizePath('/u/george')).toBe('/u/:id');
    expect(normalizePath('/gn/i/tok')).toBe('/gn/:id/*');
    expect(normalizePath('/decks/xyz/playtest')).toBe('/decks/:id/*');
    expect(normalizePath('/decks/cube/xyz')).toBe('/decks/cube/:id');
    expect(normalizePath('/collection/binders/b1')).toBe('/collection/binders/:id');
    expect(normalizePath('/pods/p1')).toBe('/pods/:id');
  });
  it('keeps static routes intact', () => {
    for (const p of [
      '/',
      '/decks',
      '/decks/new',
      '/decks/new/brew',
      '/decks/discover',
      '/collection/binders',
      '/guides/',
      '/play',
    ]) {
      expect(normalizePath(p)).toBe(p);
    }
  });
});

describe('describeError', () => {
  it('takes the message and the first script frame, dropping origin and query', () => {
    const err = new Error('Cannot read properties of undefined');
    err.stack =
      'TypeError: Cannot read properties of undefined\n' +
      '    at renderRow (https://spellcontrol.com/assets/decks-CTanjpfj.js?v=3:12:345)\n' +
      '    at https://spellcontrol.com/assets/index-Bt0V-5X0.js:1:2';
    expect(describeError(err)).toEqual({
      message: 'Cannot read properties of undefined',
      frame: 'decks-CTanjpfj.js:12:345',
    });
  });
  it('handles thrown strings, bare objects and nothing at all', () => {
    expect(describeError('boom')).toEqual({ message: 'boom', frame: '' });
    expect(describeError({ message: 'obj' })).toEqual({ message: 'obj', frame: '' });
    expect(describeError(undefined)).toEqual({ message: 'Unknown error', frame: '' });
  });
});

describe('reportError', () => {
  let sent: string[];
  beforeEach(() => {
    sent = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (_url: string, blob: Blob) => {
        void blob.text().then((t) => sent.push(t));
        return true;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('beacons the normalized path, kind, message and frame once per distinct error', async () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at x (/assets/play-BfJ7xDJ2.js:3:4)';
    window.history.pushState({}, '', '/decks/abc123/playtest');
    reportError('error', err);
    reportError('error', err);
    reportError('rejection', err);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((s) => JSON.parse(s))).toEqual([
      {
        name: 'error',
        path: '/decks/:id/*',
        kind: 'error',
        message: 'boom',
        frame: 'play-BfJ7xDJ2.js:3:4',
      },
      {
        name: 'error',
        path: '/decks/:id/*',
        kind: 'rejection',
        message: 'boom',
        frame: 'play-BfJ7xDJ2.js:3:4',
      },
    ]);
  });

  it('ignores browser noise that is not a defect', async () => {
    reportError(
      'error',
      new Error('ResizeObserver loop completed with undelivered notifications.')
    );
    reportError('rejection', new DOMException('The operation was aborted.', 'AbortError'));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
  });
});

describe('clsSessionMax', () => {
  it('is the largest 5s/1s-gap session window, not the raw sum', () => {
    const shifts = [
      { startTime: 100, value: 0.05 },
      { startTime: 600, value: 0.05 }, // same session → 0.10
      { startTime: 3000, value: 0.2 }, // >1s gap → new session
      { startTime: 3500, value: 0.05 }, // → 0.25
    ];
    expect(clsSessionMax(shifts)).toBeCloseTo(0.25);
    expect(clsSessionMax([])).toBe(0);
  });
});

describe('track', () => {
  let sent: string[];
  beforeEach(() => {
    sent = [];
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (_url: string, blob: Blob) => {
        void blob.text().then((t) => sent.push(t));
        return true;
      },
    });
  });
  afterEach(() => {
    setUsageSuppressed(false);
    vi.unstubAllGlobals();
  });

  it('beacons the event name and the normalized current path', async () => {
    window.history.pushState({}, '', '/collection/binders/b1');
    track('binder_created');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((t) => JSON.parse(t))).toEqual([
      { name: 'binder_created', path: '/collection/binders/:id' },
    ]);
  });

  it('sends nothing at all while usage is suppressed', async () => {
    setUsageSuppressed(true);
    track('play_started');
    track('deck_created');
    track('register_completed');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
  });

  it('resumes once suppression is lifted', async () => {
    setUsageSuppressed(true);
    track('play_started');
    setUsageSuppressed(false);
    track('play_started');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
  });
});
