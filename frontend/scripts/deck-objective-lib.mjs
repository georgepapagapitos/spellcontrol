// Shared plumbing for the whole-deck objective's offline scripts
// (deck-objective-eval.mjs, deck-objective-optimize.mjs): replaying the
// panels' HTTP cache (live only under the shared lock), loading the objective
// in ONE module graph, EDHREC pages and lift pools through the app's own
// client, and full card records from Scryfall's oracle_cards bulk file.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FRONTEND, ensureBulk, streamBulk } from './card-facts-lib.mjs';

export { FRONTEND };
export const DEV_ROOT = resolve(FRONTEND, '..', '..');
export const DEFAULT_HTTP_CACHE = join(DEV_ROOT, '.deckgen-http-cache');
export const LOCK = join(DEV_ROOT, '.deckgen-live.lock');
export const DEFAULT_OWNED = join(
  FRONTEND,
  'src',
  'deck-builder',
  'services',
  'deckBuilder',
  '__fixtures__',
  'owned-collection.fixture.json'
);

/**
 * Replace global fetch: the tagger snapshot from public/, everything else
 * from the HTTP cache (keyed like the LIVE_GEN harness), and on a miss either
 * a 404 or, with `live`, a real fetch under the shared lock that is written
 * back to the cache. Returns the counters and a cache probe.
 */
export function installNetwork({ httpCache, live, owner }) {
  let lockHeld = false;
  const acquireLock = () => {
    if (lockHeld) return;
    // Same protocol as the lanes' shell loop: mkdir is atomic.
    for (;;) {
      try {
        mkdirSync(LOCK);
        break;
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
      }
    }
    writeFileSync(join(LOCK, 'owner'), owner);
    lockHeld = true;
  };
  const release = () => {
    if (lockHeld) rmSync(LOCK, { recursive: true, force: true });
    lockHeld = false;
  };
  process.on('exit', release);

  const stats = { hits: 0, misses: 0, live: 0 };
  const realFetch = globalThis.fetch;
  const taggerJson = readFileSync(join(FRONTEND, 'public', 'tagger-tags.json'), 'utf8');
  globalThis.fetch = async (input, init) => {
    let url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/tagger-tags.json')) return new Response(taggerJson, { status: 200 });
    // The harness is imported in production mode, so the client calls the real
    // host; a dev-mode import would call the dev proxy path, keyed the same way.
    if (url.startsWith('/edhrec-api'))
      url = `https://json.edhrec.com${url.slice('/edhrec-api'.length)}`;
    const key = createHash('sha1')
      .update(`${init?.method ?? 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`)
      .digest('hex');
    const file = join(httpCache, `${key}.json`);
    if (existsSync(file)) {
      stats.hits++;
      const hit = JSON.parse(readFileSync(file, 'utf8'));
      return new Response(hit.body, { status: hit.status });
    }
    stats.misses++;
    if (!live) return new Response('{"error":"not in the HTTP cache"}', { status: 404 });
    acquireLock();
    stats.live++;
    const res = await realFetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), 'User-Agent': 'SpellControl-DeckObjective/1.0' },
    });
    if (res.ok || res.status === 404) {
      const body = await res.text();
      mkdirSync(httpCache, { recursive: true });
      writeFileSync(file, JSON.stringify({ status: res.status, body }));
      return new Response(body, { status: res.status });
    }
    return res;
  };
  const cacheHas = (url) =>
    existsSync(join(httpCache, `${createHash('sha1').update(`GET ${url} `).digest('hex')}.json`));
  return { stats, cacheHas, release, live };
}

/**
 * The objective, in ONE module graph (harness.ts says why), with the card
 * facts snapshot and the tagger loaded. card-facts-lib's importSrc aliases
 * only deck-metrics; the objective reaches the other two shared packages
 * too, and their ESM dist is bundler-only, so all three resolve to source.
 */
