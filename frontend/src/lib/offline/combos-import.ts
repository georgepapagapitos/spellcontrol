import { apiUrl } from '@/lib/api/api-base';
import { appendCombos, pruneCombosNotIn } from './db';
import { rebuildComboIndex } from './combo-index';
import type { OfflineCombo } from './types';

/**
 * Download the global combo dataset and upsert it into the offline store
 * **incrementally**: the server sends NDJSON (one combo per line), which is
 * parsed and written in batches as the bytes arrive. Peak memory is one batch
 * plus the decoder's carry, instead of the whole 107k-row dataset as a 160 MB
 * string and then again as an array (measured 2026-09-09 at a 377 MB JS-heap
 * peak in Chrome — enough to get a WebView renderer killed on a phone).
 *
 * Rows are upserted by id and stale ids pruned only after the stream completes,
 * so the store stays usable throughout: a refresh that dies mid-stream leaves
 * the previous dataset (plus some fresh rows) in place, never an empty or
 * half-cleared store. The caller decides what "cached" means via the version
 * key it writes on success.
 *
 * Returns the number of rows written. `onBytes` reports decoded bytes so far
 * (the browser decompresses transparently) for progress UI.
 */
export async function importCombos(
  onBytes?: (received: number) => void,
  /** Dataset version being imported; when given, the match index is rebuilt for it at the end. */
  version?: string
): Promise<{ count: number }> {
  const result = await importRows(onBytes);
  if (version !== undefined) await rebuildComboIndex(version);
  return result;
}

async function importRows(onBytes?: (received: number) => void): Promise<{ count: number }> {
  const res = await fetch(apiUrl('/api/offline/combos'), {
    headers: { Accept: 'application/x-ndjson, application/json;q=0.9' },
  });
  if (!res.ok) throw new Error("Couldn't download the combo data. Try again in a moment.");

  const seen = new Set<string>();
  let count = 0;
  const write = async (rows: OfflineCombo[]) => {
    if (rows.length === 0) return;
    await appendCombos(rows);
    for (const r of rows) seen.add(r.id);
    count += rows.length;
  };

  const isNdjson = (res.headers.get('Content-Type') ?? '').includes('application/x-ndjson');
  if (!isNdjson || !res.body) {
    // Legacy JSON array (older server) or no streaming reader — one shot.
    const rows = (await res.json()) as OfflineCombo[];
    for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH));
    await pruneCombosNotIn(seen);
    return { count };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let carry = '';
  let received = 0;
  let batch: OfflineCombo[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    onBytes?.(received);
    carry += decoder.decode(value, { stream: true });
    let nl = carry.indexOf('\n');
    while (nl !== -1) {
      const line = carry.slice(0, nl);
      carry = carry.slice(nl + 1);
      if (line.trim()) batch.push(JSON.parse(line) as OfflineCombo);
      if (batch.length >= BATCH) {
        await write(batch);
        batch = [];
      }
      nl = carry.indexOf('\n');
    }
  }
  carry += decoder.decode();
  if (carry.trim()) batch.push(JSON.parse(carry) as OfflineCombo);
  await write(batch);
  await pruneCombosNotIn(seen);
  return { count };
}

/** Rows per IndexedDB transaction while streaming in. */
const BATCH = 1000;
