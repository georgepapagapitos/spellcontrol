#!/usr/bin/env node
// Regenerates the pinned tagger fixture the deck-builder evals score against:
//   src/deck-builder/services/deckBuilder/__fixtures__/tagger-tags.fixture.json
//
// Why this exists: substituteFinder.eval and liftSynergy.eval both used to read
// `public/tagger-tags.json` directly. That file is git-tracked but is ALSO
// rewritten in place by refresh-tagger.mjs, which predev/prebuild run
// automatically once the snapshot ages past MAX_AGE_DAYS (30). So any dev who
// had run `npm run dev` or `npm run build` after that point scored the evals
// against different tag data than CI — the evals failed locally while CI stayed
// green, and the weights (validated; don't retune them to chase a red run) were
// never the problem.
//
// The fixture is that snapshot filtered to the card names the eval fixtures
// actually reference, which is lossless for every lookup the evals perform and
// turns 950KB into a few tens of KB.
//
// Run after regenerating public/tagger-tags.json or either eval fixture:
//   node scripts/refresh-tagger-eval-fixture.mjs
// Then re-run both evals. Re-baseline a floor only if the tag data genuinely
// moved — a changed number here is a signal, not a chore.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(
  here,
  '..',
  'src',
  'deck-builder',
  'services',
  'deckBuilder',
  '__fixtures__'
);

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const snapshot = await readJson(resolve(here, '..', 'public', 'tagger-tags.json'));

// Every card name either eval can ask the tagger about.
const needed = new Set();

// substituteFinder.eval: the card table plus every similar-list entry.
const similar = await readJson(resolve(fixtureDir, 'edhrec-similar.fixture.json'));
for (const name of Object.keys(similar.cards)) needed.add(name);
for (const names of Object.values(similar.similar)) {
  for (const name of names) needed.add(name);
}

// liftSynergy.eval: each query's commander/context/positives/distractors, plus
// every candidate inside the lift pools (tuples of [name, lift, ...]).
const lift = await readJson(resolve(fixtureDir, 'edhrec-lift.fixture.json'));
for (const q of lift.queries) {
  needed.add(q.commander);
  for (const name of [...q.context, ...q.positives, ...q.distractors]) needed.add(name);
}
for (const [poolCard, pool] of Object.entries(lift.liftPools)) {
  needed.add(poolCard);
  for (const entry of pool) needed.add(Array.isArray(entry) ? entry[0] : entry);
}

// The payload is tag -> [card names]; filtering each list to `needed` leaves
// every lookup the evals perform bit-identical.
const tags = {};
for (const [tag, names] of Object.entries(snapshot.tags)) {
  tags[tag] = names.filter((name) => needed.has(name));
}

const dest = resolve(fixtureDir, 'tagger-tags.fixture.json');
await writeFile(
  dest,
  `${JSON.stringify(
    {
      generatedAt: snapshot.generatedAt,
      note: 'Pinned subset of public/tagger-tags.json, filtered to the card names the deck-builder eval fixtures reference. Regenerate with scripts/refresh-tagger-eval-fixture.mjs.',
      tags,
    },
    null,
    2
  )}\n`
);

const kept = Object.values(tags).reduce((sum, names) => sum + names.length, 0);
console.log(
  `[tagger-eval-fixture] ${needed.size} names needed, ${Object.keys(tags).length} tags, ${kept} entries -> ${dest}`
);