export async function loadHarness() {
  // Vite derives import.meta.env.DEV from NODE_ENV, not the mode alone.
  process.env.NODE_ENV = 'production';
  const { runnerImport } = await import('vite');
  const pkg = (name) => join(FRONTEND, '..', 'packages', name, 'src', 'index.ts');
  const config = {
    configFile: false,
    root: FRONTEND,
    logLevel: 'error',
    // Production: the clients call the real API hosts (not the dev proxy) and
    // the logger's debug chatter stays quiet, as in the shipped app.
    mode: 'production',
    resolve: {
      alias: {
        '@spellcontrol/deck-metrics': pkg('deck-metrics'),
        '@spellcontrol/binder-routing': pkg('binder-routing'),
        '@spellcontrol/game-core': pkg('game-core'),
        '@': join(FRONTEND, 'src'),
      },
    },
  };
  const entry = join(
    FRONTEND,
    'src',
    'deck-builder',
    'services',
    'deckBuilder',
    'deckObjective',
    'harness.ts'
  );
  const H = (await runnerImport(entry, config)).module;
  H.setCardFactsSnapshot(
    JSON.parse(readFileSync(join(FRONTEND, 'public', 'card-facts.json'), 'utf8'))
  );
  await H.loadTaggerData();
  if (!H.hasTaggerData()) throw new Error('tagger snapshot did not load');
  return H;
}

export function readOwned(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return new Set(Array.isArray(parsed) ? parsed : parsed.names);
}

