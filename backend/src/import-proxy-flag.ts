/**
 * Parses the "mark all as proxies" import-time flag off a request body.
 * Extracted from server.ts (which boots the whole app on import) so it's
 * testable in isolation, same reasoning as merge-card.ts.
 *
 * multer puts non-file multipart fields on req.body as STRINGS, so this is a
 * trust boundary: only the exact boolean `true` or string `'true'` set the
 * flag — never truthy-coerce arbitrary client input.
 */
export function parseMarkAllAsProxies(body: unknown): boolean {
  const proxy = (body as { proxy?: unknown } | null | undefined)?.proxy;
  return proxy === true || proxy === 'true';
}
