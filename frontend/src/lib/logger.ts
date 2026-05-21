/**
 * Dev-gated logging wrapper.
 *
 * `debug` / `info` / `table` are silent in production builds so end users
 * never see internal deck-builder / API chatter in their browser console.
 * `warn` and `error` always fire so genuine failures stay diagnosable in the
 * field.
 *
 * Use this instead of `console.*` everywhere in `src/` — the `no-console`
 * ESLint rule enforces it (this file is the lone exception).
 */
const verbose = import.meta.env.DEV;

type LogArgs = readonly unknown[];

export const logger = {
  debug: (...args: LogArgs): void => {
    if (verbose) console.debug(...args);
  },
  info: (...args: LogArgs): void => {
    if (verbose) console.info(...args);
  },
  table: (data: unknown): void => {
    if (verbose) console.table(data);
  },
  warn: (...args: LogArgs): void => {
    console.warn(...args);
  },
  error: (...args: LogArgs): void => {
    console.error(...args);
  },
};
