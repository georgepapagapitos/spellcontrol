import { apiUrl } from '../api-base';
import {
  getOfflineDataStats,
  readManifest,
  readStandaloneCombosVersion,
  writeStandaloneCombosVersion,
} from './db';
import { importCombos } from './combos-import';
import { logger } from '../logger';

/**
 * Ensure the global combo dataset is cached in the device-local offline DB so
 * combo matching can run client-side — no login, no per-request server load,
 * works offline.
 *
 * This is the *combos-only* slice of the offline snapshot: it does NOT download
 * the ~30MB oracle-card cache (that's full offline mode). The combo dataset is
 * global reference data (identical for everyone, nightly-ingested from
 * Commander Spellbook), and lives in `spellcontrol-offline` — the same
 * device-local store as the Scryfall/tagger caches, **never** touched by the
 * per-account `/api/sync` machinery. It is NOT tiny: measured 2026-07-31 at
 * 17.0 MB gzipped (102k combos, 159 MB raw) — plan storage/transfer budgets
 * against that, not the old "~200-400 KB" estimate this comment used to carry.
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
  // "Cached" means rows AND a version stamp. The import streams rows in and
  // stamps the version only when the whole dataset arrived, so rows without a
  // stamp are a download that died mid-stream — finish it, don't serve it.
  const cached =
    (await readStandaloneCombosVersion()) ?? (await readManifest())?.combosVersion ?? null;

  if (comboCount > 0 && cached) {
    // Have combos already (combos-only cache or full offline mode). Refresh
    // only when we can see the server version AND it moved, and do it in the
    // background: the import upserts in 1000-row transactions and prunes last,
    // so matching reads a whole (slightly stale) dataset the entire time.
    // Awaiting it held every combo check, and the deck's bracket behind it,
    // for the full download after each nightly ingest (10–40 s on a phone).
    // A failed refresh keeps the stale cache and retries next session.
    if (server && cached !== server.combosVersion) {
      download(server.combosVersion).catch(() => {
        /* serve the stale cache */
      });
    }
    return true;
  }

  // Nothing cached yet — we need the server to seed it.
  if (!server) return false;
  await download(server.combosVersion);
  return true;
}

/**
 * Hits `/api/offline/combos-version`, NOT `/api/offline/manifest` — the
 * manifest 503s until the (unrelated) Scryfall oracle-card bulk finishes its
 * 30-60s rebuild after every deploy, even though the combo dataset is
 * Postgres-backed and ready the whole time. Gating on the full manifest here
 * made a cold combo cache fall back to the capped server matcher for every
 * user who visited during that window (E212).
 */
async function fetchManifest(): Promise<{ combosVersion: string } | null> {
  try {
    const res = await fetch(apiUrl('/api/offline/combos-version'), {
      headers: { Accept: 'application/json' },
    });
    return res.ok ? ((await res.json()) as { combosVersion: string }) : null;
  } catch {
    return null;
  }
}

async function download(version: string): Promise<void> {
  // Off the main thread when the platform allows it: the import parses and
  // writes 107k rows, and on the page that needed combos that was 10–40 s of
  // jank on a phone after every nightly dataset refresh. The inline path is
  // the same import (upserts are idempotent), for environments without
  // workers and for a worker that failed part-way.
  if (!(await importInWorker(version))) await importCombos(undefined, version);
  await writeStandaloneCombosVersion(version);
}

function importInWorker(version: string): Promise<boolean> {
  if (typeof Worker === 'undefined' || import.meta.env.MODE === 'test') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./combos-import.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      resolve(false);
      return;
    }
    const finish = (ok: boolean) => {
      worker.terminate();
      resolve(ok);
    };
    worker.onmessage = (e: MessageEvent<{ ok: boolean; message?: string }>) => {
      if (!e.data?.ok) logger.warn('[combos] import worker failed:', e.data?.message);
      finish(Boolean(e.data?.ok));
    };
    worker.onerror = (e) => {
      logger.warn('[combos] import worker crashed:', e.message);
      finish(false);
    };
    worker.postMessage({ version });
  });
}
