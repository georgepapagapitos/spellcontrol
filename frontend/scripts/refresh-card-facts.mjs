#!/usr/bin/env node
// Builds public/card-facts.json: a structured, per-card record of what every
// commander-legal card does (roles with tiers, removal/wipe/counter detail,
// clause-level trigger→effect tuples, resource flows, function strengths).
// Schema and pipeline: src/deck-builder/services/cardFacts/schema.ts.
//
// Inputs: Scryfall's oracle_cards bulk feed (one download, cached under
// node_modules/.cache/card-facts) and the committed public/tagger-tags.json.
// Deterministic: the same bulk file and tagger snapshot give a byte-identical
// output. `generatedAt` is the bulk feed's own updated_at, never the clock.
//
// NOT wired into predev/prebuild (yet): generation doesn't read it in this
// slice, and the full rebuild streams ~32k cards through the parser.
//
// Flags:
//   --force        rebuild at any age
//   --no-fetch     keep the committed snapshot whatever its age; never touch
//                  the network (ignored when --force is also passed)
//   --offline      rebuild from the newest cached bulk file, no network
//   --bulk <path>  rebuild from a specific oracle_cards .jsonl.gz file
//   --llm <path>   merge a reviewed-facts cache from card-facts-llm.mjs
//                  (only its cards change; see llm.ts)

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  FRONTEND,
  ensureBulk,
  importSrc,
  inUniverse,
  loadTagger,
  streamBulk,
  toInput,
  writeAtomic,
} from './card-facts-lib.mjs';

const MAX_AGE_DAYS = 30;
const DEST = join(FRONTEND, 'public', 'card-facts.json');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const force = flag('--force');
const noFetch = !force && flag('--no-fetch');

async function readSnapshot() {
  try {
    return JSON.parse(await readFile(DEST, 'utf8'));
  } catch {
    return null;
  }
}

const previous = await readSnapshot();
const age = previous
  ? (Date.now() - new Date(previous.meta?.generatedAt).getTime()) / 86_400_000
  : Infinity;
if (noFetch && Number.isFinite(age)) {
  console.log(`[card-facts] --no-fetch, keeping the committed snapshot (${age.toFixed(1)}d old)`);
  process.exit(0);
}
if (!force && !option('--bulk') && !flag('--offline') && age < MAX_AGE_DAYS) {
  console.log(`[card-facts] ${DEST} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping`);
  process.exit(0);
}

const bulk = await ensureBulk({ explicit: option('--bulk'), offline: flag('--offline') });
const tagger = await loadTagger();
const [extract, codec, schema] = await importSrc(
  'deck-builder/services/cardFacts/extract.ts',
  'deck-builder/services/cardFacts/codec.ts',
  'deck-builder/services/cardFacts/schema.ts'
);

const llmPath = option('--llm');
const reviews = llmPath ? JSON.parse(await readFile(llmPath, 'utf8')) : null;
const llm = reviews ? (await importSrc('deck-builder/services/cardFacts/llm.ts'))[0] : null;
if (reviews && reviews.promptVersion !== llm.PROMPT_VERSION) {
  console.error(
    `[card-facts] ${llmPath} was answered under ${reviews.promptVersion}; the current prompt is ${llm.PROMPT_VERSION}. Rerun card-facts-llm.mjs.`
  );
  process.exit(1);
}

console.log(`[card-facts] Extracting from ${bulk.file}`);
const facts = [];
let merged = 0;
for await (const card of streamBulk(bulk.path)) {
  if (!inUniverse(card)) continue;
  let f = extract.extractCardFacts(toInput(card), tagger.byName.get(card.name) ?? []);
  const review = reviews?.cards?.[card.oracle_id];
  if (review) {
    f = llm.mergeReview(f, review.review);
    merged++;
  }
  facts.push(f);
}
// Stable order: by oracle id, independent of the feed's order.
facts.sort((a, b) => (a.oracleId < b.oracleId ? -1 : a.oracleId > b.oracleId ? 1 : 0));

const meta = {
  generatedAt: bulk.updatedAt,
  sources: {
    scryfallOracleCards: { updatedAt: bulk.updatedAt, file: bulk.file },
    taggerTags: { generatedAt: tagger.generatedAt },
  },
  extractor: { version: schema.CARD_FACTS_VERSION, name: 'cardFacts/extract.ts' },
  llm: reviews
    ? { model: reviews.model, promptVersion: reviews.promptVersion, cards: merged }
    : null,
  seeds: { bootstrap: 512, holdout: 20260929 },
  universe: 'Scryfall oracle_cards with legalities.commander = legal',
  cards: facts.length,
};
const snapshot = codec.encodeSnapshot(meta, facts);

// Round trip: refuse to write a snapshot that doesn't decode to what was encoded.
let bad = 0;
snapshot.cards.forEach((c, i) => {
  if (!isDeepStrictEqual(codec.decodeCard(snapshot, c), facts[i])) {
    if (bad++ < 5) console.error(`[card-facts] Round-trip mismatch: ${facts[i].name}`);
  }
});
if (bad) {
  console.error(`[card-facts] ${bad} card(s) failed the round trip; not writing`);
  process.exit(1);
}

// A front-face key held by two records is resolved by the loader's rule; say so.
const byKey = new Map();
for (const f of facts) {
  const key = schema.factsNameKey(f.name);
  byKey.set(key, [...(byKey.get(key) ?? []), f.name]);
}
const collisions = [...byKey.values()].filter((names) => names.length > 1);
if (collisions.length)
  console.warn(
    `[card-facts] ${collisions.length} front-face key collision(s):`,
    collisions.slice(0, 10)
  );

// Written in Prettier's own format: the pre-commit hook runs Prettier over
// staged JSON, so anything else would be rewritten on commit and a rebuild
// would no longer match the committed bytes. (~1 s; brotli size unchanged
// within 4%.)
const prettier = await import('prettier');
const body = await prettier.format(JSON.stringify(snapshot), {
  ...(await prettier.resolveConfig(DEST)),
  filepath: DEST,
});
await writeAtomic(DEST, body);
const withRole = facts.filter((f) => f.roles.some((r) => r.tier !== 'incidental')).length;
console.log(
  `[card-facts] Wrote ${DEST}: ${facts.length} cards (${withRole} with a counted role), ` +
    `${(body.length / 1048576).toFixed(2)} MB` +
    (reviews ? `, ${merged} LLM-reviewed` : '')
);
