import { describe, it, expect, vi, afterEach } from 'vitest';
import { subscribeGameEvents } from './games-sse';
import type { GameState } from './game-state';
import type { PublicBoard } from './playtest/projection';
import type { GameRequest } from './games-api';

/**
 * Minimal `EventSource` stand-in — Node has no global `EventSource`
 * (confirmed: `node -e "console.log(typeof EventSource)"` prints
 * `undefined` even on Node 22), so these tests stub the constructor rather
 * than relying on a real one.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  private listeners: Record<string, Array<(ev: { data?: string }) => void>> = {};

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: { data?: string }) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  emit(type: string, ev: { data?: string } = {}): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }

  close(): void {
    this.closed = true;
  }
}

describe('subscribeGameEvents', () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.unstubAllGlobals();
  });

  function stub() {
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  }

  it('opens the /events stream for the given code with withCredentials set', () => {
    stub();
    subscribeGameEvents('ABCD', { onState: vi.fn() });
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('/api/games/ABCD/events');
    expect(es.withCredentials).toBe(true);
  });

  it('parses a state event and forwards the payload to onState', () => {
    stub();
    const onState = vi.fn();
    subscribeGameEvents('ABCD', { onState });
    const es = FakeEventSource.instances[0];
    const state = { code: 'ABCD', version: 3 } as unknown as GameState;
    es.emit('state', { data: JSON.stringify(state) });
    expect(onState).toHaveBeenCalledWith(state);
  });

  it('swallows a malformed state frame instead of throwing', () => {
    stub();
    const onState = vi.fn();
    subscribeGameEvents('ABCD', { onState });
    const es = FakeEventSource.instances[0];
    expect(() => es.emit('state', { data: 'not json' })).not.toThrow();
    expect(onState).not.toHaveBeenCalled();
  });

  it('parses a board event and forwards seat + board to onBoard', () => {
    stub();
    const onBoard = vi.fn();
    subscribeGameEvents('ABCD', { onState: vi.fn(), onBoard });
    const es = FakeEventSource.instances[0];
    const board = { seat: 0 } as unknown as PublicBoard;
    es.emit('board', { data: JSON.stringify({ seat: 1, board }) });
    expect(onBoard).toHaveBeenCalledWith(1, board);
  });

  it('swallows a malformed board frame instead of throwing', () => {
    stub();
    const onBoard = vi.fn();
    subscribeGameEvents('ABCD', { onState: vi.fn(), onBoard });
    const es = FakeEventSource.instances[0];
    expect(() => es.emit('board', { data: 'not json' })).not.toThrow();
    expect(onBoard).not.toHaveBeenCalled();
  });

  it('onBoard is optional — no throw when omitted', () => {
    stub();
    subscribeGameEvents('ABCD', { onState: vi.fn() });
    const es = FakeEventSource.instances[0];
    expect(() => es.emit('board', { data: JSON.stringify({ seat: 1, board: {} }) })).not.toThrow();
  });

  it('forwards native open/error events to onOpen/onError', () => {
    stub();
    const onOpen = vi.fn();
    const onError = vi.fn();
    subscribeGameEvents('ABCD', { onState: vi.fn(), onOpen, onError });
    const es = FakeEventSource.instances[0];
    es.emit('open');
    expect(onOpen).toHaveBeenCalledOnce();
    es.emit('error');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('onOpen/onError are optional — no throw when omitted', () => {
    stub();
    subscribeGameEvents('ABCD', { onState: vi.fn() });
    const es = FakeEventSource.instances[0];
    expect(() => {
      es.emit('open');
      es.emit('error');
    }).not.toThrow();
  });

  it('parses a request event and forwards it to onRequest', () => {
    stub();
    const onRequest = vi.fn();
    subscribeGameEvents('ABCD', { onState: vi.fn(), onRequest });
    const es = FakeEventSource.instances[0];
    const req = {
      id: 'r1',
      code: 'ABCD',
      kind: 'rewind',
      payload: { steps: 1, summary: 'x' },
      requesterSeat: 0,
      approvals: {},
      status: 'pending',
      createdAt: 0,
      expiresAt: 1000,
    } as GameRequest;
    es.emit('request', { data: JSON.stringify(req) });
    expect(onRequest).toHaveBeenCalledWith(req);
  });

  it('swallows a malformed request frame instead of throwing', () => {
    stub();
    const onRequest = vi.fn();
    subscribeGameEvents('ABCD', { onState: vi.fn(), onRequest });
    const es = FakeEventSource.instances[0];
    expect(() => es.emit('request', { data: 'not json' })).not.toThrow();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('onRequest is optional — no throw when omitted', () => {
    stub();
    subscribeGameEvents('ABCD', { onState: vi.fn() });
    const es = FakeEventSource.instances[0];
    expect(() =>
      es.emit('request', { data: JSON.stringify({ id: 'r1', status: 'pending' }) })
    ).not.toThrow();
  });

  it('the returned teardown fn closes the underlying connection', () => {
    stub();
    const teardown = subscribeGameEvents('ABCD', { onState: vi.fn() });
    const es = FakeEventSource.instances[0];
    expect(es.closed).toBe(false);
    teardown();
    expect(es.closed).toBe(true);
  });
});
