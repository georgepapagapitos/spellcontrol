import { describe, it, expect } from 'vitest';
import { isRateLimiter } from '../route-utils';

import { authRouter } from './auth';
import { adminRouter } from './admin';
import { syncRouter } from './sync';
import { gamesRouter } from './games';
import { gameResultsRouter } from './game-results';
import { combosRouter } from './combos';
import { aggregatesRouter } from './aggregates';
import { sharesRouter } from './shares';
import { feedbackRouter } from './feedback';
import { offlineRouter } from './offline';
import { scannerRouter } from './scanner';
import { friendsRouter } from './friends';
import { usersRouter } from './users';
import { gameNightsRouter } from './game-nights';
import { podsRouter } from './pods';
import { podStatsRouter } from './pod-stats';
import { tonightTradesRouter } from './tonight-trades';
import { tradesRouter } from './trades';
import { publicationsRouter } from './publications';
import { publicRouter } from './public';
import { reportsRouter } from './reports';
import { discoverRouter } from './discover';
import { activityRouter } from './activity';
import { aiRouter } from './ai';
import { eventsRouter } from './events';

/**
 * Guard: every `/api` route carries a rate limiter.
 *
 * This is the repo's REAL check for that, and it exists because CodeQL's
 * `js/missing-rate-limiting` cannot do the job here. That query cannot see
 * through `testAwareLimiter` (a ternary returning either express-rate-limit or
 * a test passthrough), so it flags every route on every router that uses it —
 * ~99 instances dismissed as false positives by 2026-09-21, three more on every
 * PR that touches a router. A security check that is wrong 99 times out of 99
 * does not get read; it gets dismissed on reflex, and the hundredth one — a
 * genuinely unlimited route — gets dismissed with it.
 *
 * So the coverage check moved in here, where it can be exact: `testAwareLimiter`
 * tags what it returns (see `route-utils.ts`), and this walks the real router
 * stacks and asserts the tag is present on every route. Unlike the CodeQL rule
 * it also covers routes with no auth at all, which that query ignores.
 *
 * A new route with no limiter fails this test with its method and path. Fix it
 * by adding the router's limiter, not by adding an exemption — the exemption
 * list below is for routes that must answer while being hammered, and it costs
 * a written reason.
 */

/** `<router>#<METHOD> <path>` entries that intentionally ship unlimited. */
const EXEMPT = new Map<string, string>([
  // (empty — every route is limited today. Add with a reason, never bare.)
]);

type Layer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle?: unknown; handler?: unknown }>;
  };
};

const ROUTERS: Array<[string, unknown]> = [
  ['auth', authRouter],
  ['admin', adminRouter],
  ['sync', syncRouter],
  ['games', gamesRouter],
  ['game-results', gameResultsRouter],
  ['combos', combosRouter],
  ['aggregates', aggregatesRouter],
  ['shares', sharesRouter],
  ['feedback', feedbackRouter],
  ['offline', offlineRouter],
  ['scanner', scannerRouter],
  ['friends', friendsRouter],
  ['users', usersRouter],
  ['game-nights', gameNightsRouter],
  ['pods', podsRouter],
  ['pod-stats', podStatsRouter],
  ['tonight-trades', tonightTradesRouter],
  ['trades', tradesRouter],
  ['publications', publicationsRouter],
  ['public', publicRouter],
  ['reports', reportsRouter],
  ['discover', discoverRouter],
  ['activity', activityRouter],
  ['ai', aiRouter],
  ['events', eventsRouter],
];

/** Every `<router>#<METHOD> <path>` on a router, with its handler chain. */
function routesOf(name: string, router: unknown): Array<{ id: string; handlers: unknown[] }> {
  const stack = (router as { stack?: Layer[] }).stack ?? [];
  const out: Array<{ id: string; handlers: unknown[] }> = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route) continue;
    const handlers = (route.stack ?? []).map((h) => h.handle ?? h.handler);
    for (const method of Object.keys(route.methods ?? {})) {
      out.push({ id: `${name}#${method.toUpperCase()} ${route.path ?? '?'}`, handlers });
    }
  }
  return out;
}

describe('every /api route is rate-limited', () => {
  // Self-check: if the walker ever stops finding routes (an Express upgrade
  // renames `stack`/`route`, say), this whole file would pass vacuously and a
  // unlimited route would sail through. Assert it found a realistic number.
  it('walks the real router stacks', () => {
    const total = ROUTERS.reduce((n, [name, r]) => n + routesOf(name, r).length, 0);
    expect(total).toBeGreaterThan(100);
  });

  it('finds a limiter on every route', () => {
    const unlimited: string[] = [];
    for (const [name, router] of ROUTERS) {
      for (const { id, handlers } of routesOf(name, router)) {
        if (EXEMPT.has(id)) continue;
        if (!handlers.some(isRateLimiter)) unlimited.push(id);
      }
    }
    expect(unlimited).toEqual([]);
  });

  it('has no stale exemptions', () => {
    const live = new Set(ROUTERS.flatMap(([n, r]) => routesOf(n, r).map((x) => x.id)));
    expect([...EXEMPT.keys()].filter((k) => !live.has(k))).toEqual([]);
  });
});
