#!/usr/bin/env node
// Parses the official Magic Comprehensive Rules .txt into a structured JSON
// bundle in public/ so the Rules Reference (keywords / glossary / full rules
// search) works fully offline. Run manually via `npm run refresh-rules`, or
// auto-invoked by predev/prebuild if the local copy is missing or stale.
//
// Pass --force to re-fetch/re-parse unconditionally.
//
// The CR txt URL is dated per release (~quarterly). We auto-discover the latest
// from the WotC rules page (it serves the dated .txt href in static HTML), and
// fall back to FALLBACK_URL if discovery fails. Set RULES_SOURCE_URL to pin a
// specific release without touching the network discovery.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_PAGE = 'https://magic.wizards.com/en/rules';
const FALLBACK_URL = 'https://media.wizards.com/2026/downloads/MagicCompRules%2020260417.txt';
const MAX_AGE_DAYS = 30;

// Scrape the rules page for the dated CR .txt link; href carries a literal
// space ("MagicCompRules 20260417.txt") that fetch needs percent-encoded.
async function discoverLatest() {
  try {
    const res = await fetch(RULES_PAGE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const m = html.match(
      /https:\/\/media\.wizards\.com\/\d{4}\/downloads\/MagicCompRules[^"<]*\.txt/i
    );
    return m ? m[0].replace(/ /g, '%20') : null;
  } catch (err) {
    console.warn(`[rules] Auto-discovery failed (${err.message}), using FALLBACK_URL`);
    return null;
  }
}

const force = process.argv.includes('--force');

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'public', 'comprehensive-rules.json');

async function ageDays(path) {
  // Age from the bundle's own meta.fetchedAt, NOT file mtime: the file is
  // git-tracked, so checkout / Docker COPY resets mtime and the mtime check
  // reads "fresh" in every clean build — prod shipped the April CR while the
  // June one was out (same bug as tagger-tags.json, fixed in #1181). Bundles
  // written before the stamp existed have no fetchedAt → refetch once.
  try {
    const fetchedAt = new Date(JSON.parse(await readFile(path, 'utf8')).meta?.fetchedAt).getTime();
    if (Number.isFinite(fetchedAt)) return (Date.now() - fetchedAt) / 86_400_000;
  } catch {
    // unreadable/unparseable → treat as missing and refetch
  }
  return Infinity;
}

const age = await ageDays(dest);
if (!force && age < MAX_AGE_DAYS) {
  console.log(`[rules] ${dest} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping`);
  process.exit(0);
}

const SOURCE_URL = process.env.RULES_SOURCE_URL ?? (await discoverLatest()) ?? FALLBACK_URL;
console.log(`[rules] Fetching ${SOURCE_URL}`);
let text;
try {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  text = await res.text();
} catch (err) {
  if (Number.isFinite(age)) {
    console.warn(
      `[rules] Fetch failed (${err.message}), keeping snapshot (${age.toFixed(1)}d old)`
    );
    process.exit(0);
  }
  console.error(`[rules] Fetch failed and no local copy exists: ${err.message}`);
  process.exit(1);
}

const bundle = parse(text, SOURCE_URL);
await writeFile(dest, JSON.stringify(bundle));
const kb = (JSON.stringify(bundle).length / 1024).toFixed(0);
console.log(
  `[rules] Wrote ${dest} (${kb} KB) — ${bundle.rules.length} rules, ` +
    `${bundle.glossary.length} glossary terms, ${bundle.keywords.length} keywords`
);

// --- parser ---------------------------------------------------------------

function parse(raw, source) {
  // Strip BOM + carriage returns (the file ships CRLF from WotC).
  const lines = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split('\n');

  // The document is: intro, table of contents, rules body, glossary, credits.
  // Section/subsection headers appear in BOTH the TOC and the body, so anchor
  // on the LAST occurrence of each landmark to skip past the TOC.
  const lastIndexOf = (pred) => {
    for (let i = lines.length - 1; i >= 0; i--) if (pred(lines[i])) return i;
    return -1;
  };
  const bodyStart = lastIndexOf((l) => l === '1. Game Concepts');
  const glossaryStart = lastIndexOf((l) => l === 'Glossary');
  const creditsStart = lastIndexOf((l) => l === 'Credits');
  if (bodyStart < 0 || glossaryStart < 0 || creditsStart < 0) {
    throw new Error('Could not locate document landmarks — CR format may have changed');
  }

  const effective = (raw.match(/effective as of (.+?)\./) ?? [])[1] ?? 'unknown';

  const sections = [];
  const rules = [];
  // Body: lines [bodyStart, glossaryStart). Each rule/subrule is on one line.
  for (let i = bodyStart; i < glossaryStart; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^([1-9])\. (.+)$/))) {
      sections.push({ number: m[1], title: m[2] });
    } else if ((m = line.match(/^(\d{3}\.\d+[a-z]*)\.?\s+(.+)$/))) {
      rules.push({ number: m[1], text: m[2] });
    }
    // Bare subsection headers ("100. General") are implied by their rules;
    // we don't store them separately.
  }

  // Keywords: §701 keyword actions + §702 keyword abilities. The heading line
  // ("702.2. Deathtouch") names the keyword; its body is the 702.2x subrules,
  // which already live in `rules` (so we just index into them — no dupes).
  const keywords = [];
  for (const r of rules) {
    const m = r.number.match(/^(70[12])\.(\d+)$/);
    // A heading has no letter suffix; intros (701.1/702.1) are prose with
    // periods — keyword names never contain a period.
    if (m && !r.text.includes('.') && r.text.length < 60) {
      keywords.push({
        name: r.text,
        rule: r.number,
        kind: m[1] === '701' ? 'action' : 'ability',
      });
    }
  }

  // Glossary: blank-line-separated blocks; first line is the term, the rest is
  // the definition.
  const glossary = [];
  let block = [];
  const flush = () => {
    if (block.length >= 2) {
      glossary.push({ term: block[0].trim(), definition: block.slice(1).join(' ').trim() });
    }
    block = [];
  };
  for (let i = glossaryStart + 1; i < creditsStart; i++) {
    const line = lines[i];
    if (line.trim() === '') flush();
    else block.push(line);
  }
  flush();

  return {
    meta: { effective, source, fetchedAt: new Date().toISOString() },
    sections,
    rules,
    glossary,
    keywords,
  };
}
