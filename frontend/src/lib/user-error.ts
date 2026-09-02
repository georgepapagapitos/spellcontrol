import { logger } from './logger';

/**
 * Turn a caught error into copy a person can act on.
 *
 * Two kinds of message reach a `catch` block:
 *
 *  1. Copy we wrote — the backend's `{ error }` body ("That trade was already
 *     answered.") or a client's own thrown message ("The request timed out…").
 *     Those follow the voice rules and are the most specific thing we can say,
 *     so they pass through.
 *  2. Transport noise — `fetch` rejecting with "Failed to fetch", a proxy's
 *     "Request failed: HTTP 502", a JSON parse error, an `AbortError`. None of
 *     it tells the reader what happened or what to do next, so it is replaced
 *     by the caller's `fallback`, which names both.
 *
 * The raw error is always logged so the console keeps the real cause.
 */
export function userMessage(err: unknown, fallback: string): string {
  logger.warn('[ui] error shown to the user:', err);
  if (err instanceof Error && err.message.trim() && !isTransportNoise(err.message)) {
    return err.message;
  }
  return fallback;
}

/**
 * Heuristic for messages a person should never see verbatim. Anything with a
 * bare HTTP status, a browser network error, a parser/runtime error, or the
 * generic "Unknown error" is noise; everything else is treated as authored.
 */
const NOISE = [
  /^failed to fetch/i,
  /networkerror/i,
  /^load failed/i,
  /fetch failed/i,
  /^request failed/i,
  /\bHTTP\s*\d{3}\b/i,
  /\b(400|401|403|404|408|409|413|422|429|500|502|503|504)\b/,
  /^unknown error/i,
  /^unexpected (token|end)/i,
  /json/i,
  /^aborterror/i,
  /^the operation was aborted/i,
  /^the user aborted a request/i,
  /^typeerror/i,
  /^referenceerror/i,
  /^cannot read propert/i,
  /is not a function/i,
  /is not defined$/i,
  /^undefined$/i,
  /^null$/i,
  /^\[object /i,
  /econn(refused|reset)/i,
];

export function isTransportNoise(message: string): boolean {
  return NOISE.some((re) => re.test(message));
}
