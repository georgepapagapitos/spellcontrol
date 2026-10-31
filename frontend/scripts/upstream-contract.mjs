#!/usr/bin/env node
// Nightly upstream contract check (E1054). Fetches a small fixed set of real
// endpoints (EDHREC, Scryfall, Commander Spellbook, Scryfall's oracle-tag
// feeds) and asserts the shape our readers depend on, using the pure checks in
// upstream-contract-lib.mjs. Every upstream format change so far broke a
// feature silently (the field vanished, the code read undefined, the feature
// went inert); this turns that into a red run within a day.
//
//   node scripts/upstream-contract.mjs            # run from frontend/
//   node scripts/upstream-contract.mjs --only edhrec,scryfall
//
// Exit 1 when any contract is broken or an endpoint is unreachable after the
// retries. Writes a Markdown table to $GITHUB_STEP_SUMMARY when set. Polite by
// construction: ~20 sequential requests, a descriptive User-Agent, backoff on
// 429/5xx (same discipline as edhrecFetch in edhrec/client.ts). Never part of
// the required PR checks: it needs the network.

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import {
  OTAG_QUERIES,
  checkEdhrecCombos,
  checkEdhrecCommanderPage,
  checkEdhrecSalt,
  checkEdhrecTagPage,
  checkEdhrecTopList,
  checkOracleCardRecord,
  checkOtagRecord,
  checkOtagSearch,
  checkScryfallBulkIndex,
  checkScryfallCard,
  checkSpellbookVariants,
  firstVariants,
} from './upstream-contract-lib.mjs';

