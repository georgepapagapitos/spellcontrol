#!/usr/bin/env node
// Builds public/idea-index.json: the closed list of deck ideas the generator starts from. Every
// EDHREC tag with enough decks and enough commanders, sorted into creature types (matched against
// Scryfall's creature-types catalog) and ways to play, plus the search aliases.
//
//   node scripts/refresh-idea-index.mjs            # skips when the snapshot is under 30 days old
//   node scripts/refresh-idea-index.mjs --force    # re-fetch unconditionally
//   node scripts/refresh-idea-index.mjs --no-fetch # never touch the network (prebuild)
//
// One tag list, one Scryfall catalog, then one EDHREC tag page per tag over MIN_DECKS (about 270),
// two at a time with a pause, a User-Agent, and a backoff on 429. A weekly job, so politeness over
// speed. The file is committed and shipped; the refresh-snapshots workflow re-runs it on schedule.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aliasesFor, buildIdeas, MIN_DECKS, slugOfUrl } from './idea-index-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(here, '..', 'public', 'idea-index.json');
const MAX_AGE_DAYS = 30;
// A refresh that loses more than this share of the ideas is a truncated fetch, not news.
const MAX_SHRINK_RATIO = 0.3;
const CONCURRENCY = 2;
const PAUSE_MS = 150;
const UA = 'SpellControl-IdeaIndexRefresh/1.0 (github.com/spellcontrol)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    // EDHREC answers 403 (S3) or 404 for a tag it has no page for: no page, not a failure.
    if (res.status === 404 || res.status === 403) return null;
    await sleep(res.status === 429 ? 60_000 : 2000 * (i + 1));
  }
  throw new Error(`${url} kept failing`);
}

/** The Top Commanders list off a tag page: how many, and the first one's name (the tile's art). */
export function commandersOfTagPage(page) {
  const lists = page?.container?.json_dict?.cardlists ?? [];
  const list =
    lists.find((c) => c.tag === 'topcommanders') ??
    lists.find((c) => /top commanders/i.test(c.header ?? ''));
  // Partner pairs ("A // B") are not single commanders; the app's tag client drops them too.
  const views = (list?.cardviews ?? []).filter((v) => !String(v.name).includes('//'));
  return { commanders: views.length, top: views[0]?.name ?? null };
}

async function build() {
  const tagList = await getJson('https://json.edhrec.com/pages/tags.json');
  const tags = tagList?.container?.json_dict?.cardlists?.[0]?.cardviews ?? [];
  if (tags.length < 100) throw new Error(`only ${tags.length} tags came back`);
  const creatureTypes =
    (await getJson('https://api.scryfall.com/catalog/creature-types'))?.data ?? [];
  if (creatureTypes.length < 100) throw new Error(`only ${creatureTypes.length} creature types`);

  const candidates = tags.filter((t) => t.num_decks >= MIN_DECKS);
  console.log(
    `[idea-index] ${tags.length} tags, ${candidates.length} over ${MIN_DECKS} decks; reading pages…`
  );
  const pages = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < candidates.length) {
        const t = candidates[next++];
        const slug = slugOfUrl(t.url);
        const page = await getJson(`https://json.edhrec.com/pages/tags/${slug}.json`);
        pages.set(slug, page ? commandersOfTagPage(page) : null);
        await sleep(PAUSE_MS);
      }
    })
  );
  const { ideas } = buildIdeas(tags, pages, creatureTypes);
  return { ideas, tagCount: tags.length };
}

async function main() {
  const force = process.argv.includes('--force');
  const noFetch = process.argv.includes('--no-fetch');
  let existing = null;
  try {
    existing = JSON.parse(await readFile(DEST, 'utf8'));
  } catch {
    /* none yet */
  }
  const stamp = existing ? new Date(existing.generatedAt).getTime() : NaN;
  // Age from the file's own generatedAt: mtime resets on checkout.
  const age = Number.isFinite(stamp) ? (Date.now() - stamp) / 86_400_000 : Infinity;
  if (noFetch && existing) {
    console.log(`[idea-index] --no-fetch, keeping the committed snapshot (${age.toFixed(1)}d old)`);
    return;
  }
  if (!force && age < MAX_AGE_DAYS) {
    console.log(
      `[idea-index] ${DEST} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping refresh`
    );
    return;
  }
  try {
    const { ideas, tagCount } = await build();
    const prev = existing?.ideas?.length ?? 0;
    if (prev > 0 && ideas.length < prev * (1 - MAX_SHRINK_RATIO)) {
      throw new Error(`idea count shrank ${prev} -> ${ideas.length}; refusing to write it`);
    }
    if (ideas.length < 50) throw new Error(`only ${ideas.length} ideas survived`);
    const out = {
      generatedAt: new Date().toISOString(),
      source:
        'json.edhrec.com/pages/tags.json and /pages/tags/{slug}.json, Scryfall creature-types',
      minDecks: MIN_DECKS,
      aliases: aliasesFor(ideas.map((i) => i.slug)),
      ideas,
    };
    await mkdir(dirname(DEST), { recursive: true });
    await writeFile(DEST, `${JSON.stringify(out)}\n`);
    const typal = ideas.filter((i) => i.kind === 'typal').length;
    console.log(
      `[idea-index] wrote ${ideas.length} ideas (${typal} typal, ${ideas.length - typal} playstyle, ${tagCount - ideas.length} dropped) -> ${DEST}`
    );
  } catch (e) {
    // A stale snapshot beats none: keep the shipped file and say so.
    console.warn(`[idea-index] refresh failed (${e.message}); keeping the existing snapshot`);
    if (!existing) process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
