/**
 * Shared "applying server state" flag.
 *
 * Lives in its own zero-dependency module so the store subscribers
 * (collection/decks/play) can read it **synchronously** — before they do the
 * async `import('./sync')` — without importing sync.ts, which imports the
 * stores back (a cycle). The sync driver sets it while it writes server-pulled
 * rows into the stores; subscribers checking it synchronously then correctly
 * skip re-persisting (and re-pushing) data we just received.
 */
let applyingServer = false;

/** Subscribers in collection.ts / decks.ts / play.ts check this synchronously. */
export function isApplyingServer(): boolean {
  return applyingServer;
}

export function setApplyingServer(value: boolean): void {
  applyingServer = value;
}
