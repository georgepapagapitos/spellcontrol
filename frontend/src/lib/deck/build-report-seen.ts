/** Persistence helpers for the one-shot BuildReportSheet. */

const SEEN_KEY = 'build-report-seen-ids';

/** Persisted set of deck IDs whose build-report sheet has already been shown. */
export function markBuildReportSeen(deckId: string): void {
  try {
    const seen = loadSeenIds();
    seen.add(deckId);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore storage failures */
  }
}

export function isBuildReportSeen(deckId: string): boolean {
  return loadSeenIds().has(deckId);
}

function loadSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed as string[]);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}
