// Derives public/keyword-glossary.json from the Comprehensive Rules bundle:
// one row per keyword ability / keyword action, carrying the sentence of its
// rule that says what it does. Card text links each keyword to this row (see
// src/lib/cards/keyword-glossary.ts), so the card panel shows a keyword's meaning
// without downloading the ~1 MB rules bundle.
//
// Pure, so refresh-rules.mjs can re-derive it on every run (including the
// no-fetch and still-fresh paths) and the file never drifts from the bundle.

import { readFile, writeFile } from 'node:fs/promises';

/**
 * Where the rule's opening sentences describe a keyword's syntax or its place
 * in the turn rather than its effect, name what to show instead: subrule
 * letters (Protection's 702.16a is how "protection from [quality]" is
 * written; b and e are what it does), or `gloss` for the glossary line when
 * it says it better than any one subrule (double strike's 702.4b walks
 * through both combat damage steps; the glossary says "deals its combat
 * damage twice").
 */
const OVERRIDES = {
  Protection: ['b', 'e'],
  Landwalk: ['c'],
  Trample: ['b'],
  Toxic: ['c'],
  Goad: ['a', 'b'],
  Banding: ['c'],
  'Double Strike': { gloss: 'double strike' },
  'First Strike': { gloss: 'first strike' },
  Gift: { gloss: 'gift' },
  'Daybound and Nightbound': { gloss: 'daybound' },
};

/**
 * Sentences that say what KIND of rule this is ("Flying is an evasion
 * ability.") or how it is printed ("It's written …"), not what it does.
 */
const CLASSIFICATION =
  /^[^.“]{1,60}\b(?:is|are) (?:an?|the) [^.]*\b(?:ability|abilities|action|term|keyword|designation)\b[^.]*\.$/;
const SYNTAX = /^It(?:’s| is) written\b/;
const says = (sentence) => !CLASSIFICATION.test(sentence) && !SYNTAX.test(sentence);

/** The CR's own definition form: “Ward [cost]” means “…”, To “scry N” means to … */
const DEFINITION = /(?:[”\]]|\b\w+) means (?:“|to\b)/;

/**
 * Split rule text into sentences. A period inside quotes (“…mana abilities.”)
 * or parentheses ends nothing; a sentence ends at a period, or at the closing
 * quote/paren right after one, when a space or the end of the text follows.
 */
export function sentences(text) {
  const out = [];
  let quote = 0;
  let paren = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '“') quote++;
    else if (c === '”') quote = Math.max(0, quote - 1);
    else if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    const endsHere =
      quote === 0 &&
      paren === 0 &&
      (c === '.' || ((c === '”' || c === ')') && /\.[’”)]*$/.test(text.slice(0, i)))) &&
      (i === text.length - 1 || text[i + 1] === ' ');
    if (endsHere) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Drop cross-references ("(See rule 509, …)", "See rule 721."): the popover links the rule itself. */
function withoutCrossRefs(text) {
  return sentences(text.replace(/\s*\([Ss]ee [^)]*\)/g, ''))
    .filter((s) => !/^(?:For more information|See rule)/.test(s))
    .join(' ');
}

const MAX_LENGTH = 360;

/** Up to four sentences, and never past MAX_LENGTH once the first is in. */
function lead(list) {
  let out = list[0];
  for (const next of list.slice(1, 4)) {
    if (out.length + 1 + next.length > MAX_LENGTH) break;
    out += ` ${next}`;
  }
  return out;
}

function subrules(rules, number) {
  const prefix = number;
  return rules.filter(
    (r) => r.number.startsWith(prefix) && /^[a-z]+$/.test(r.number.slice(prefix.length))
  );
}

/**
 * The sentence that says what a keyword does. First choice is the CR's own
 * definition (“Ward [cost]” means “…”) from the opening subrules; failing
 * that, the first subrule that isn't only a classification.
 */
export function operativeText(rules, keyword) {
  const subs = subrules(rules, keyword.rule);
  const said = (s) => sentences(withoutCrossRefs(s.text)).filter(says);
  const picks = OVERRIDES[keyword.name];
  if (Array.isArray(picks)) {
    const chosen = picks.map((letter) => subs.find((s) => s.number === keyword.rule + letter));
    if (chosen.every(Boolean)) {
      const list = chosen.flatMap(said);
      if (list.length) return lead(list);
    }
  }
  for (const s of subs.slice(0, 3)) {
    const found = sentences(withoutCrossRefs(s.text)).find((x) => DEFINITION.test(x));
    if (found) return found;
  }
  for (const s of subs.slice(0, 4)) {
    const kept = said(s);
    if (kept.length) return lead(kept);
  }
  return null;
}

/** "A keyword ability that … See rule 702.9, “Flying.”" → "A keyword ability that …" */
function cleanGloss(definition) {
  return sentences(definition)
    .filter((s) => !/^See rules?\b/.test(s))
    .join(' ')
    .trim();
}

export function deriveKeywordGlossary(bundle) {
  const glossary = new Map(bundle.glossary.map((g) => [g.term.toLowerCase(), g.definition]));
  const keywords = [];
  for (const k of bundle.keywords) {
    const pinned = OVERRIDES[k.name]?.gloss;
    const gloss = glossary.get(pinned ?? k.name.toLowerCase());
    const text =
      (pinned && gloss ? cleanGloss(gloss) : null) ??
      operativeText(bundle.rules, k) ??
      (gloss ? cleanGloss(gloss) : null);
    if (!text) continue;
    keywords.push({ name: k.name, rule: k.rule, kind: k.kind, text });
  }
  return {
    meta: { effective: bundle.meta.effective, fetchedAt: bundle.meta.fetchedAt },
    keywords,
  };
}

/** Re-derive `out` from the bundle at `rulesPath`; writes only when the content changed. */
export async function writeKeywordGlossary(rulesPath, out) {
  const bundle = JSON.parse(await readFile(rulesPath, 'utf8'));
  const next = JSON.stringify(deriveKeywordGlossary(bundle));
  const prev = await readFile(out, 'utf8').catch(() => null);
  if (prev === next) return false;
  await writeFile(out, next);
  const kb = (next.length / 1024).toFixed(0);
  console.log(`[rules] Wrote ${out} (${kb} KB)`);
  return true;
}