const UA = 'SpellControl-UpstreamContract/1.0 (+https://spellcontrol.com)';
const EDHREC = 'https://json.edhrec.com';
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1000;
const GAP_MS = { edhrec: 1000, scryfall: 250, spellbook: 0 };
/** Bytes of variants.json to read: a handful of variants, not the ~100 MB file. */
const SPELLBOOK_PREFIX_BYTES = 200_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with backoff on 429 / 5xx / network errors; Retry-After is honored. */
export async function politeFetch(url, init = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    return politeFetch(url, init, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
    await res.body?.cancel();
    const retryAfter = Number(res.headers.get('Retry-After'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : BASE_BACKOFF_MS * 2 ** attempt);
    return politeFetch(url, init, attempt + 1);
  }
  return res;
}

async function getJson(url) {
  const res = await politeFetch(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/** The first `bytes` bytes of a body as text; the rest is never downloaded. */
async function fetchPrefix(url, bytes) {
  const ctrl = new AbortController();
  const res = await politeFetch(url, { signal: ctrl.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  let got = 0;
  while (got < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    text += dec.decode(value, { stream: true });
  }
  ctrl.abort();
  await reader.cancel().catch(() => {});
  return text;
}

/** The first line of a gzipped JSONL feed, parsed. */
async function firstJsonlRecord(url) {
  const ctrl = new AbortController();
  const res = await politeFetch(url, { signal: ctrl.signal, headers: { Accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const gunzip = createGunzip();
  const src = Readable.fromWeb(res.body);
  src.on('error', () => {});
  gunzip.on('error', () => {});
  const lines = createInterface({ input: src.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line) return JSON.parse(line);
    }
    throw new Error('feed was empty');
  } finally {
    ctrl.abort();
    lines.close();
    src.destroy();
    gunzip.destroy();
  }
}

/** Each probe: a name, the source it belongs to, and a function returning {failures, notes}. */
function buildProbes() {
  const edhrec = (name, path, check) => ({
    source: 'edhrec',
    name,
    url: `${EDHREC}${path}`,
    run: async () => check(await getJson(`${EDHREC}${path}`)),
  });
  const scry = (name, url, check) => ({
    source: 'scryfall',
    name,
    url,
    run: async () => check(await getJson(url)),
  });
  let bulkIndex = null;
  const getBulkIndex = async () =>
    (bulkIndex ??= await getJson('https://api.scryfall.com/bulk-data'));
  const bulkUri = async (type) => {
    const e = (await getBulkIndex()).data?.find((x) => x?.type === type);
    const uri = e?.jsonl_download_uri ?? e?.download_uri;
    if (!uri) throw new Error(`no bulk-data feed "${type}"`);
    return uri;
  };

  return [
    edhrec(
      'commander page (sythis-harvests-hand)',
      '/pages/commanders/sythis-harvests-hand.json',
      checkEdhrecCommanderPage
    ),
    edhrec('tag page (aristocrats)', '/pages/tags/aristocrats.json', checkEdhrecTagPage),
    edhrec('salt list', '/pages/top/salt.json', checkEdhrecSalt),
    edhrec(
      'commander combos (sythis-harvests-hand)',
      '/pages/combos/sythis-harvests-hand.json',
      checkEdhrecCombos
    ),
    edhrec('top cards (week)', '/pages/top/week.json', (b) => checkEdhrecTopList(b, 'cards')),
    edhrec('top commanders (week)', '/pages/commanders/week.json', (b) =>
      checkEdhrecTopList(b, 'commanders')
    ),
    scry(
      'card (/cards/named Lightning Bolt)',
      'https://api.scryfall.com/cards/named?exact=Lightning+Bolt',
      checkScryfallCard
    ),
    {
      source: 'scryfall',
      name: 'bulk-data index',
      url: 'https://api.scryfall.com/bulk-data',
      run: async () => checkScryfallBulkIndex(await getBulkIndex()),
    },
    {
      source: 'scryfall',
      name: 'oracle_tags feed, first record',
      url: 'bulk-data oracle_tags',
      run: async () => checkOtagRecord(await firstJsonlRecord(await bulkUri('oracle_tags'))),
    },
    {
      source: 'scryfall',
      name: 'oracle_cards feed, first record',
      url: 'bulk-data oracle_cards',
      run: async () => checkOracleCardRecord(await firstJsonlRecord(await bulkUri('oracle_cards'))),
    },
    ...OTAG_QUERIES.map(({ query, min }) =>
      scry(
        `tagger query ${query}`,
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`,
        (b) => checkOtagSearch(b, min)
      )
    ),
    {
      source: 'spellbook',
      name: 'variants.json, first variants',
      url: 'https://json.commanderspellbook.com/variants.json',
      run: async () => {
        const text = await fetchPrefix(
          'https://json.commanderspellbook.com/variants.json',
          SPELLBOOK_PREFIX_BYTES
        );
        return checkSpellbookVariants(firstVariants(text, 5));
      },
    },
  ];
}

export async function main(argv = process.argv.slice(2)) {
  const onlyArg = argv.indexOf('--only');
  const only = onlyArg >= 0 ? new Set(argv[onlyArg + 1].split(',')) : null;
  const probes = buildProbes().filter((p) => !only || only.has(p.source));
  const rows = [];
  for (const p of probes) {
    let row;
    try {
      const { failures, notes } = await p.run();
      row = { ...p, failures, notes, error: null };
    } catch (err) {
      row = { ...p, failures: [], notes: [], error: err?.message ?? String(err) };
    }
    rows.push(row);
    const status = row.error ? 'UNREACHABLE' : row.failures.length ? 'BROKEN' : 'ok';
    console.log(`[${p.source}] ${p.name}: ${status}`);
    for (const f of row.failures) console.log(`    - ${f}`);
    if (row.error) console.log(`    - ${row.error}`);
    for (const n of row.notes) console.log(`    (${n})`);
    await sleep(GAP_MS[p.source] ?? 0);
  }

  const bad = rows.filter((r) => r.error || r.failures.length);
  const summary = renderSummary(rows);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(`\n${rows.length - bad.length}/${rows.length} contracts hold.`);
  return bad.length ? 1 : 0;
}

export function renderSummary(rows) {
  const bad = rows.filter((r) => r.error || r.failures.length);
  const lines = [
    '## Upstream contract check',
    '',
    bad.length
      ? `**${bad.length} of ${rows.length} contracts broken.** Each failing row names what changed upstream; the reader code is cited in \`upstream-contract-lib.mjs\`.`
      : `All ${rows.length} contracts hold.`,
    '',
    '| Source | Check | Result | Detail |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const result = r.error ? 'unreachable' : r.failures.length ? 'BROKEN' : 'ok';
    const detail = [...r.failures, ...(r.error ? [r.error] : []), ...r.notes]
      .join('; ')
      .replaceAll('|', '\\|');
    lines.push(`| ${r.source} | ${r.name} | ${result} | ${detail} |`);
  }
  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(await main());
