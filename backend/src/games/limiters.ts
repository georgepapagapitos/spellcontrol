import { testAwareLimiter } from '../route-utils';

// One instance per limiter, shared by every games router: a budget lives on
// the limiter object, so a second copy would double the ceiling.

// 200/min covers the 2.5s poll loop with room for several players and tabs
// behind one NAT, while still throttling a scripted sweep of the code space.
// Also covers /events (SSE) and /poll (long-poll): a legitimate client opens
// the SSE stream once per session and reconnects at most a handful of times
// an hour; a long-poll client only re-issues when its held request resolves
// (a broadcast — itself bounded by writeLimiter below — or the ~25s
// timeout), so its steady-state rate is *lower* than the 2.5s poll this
// budget was already sized for. Sharing the one budget still leaves headroom
// while keeping the same per-minute ceiling on a scripted code sweep that
// the comment above GET /:code explains.
export const readLimiter = testAwareLimiter({ windowMs: 60_000, max: 200 });
export const writeLimiter = testAwareLimiter({ windowMs: 60_000, max: 300 });
export const createLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });
