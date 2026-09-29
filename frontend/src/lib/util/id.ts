/**
 * Prefixed unique id, e.g. `deck_<uuid>`. Uses `crypto.randomUUID()` when
 * available; the timestamp+random fallback only runs in environments without
 * it. Ids are opaque — nothing parses the suffix — so the prefix is purely a
 * human-readable hint.
 */
export function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
