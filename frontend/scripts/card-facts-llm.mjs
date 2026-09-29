#!/usr/bin/env node
// The optional LLM review pass for card facts (schema.ts, pipeline step 3).
// Reviews a card's deterministic roles, interaction and extended flows with a
// Claude model in a strict JSON schema (llm.ts), caches every answer per oracle
// id + model + prompt version, and scores the result against the hand labels.
//
//   node scripts/card-facts-llm.mjs --model claude-haiku-4-5
//   node scripts/card-facts-llm.mjs --model claude-sonnet-5-5
//
// By default it runs the PILOT only: the 100-card blind holdout plus a seeded
// 200-card draw from the dev gold set (300 cards). Reruns are free: cached
// answers are reused, and an interrupted run resumes where it stopped. The
// full universe is deliberately not an option here; it needs approval first
// (see the cost estimate this prints).
//
// Key: ANTHROPIC_API_KEY from the environment, else read (never printed) from
// the primary checkout's backend/.env (--env-file to point elsewhere). The
// Anthropic SDK is the backend's (`npm install --prefix backend`), so the
// frontend takes no new dependency.
//
// Merge into a snapshot: node scripts/refresh-card-facts.mjs --offline --llm <cache file>

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CACHE_DIR, FRONTEND, importSrc, writeAtomic } from './card-facts-lib.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const MODEL = option('--model', 'claude-haiku-4-5');
const CONCURRENCY = Number(option('--concurrency', '4'));
const ENV_FILE = option(
  '--env-file',
  resolve(FRONTEND, '..', '..', 'spellcontrol', 'backend', '.env')
);
const PILOT_SEED = 512;
const DEV_DRAW = 200;

// List prices, USD per million tokens (first-party API, 2026-09): input,
// output, cache write (5-minute), cache read. The Batches API halves input and
// output.
const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};
if (!PRICES[MODEL]) throw new Error(`no price table for ${MODEL}`);

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (!existsSync(ENV_FILE)) throw new Error(`ANTHROPIC_API_KEY unset and ${ENV_FILE} not found`);
  const line = readFileSync(ENV_FILE, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*ANTHROPIC_API_KEY\s*=/.test(l));
  const key = line
    ?.split('=')
    .slice(1)
    .join('=')
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!key) throw new Error(`no ANTHROPIC_API_KEY in ${ENV_FILE}`);
  return key;
}

const requireBackend = createRequire(resolve(FRONTEND, '..', 'backend', 'package.json'));
let Anthropic;
try {
  Anthropic = (await import(pathToFileURL(requireBackend.resolve('@anthropic-ai/sdk')).href))
    .default;
} catch {
  throw new Error("the Anthropic SDK is the backend's: run `npm install --prefix backend` first");
}

const [extract, llm, bench, goldMod, holdoutMod] = await importSrc(
  'deck-builder/services/cardFacts/extract.ts',
  'deck-builder/services/cardFacts/llm.ts',
  'deck-builder/services/cardFacts/bench.ts',
  'deck-builder/services/cardFacts/gold.fixtures.ts',
  'deck-builder/services/cardFacts/gold.holdout.fixtures.ts'
);

// The pilot: every holdout card, plus a seeded draw from the dev set.
const rand = bench.mulberry32(PILOT_SEED);
const devPool = [...goldMod.GOLD];
const devDraw = [];
for (let i = 0; i < DEV_DRAW && devPool.length; i++)
  devDraw.push(devPool.splice(Math.floor(rand() * devPool.length), 1)[0]);
const pilot = [
  ...holdoutMod.HOLDOUT.map((g) => ({ g, set: 'holdout' })),
  ...devDraw.map((g) => ({ g, set: 'dev' })),
];

const cachePath = join(CACHE_DIR, `llm-${MODEL}-${llm.PROMPT_VERSION}.json`);
const cache = existsSync(cachePath)
  ? JSON.parse(await readFile(cachePath, 'utf8'))
  : { model: MODEL, promptVersion: llm.PROMPT_VERSION, cards: {} };

const client = new Anthropic({ apiKey: apiKey(), maxRetries: 4 });
const system = [{ type: 'text', text: llm.SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
// Haiku 4.5 takes temperature 0. Claude Sonnet 5.5 rejects a non-default
// temperature, and its thinking is on by default: "between_tools" turns it off
// for a single-shot classification.
const modelParams = MODEL.startsWith('claude-haiku')
  ? { temperature: 0 }
  : { thinking: { type: 'between_tools' } };

async function review(g) {
  const facts = extract.extractCardFacts(g.card, g.tags);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: llm.buildUserMessage(g.card, facts) }],
    output_config: { format: { type: 'json_schema', schema: llm.REVIEW_SCHEMA } },
    ...modelParams,
  });
  if (response.stop_reason === 'refusal') throw new Error(`${g.card.name}: refused`);
  if (response.stop_reason === 'max_tokens')
    throw new Error(`${g.card.name}: answer cut off at max_tokens`);
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text);
  if (!llm.isReview(parsed)) throw new Error(`${g.card.name}: answer failed validation`);
  const u = response.usage;
  return {
    name: g.card.name,
    review: parsed,
    usage: {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    },
  };
}