/** The EDHREC page a dump's generation read, through the app's client. */
export async function pageRows(H, dump) {
  const page = H.dumpPage(dump);
  const attempts = [];
  if (page.partner) {
    if (page.theme)
      attempts.push(() =>
        H.fetchPartnerThemeData(
          page.commander,
          page.partner,
          page.theme,
          page.budgetOption,
          page.targetBracket
        )
      );
    attempts.push(() =>
      H.fetchPartnerCommanderData(
        page.commander,
        page.partner,
        page.budgetOption,
        page.targetBracket
      )
    );
  } else {
    if (page.theme)
      attempts.push(() =>
        H.fetchCommanderThemeData(page.commander, page.theme, page.budgetOption, page.targetBracket)
      );
    attempts.push(() =>
      H.fetchCommanderData(page.commander, page.budgetOption, page.targetBracket)
    );
  }
  // The generator falls back to the base page when a filtered page is missing.
  attempts.push(() => H.fetchCommanderData(page.commander));
  let lastError;
  for (const [i, attempt] of attempts.entries()) {
    try {
      const data = await attempt();
      const rows = H.edhrecRowsFrom(data);
      if (rows.size > 0) return { rows, data, fallback: i > 0 && i === attempts.length - 1 };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`no EDHREC page for ${dump.commander}: ${lastError?.message ?? 'empty'}`);
}

/**
 * E71 lift pools for seeds (card names): only card pages already in the cache,
 * plus the commanders' own when live.
 */
export async function liftPools(H, net, commanders, seeds) {
  const pools = new Map();
  for (const name of [...new Set([...commanders, ...seeds])]) {
    const url = `https://json.edhrec.com/pages/cards/${H.formatCommanderNameForUrl(name)}.json`;
    if (!net.cacheHas(url) && !(net.live && commanders.includes(name))) continue;
    const pool = await H.fetchCardLiftPool(name);
    if (pool.length) pools.set(name, pool);
  }
  return pools;
}

/**
 * Full Scryfall records for `names` (straightened apostrophes, front faces
 * resolved) and the global EDHREC rank of every name in `rankNames`, in one
 * pass over the oracle_cards bulk file. Tokens, emblems and art cards share
 * names with real cards (a "Llanowar Elves" token exists), so they are
 * skipped and a commander-legal record wins. `required` names must resolve.
 */
export async function resolveCards(H, { names, rankNames, required, bulkPath }) {
  const front = (n) => n.split(' // ')[0];
  const want = new Set([...names].map((n) => H.straightQuotes(n)));
  const wantFront = new Set([...want].map(front));
  const rank = new Map();
  const bulk = await ensureBulk({ explicit: bulkPath, offline: true });
  const byName = new Map();
  const byFront = new Map();
  const better = (prev, c) =>
    !prev || (prev.legalities?.commander !== 'legal' && c.legalities?.commander === 'legal');
  for await (const c of streamBulk(bulk.path)) {
    if (/token|emblem|art_series/.test(c.layout ?? '')) continue;
    if (c.edhrec_rank && (rankNames.has(c.name) || rankNames.has(front(c.name)))) {
      rank.set(c.name, c.edhrec_rank);
      rank.set(front(c.name), c.edhrec_rank);
    }
    if (want.has(c.name)) {
      if (better(byName.get(c.name), c)) byName.set(c.name, c);
    } else if (wantFront.has(front(c.name)) && better(byFront.get(front(c.name)), c)) {
      byFront.set(front(c.name), c);
    }
  }
  for (const [k, c] of byFront) if (!byName.has(k)) byName.set(k, c);
  const missing = [...(required ?? [])]
    .map((n) => H.straightQuotes(n))
    .filter((n) => !byName.has(n) && !byName.has(front(n)));
  if (missing.length) throw new Error(`not in ${bulk.file}: ${missing.join(', ')}`);
  return { byName, rank, bulkFile: bulk.file };
}

const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/**
 * Every generator deck in a panel directory, ready to score or search: its
 * dump and EDHREC page, the seed deck, the candidate pool (the page's cards,
 * the owned cards for a collection build, the identity's basics) and the
 * objective context built from the dump's own settings. One bulk pass for all.
 */
export async function loadPanelRuns(H, net, { panel, only, owned, bulk }) {
  const files = readdirSync(panel)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json' && !f.startsWith('report'))
    .filter((f) => !only || only.some((o) => f.includes(o)))
    .sort();
  const decks = [];
  for (const f of files) {
    const dump = JSON.parse(readFileSync(join(panel, f), 'utf8'));
    decks.push({ slug: f.replace(/\.json$/, ''), dump, page: await pageRows(H, dump) });
  }
  const names = new Set(Object.values(BASICS));
  const required = new Set();
  const rankNames = new Set();
  for (const d of decks) {
    for (const n of [d.dump.commander, ...(d.dump.partner ? [d.dump.partner] : [])]) {
      names.add(n);
      required.add(n);
    }
    for (const c of H.dumpCards(d.dump)) {
      names.add(c.name);
      required.add(c.name);
    }
    for (const n of d.page.rows.keys()) {
      names.add(n);
      rankNames.add(n);
    }
    if (d.dump.customization.collectionMode) for (const n of owned) names.add(n);
  }
  const { byName, rank, bulkFile } = await resolveCards(H, {
    names,
    rankNames,
    required,
    bulkPath: bulk,
  });
  const runs = [];
  for (const d of decks) {
    const { dump, page } = d;
    const seed = H.deckFromDump(dump, byName);
    const commanders = seed.commanders.map((c) => c.name);
    const cz = dump.customization;
    const ownedNames = cz.collectionMode ? owned : undefined;
    const candidateNames = new Set([
      ...page.rows.keys(),
      ...(ownedNames ? [...ownedNames] : []),
      ...dump.colorIdentity.map((c) => BASICS[c]).filter(Boolean),
    ]);
    if (dump.colorIdentity.length === 0) candidateNames.add('Wastes');
    const candidates = [...candidateNames]
      .map((n) => H.resolveName(byName, n))
      .filter((c) => c && c.legalities?.commander === 'legal');
    const ctx = H.createObjectiveContext({
      colorIdentity: dump.colorIdentity,
      customization: cz,
      edhrec: page.rows,
      roleTargets: dump.roleTargets ?? {},
      pacing: dump.detectedPacing,
      combos: H.combosOf(dump),
      liftPools: await liftPools(
        H,
        net,
        commanders,
        seed.cards.map((c) => c.name)
      ),
      globalRank: rank,
      ownedNames,
    });
    runs.push({ ...d, seed, candidates, ctx, byName });
  }
  return { runs, bulkFile };
}
