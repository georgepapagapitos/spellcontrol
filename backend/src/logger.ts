/**
 * Server-side logging wrapper.
 *
 * `debug` is silent in production so per-request sync chatter stays out of
 * prod logs; `info` / `warn` / `error` always fire for operational and
 * failure output.
 *
 * Use this instead of `console.*` everywhere in `src/` — the `no-console`
 * ESLint rule enforces it (this file is the lone exception).
 */
const verbose = process.env.NODE_ENV !== 'production';

type LogArgs = readonly unknown[];

export const logger = {
  debug: (...args: LogArgs): void => {
    if (verbose) console.debug(...args);
  },
  info: (...args: LogArgs): void => {
    console.info(...args);
  },
  warn: (...args: LogArgs): void => {
    console.warn(...args);
  },
  error: (...args: LogArgs): void => {
    console.error(...args);
  },
};