// Resumable worker pool: each answer is written to the cache as it lands.
const limit = Number(option('--limit', String(pilot.length)));
const todo = pilot.filter(({ g }) => !cache.cards[g.card.oracle_id]).slice(0, limit);
console.log(
  `[llm] ${MODEL} ${llm.PROMPT_VERSION}: ${pilot.length} pilot cards, ${todo.length} to review`
);
let failures = 0;
let next = 0;
let writing = Promise.resolve();
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
    while (next < todo.length) {
      const { g } = todo[next++];
      try {
        cache.cards[g.card.oracle_id] = await review(g);
        writing = writing.then(() => writeAtomic(cachePath, `${JSON.stringify(cache, null, 1)}\n`));
      } catch (err) {
        failures++;
        console.error(`[llm] ${err.message}`);
      }
    }
  })
);
await writing;
if (failures) console.error(`[llm] ${failures} card(s) failed; rerun to retry them`);

// ── Accuracy: deterministic vs deterministic + review, on the labeled pilot ──
// The deterministic record, then the review merged under each policy (llm.ts).
const score = (set, policy) =>
  bench.benchmark(
    pilot.filter((p) => p.set === set && cache.cards[p.g.card.oracle_id]).map((p) => p.g),
    (g) => {
      const f = extract.extractCardFacts(g.card, g.tags);
      return policy ? llm.mergeReview(f, cache.cards[g.card.oracle_id].review, policy) : f;
    }
  );
for (const set of ['holdout', 'dev']) {
  const runs = [
    ['deterministic', score(set, null)],
    ['+review tiers', score(set, 'tiers')],
    ['+review replace', score(set, 'replace')],
  ];
  console.log(
    `\n[llm] ${set} (${runs[0][1].length} cards), ${MODEL}: ${runs.map(([l]) => l).join(' | ')}`
  );
  for (const [metric, fn] of Object.entries(bench.HEADLINE)) {
    const fmt = (s) => {
      const [lo, hi] = bench.bootstrapCI(s, fn, 1000);
      return `${fn(bench.totals(s)).toFixed(3)} [${lo.toFixed(3)}, ${hi.toFixed(3)}]`;
    };
    console.log(`  ${metric.padEnd(22)} ${runs.map(([, s]) => fmt(s)).join(' | ')}`);
  }
  for (const [label, s] of runs.slice(1))
    console.log(`  error buckets ${label}: ${JSON.stringify(bench.totals(s).buckets)}`);
}

// ── Cost: measured per card, projected to the universe ──
const answered = pilot.map((p) => cache.cards[p.g.card.oracle_id]).filter(Boolean);
const sum = (k) => answered.reduce((s, a) => s + a.usage[k], 0);
const p = PRICES[MODEL];
// The Batches projection halves input and output only and prices cache
// traffic at the standard rate: an upper bound for a batched run.
const usd = (t, batch) =>
  ((t.input * p.input + t.output * p.output) * (batch ? 0.5 : 1) +
    t.cacheWrite * p.cacheWrite +
    t.cacheRead * p.cacheRead) /
  1e6;
const totals = {
  input: sum('input'),
  output: sum('output'),
  cacheWrite: sum('cacheWrite'),
  cacheRead: sum('cacheRead'),
};
const perCard = Object.fromEntries(
  Object.entries(totals).map(([k, v]) => [k, v / answered.length])
);
const snapshot = JSON.parse(await readFile(join(FRONTEND, 'public', 'card-facts.json'), 'utf8'));
const universe = snapshot.meta.cards;
console.log(
  `\n[llm] tokens per card (mean of ${answered.length}): ${JSON.stringify(Object.fromEntries(Object.entries(perCard).map(([k, v]) => [k, Math.round(v)])))}`
);
console.log(`[llm] pilot spend: $${usd(totals, false).toFixed(3)}`);
const project = (batch) =>
  usd(Object.fromEntries(Object.entries(perCard).map(([k, v]) => [k, v * universe])), batch);
console.log(
  `[llm] full universe (${universe} cards): $${project(false).toFixed(2)} standard, $${project(true).toFixed(2)} with the Batches API`
);
console.log(`[llm] cache: ${cachePath}`);
