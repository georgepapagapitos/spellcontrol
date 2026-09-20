/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The beacon's two halves have to agree on what an event is called.
 *
 * `analytics.ts` declares the `EventName` union and `track()` sends it;
 * `backend/src/routes/events.ts` holds `EVENT_NAMES` and its handler is
 *
 *     if (EVENT_NAMES.has(name)) await countEvent(name, path);
 *     else if (name === 'error') …
 *     else if (name === 'vital') …
 *
 * with no final `else`. An event the server does not know is therefore
 * answered 204 and thrown away — no error, no log, no row. Nothing anywhere
 * tells you, which is why #1911 ("instrument the funnel past the landing
 * page") could add `play_started`, `register_completed`, `deck_created` and
 * `binder_created` to seven frontend files, ship green, and record nothing at
 * all. The loss is invisible at exactly the moment you go looking for the
 * numbers, because an unrecorded door and an unused door read identically in
 * Admin → Analytics.
 *
 * Both files are plain source here rather than imports: the backend is a
 * separate package with its own dependency tree, so the frontend suite reads
 * it as text. `db/schema-parity.test.ts` crosses a boundary the same way for
 * the same reason.
 */
const here = dirname(fileURLToPath(import.meta.url));
const analytics = readFileSync(join(here, 'analytics.ts'), 'utf8');
const events = readFileSync(
  join(here, '..', '..', '..', 'backend', 'src', 'routes', 'events.ts'),
  'utf8'
);

/** The `EventName` union's members, as written in analytics.ts. */
function clientEvents(): string[] {
  const union = /export type EventName =([\s\S]*?);/.exec(analytics)?.[1];
  if (!union) throw new Error('could not find the EventName union in analytics.ts');
  return [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** The `EVENT_NAMES` set's members, as written in events.ts. */
function serverEvents(): string[] {
  const set = /export const EVENT_NAMES = new Set\(\[([\s\S]*?)\]\)/.exec(events)?.[1];
  if (!set) throw new Error('could not find EVENT_NAMES in backend events.ts');
  return [...set.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('analytics event names agree across the beacon', () => {
  it('finds both lists', () => {
    // If either regex stops matching, every assertion below passes vacuously.
    expect(clientEvents().length).toBeGreaterThan(5);
    expect(serverEvents().length).toBeGreaterThan(5);
  });

  it('the server accepts every event the client can send', () => {
    const server = new Set(serverEvents());
    const dropped = clientEvents().filter((n) => !server.has(n));
    expect(
      dropped,
      `These events are fired by track() but are not in the backend's EVENT_NAMES, ` +
        `so /api/events answers 204 and writes no row. Add them to ` +
        `backend/src/routes/events.ts.`
    ).toEqual([]);
  });

  it('the server accepts nothing the client cannot send', () => {
    // Not a data-loss bug, but a name here that no longer exists on the client
    // is dead config, and usually the other half of a rename.
    const client = new Set(clientEvents());
    const orphaned = serverEvents().filter((n) => !client.has(n));
    expect(
      orphaned,
      `These names are in the backend's EVENT_NAMES but no longer in the ` +
        `frontend's EventName union. Remove them, or finish the rename.`
    ).toEqual([]);
  });
});
