import type { ImportHistoryEntry } from './local-cards';

/**
 * Re-import detection for the import-mode prompt.
 *
 * Importing in "merge" mode appends every incoming card with a fresh copyId —
 * there is no dedup (by design: a physical collection can hold real
 * duplicates). So re-importing an updated export (the common "refresh my
 * collection" flow) and choosing "Add to collection" silently stacks a SECOND
 * copy of every card. This module spots the case so the UI can warn and steer
 * the user to "Replace" instead.
 *
 * Signal: an incoming source whose name matches a name already in import
 * history. It's a heuristic, not a guarantee — the prompt warns, it never
 * blocks (two genuinely different files can share a name). Deleting the prior
 * import removes it from history, so the warning self-clears once the old copy
 * is gone.
 */

/** Internal labels that aren't real source files — their content can't be
 *  identified by name, so they never count as a re-import. */
const SYNTHETIC_LABELS: ReadonlySet<string> = new Set(['pasted-list', 'scanned-cards']);

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Returns the prior import-history entries (most-recent first) whose name
 * matches one of `incomingNames`. A non-empty result means the user is likely
 * re-importing something already in their collection. At most one entry per
 * distinct name — the most recent one.
 */
export function findPriorImports(
  incomingNames: readonly string[],
  history: readonly ImportHistoryEntry[]
): ImportHistoryEntry[] {
  const wanted = new Set(
    incomingNames
      .filter((n) => !SYNTHETIC_LABELS.has(n))
      .map(normalize)
      .filter(Boolean)
  );
  if (wanted.size === 0) return [];

  const latestByName = new Map<string, ImportHistoryEntry>();
  for (const entry of history) {
    const key = normalize(entry.name);
    if (!wanted.has(key)) continue;
    const current = latestByName.get(key);
    if (!current || entry.addedAt > current.addedAt) latestByName.set(key, entry);
  }
  return [...latestByName.values()].sort((a, b) => b.addedAt - a.addedAt);
}
