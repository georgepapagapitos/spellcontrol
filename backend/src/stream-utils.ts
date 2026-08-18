import type { Readable, Writable } from 'node:stream';

/**
 * `src.pipe(dest)` with the source's `'error'` forwarded to `dest`.
 *
 * ⛔ **Always use this instead of a bare `.pipe()`.** `.pipe()` does NOT forward
 * errors from the source stream, and an unhandled `'error'` on an EventEmitter
 * is **process-fatal** in Node. So a source that dies mid-flight — a dropped
 * ~450MB download, a truncated file read — emits `'error'` with nobody
 * listening and takes the whole server down. The consuming `for await` only
 * watches the far end of the pipeline and never sees it.
 *
 * That is fault #3 of the 2026-08-17 outage (#1657): `TypeError: terminated` /
 * `SocketError: other side closed` out of undici, `exit_code=1`,
 * `oom_killed=false`. Fly restarted the process, the ingest began again from
 * zero, and because it only records success it never completed once in six
 * attempts — a routine nightly refresh presented as a six-hour outage.
 *
 * Destroying `dest` with the source's error surfaces it downstream, so the
 * consumer's `for await` throws and the caller's existing catch logs it: a
 * dropped connection fails the **job**, not the **process**.
 */
export function pipeForwardingErrors<T extends Writable>(src: Readable, dest: T): T {
  src.on('error', (err) => dest.destroy(err));
  return src.pipe(dest);
}
