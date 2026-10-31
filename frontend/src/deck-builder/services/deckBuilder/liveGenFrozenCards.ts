/**
 * Per-card freeze of Scryfall /cards/collection answers for the live panel (E1061).
 *
 * LIVE_GEN_HTTP_CACHE keys a response by its request body. A batch is 75 names, so
 * adding ONE card to the candidate pool shifts every batch after it, misses the
 * cache, and refetches live, with the day's prices (1,525 of 2,480 refetched cards
 * had a new price in the first stability run). Prices decide land and budget
 * picks, so a one-card perturbation was reading as a re-priced deck. This module
 * keeps the first answer for each card name and serves every later batch from
 * it, so a perturbed run sees the data the reference run saw.
 *
 * Only name-only identifiers are frozen ({ name }); a request with a set or id
 * goes through unchanged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

type Identifier = Record<string, string>;
interface CollectionBody {
  object: 'list';
  not_found: Array<Record<string, string>>;
  data: Array<{ name: string }>;
}

const NOT_FOUND = '__notFound';
const front = (name: string) => name.split(' // ')[0];
const keyOf = (name: string) => name.toLowerCase();

function fileFor(dir: string, name: string): string {
  return join(dir, 'frozen-cards', `${createHash('sha1').update(keyOf(name)).digest('hex')}.json`);
}

/** The names of a name-only request, or null when any identifier carries more. */
export function nameOnlyIdentifiers(body: string): string[] | null {
  let parsed: { identifiers?: Identifier[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const ids = parsed.identifiers;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const names: string[] = [];
  for (const id of ids) {
    const keys = Object.keys(id);
    if (keys.length !== 1 || keys[0] !== 'name') return null;
    names.push(id.name);
  }
  return names;
}

/** Keeps the first card seen under each requested name. */
export function freezeCards(dir: string, names: readonly string[], answer: CollectionBody): void {
  mkdirSync(join(dir, 'frozen-cards'), { recursive: true });
  const byName = new Map<string, { name: string }>();
  for (const card of answer.data) {
    byName.set(keyOf(card.name), card);
    byName.set(keyOf(front(card.name)), card);
  }
  for (const name of names) {
    const card = byName.get(keyOf(name));
    const file = fileFor(dir, name);
    if (existsSync(file)) continue;
    if (card) writeFileSync(file, JSON.stringify(card));
    else if (answer.not_found.some((n) => keyOf(n.name ?? '') === keyOf(name)))
      writeFileSync(file, JSON.stringify({ [NOT_FOUND]: true }));
  }
}

/**
 * The answer rebuilt from frozen cards, in request order. `complete` is false
 * when a name has no frozen card and was not reported not_found, in which case
 * the answer is only partial.
 */
export function thawCards(
  dir: string,
  names: readonly string[],
  answer?: CollectionBody
): { body: CollectionBody; complete: boolean } {
  const notFound = new Set((answer?.not_found ?? []).map((n) => keyOf(n.name ?? '')));
  const body: CollectionBody = { object: 'list', not_found: [], data: [] };
  let complete = true;
  for (const name of names) {
    const file = fileFor(dir, name);
    if (existsSync(file)) {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored[NOT_FOUND]) body.not_found.push({ name });
      else body.data.push(stored);
    } else if (notFound.has(keyOf(name))) body.not_found.push({ name });
    else complete = false;
  }
  return { body, complete };
}
