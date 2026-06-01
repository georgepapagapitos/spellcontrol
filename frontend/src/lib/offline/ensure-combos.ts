import { apiUrl } from '../api-base';
import {
  getOfflineDataStats,
  readManifest,
  readStandaloneCombosVersion,
  replaceCombos,
  writeStandaloneCombosVersion,
} from './db';
import type { OfflineCombo, OfflineManifest } from './types';

/**
 * Ensure the global combo dataset is cached in the device-local offline DB so
 * combo matching can run client-side — no login, no per-request server load,
 * works offline.
 *
 * This is the *combos-only* slice of the offline snapshot: it does NOT download
 * the ~30MB oracle-card cache (that's full offline mode). The combo dataset is
 * global reference data (identical for everyone, nightly-ingested from
 * Commander Spellbook), tiny (~200–400 KB gzipped), and lives in
 * `spellcontrol-offline` — the same device-local store as the Scryfall/tagger
 * caches, **never** touched by the per-account `/api/sync` machinery.
 *
 * Deduped per session (one inflight promise). Refreshes when the dataset
 * version moves, but serves a stale cache rather than failing if the refresh
 * can't complete. Returns false only when nothing is cached and the dataset
 * can't be fetched (e.g. offline on first use) — the caller then falls back to
 * the authed server `/api/combos/match` endpoint.
 */
let inflight: Promise<boolean> | null = null;

/** Test hook — clears the per-session inflight promise. */
export function resetCombosCacheForTesting(): void {
  inflight = null;
}

export function ensureCombosCached(): Promise<boolean> {
  if (!inflight) {
    inflight = run().then(
      (ok) => {
        // A negative result (couldn't cache) shouldn't be sticky for the whole
        // session — the user may come back online — so allow a retry.
        if (!ok) inflight = null;
        return ok;
      },
      () => {
        inflight = null;
        return false;
      }
    );
  }
  return inflight;
}

async function run(): Promise<boolean> {
  const { comboCount } = await getOfflineDataStats();
  const server = await fetchManifest();

  if (comboCount > 0) {
    // Have combos already (combos-only cache or full offline mode). Refresh
    // only when we can see the server version AND it moved — and if that
    // refresh fails, keep serving the (slightly stale) cache.
    if (server) {
      const cached =
        (await readStandaloneCombosVersion()) ?? (await readManifest())?.combosVersion ?? null;
      if (cached !== server.combosVersion) {
        try {
          await download(server.combosVersion);
        } catch {
          /* serve the stale cache */
        }
      }
    }
    return true;
  }

  // Nothing cached yet — we need the server to seed it.
  if (!server) return false;
  await download(server.combosVersion);
  return true;
}

async function fetchManifest(): Promise<OfflineManifest | null> {
  try {
    const res = await fetch(apiUrl('/api/offline/manifest'), {
      headers: { Accept: 'application/json' },
    });
    return res.ok ? ((await res.json()) as OfflineManifest) : null;
  } catch {
    return null;
  }
}

async function download(version: string): Promise<void> {
  const res = await fetch(apiUrl('/api/offline/combos'), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to fetch combo dataset (${res.status})`);
  const combos = (await res.json()) as OfflineCombo[];
  await replaceCombos(combos);
  await writeStandaloneCombosVersion(version);
}
