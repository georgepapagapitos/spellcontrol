// Record/replay of the Scryfall client's async lookups for deckGenerator.noEdhrec.test.ts
// (E1057). Kept out of the test file because vi.mock factories are hoisted above
// the test's own top-level state.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = resolve(here, 'no-edhrec.fixture.json.gz');
export const RECORD = !!process.env.NO_EDHREC_RECORD;

interface Fixture {
  _source: string;
  cards: Record<string, unknown>;
  /** commander name -> async client function -> JSON of its arguments -> encoded result. */
  runs: Record<string, Record<string, Record<string, unknown>>>;
}

/** The card fields the generator reads (found by trimming until the replayed
 *  decks stopped matching the full recording). Everything else Scryfall sends
 *  (art, URLs, set metadata, 20 other legalities) is dropped. */
const KEEP = [
  'id',
  'oracle_id',
  'name',
  'layout',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'colors',
  'color_identity',
  'keywords',
  'produced_mana',
  'power',
  'toughness',
  'loyalty',
  'rarity',
  'edhrec_rank',
  'game_changer',
  'games',
  'set',
  'collector_number',
  'released_at',
  'reserved',
  'finishes',
];

/** A search page is cut to this many cards (a live page is 175). */
const PAGE_CAP = 40;

const fixture: Fixture = RECORD
  ? { _source: '', cards: {}, runs: {} }
  : JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8'));
let activeRun = '';
export const setActiveRun = (name: string) => {
  activeRun = name;
};

export function saveFixture(): void {
  if (!RECORD) return;
  fixture._source =
    'Scryfall answers recorded from the live API for deckGenerator.noEdhrec.test.ts (E1057), trimmed to the card fields the generator reads, search pages cut to 40 cards.';
  writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
}

const isCard = (v: unknown): v is { id: string; oracle_id: string; type_line: string } =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as { id?: unknown }).id === 'string' &&
  typeof (v as { oracle_id?: unknown }).oracle_id === 'string' &&
  typeof (v as { type_line?: unknown }).type_line === 'string';

function trimCard(card: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEEP) if (card[k] !== undefined) out[k] = card[k];
  const legalities = card.legalities as Record<string, string> | undefined;
  if (legalities) out.legalities = { commander: legalities.commander };
  const prices = card.prices as Record<string, string | null> | undefined;
  if (prices) {
    out.prices = Object.fromEntries(
      Object.entries(prices).filter(
        ([k, v]) => v !== null && ['usd', 'usd_foil', 'eur'].includes(k)
      )
    );
  }
  if (Array.isArray(card.card_faces)) {
    out.card_faces = card.card_faces.map((f: Record<string, unknown>) => ({
      name: f.name,
      mana_cost: f.mana_cost,
      type_line: f.type_line,
      oracle_text: f.oracle_text,
      colors: f.colors,
      power: f.power,
      toughness: f.toughness,
    }));
  }
  return out;
}

function encode(value: unknown): unknown {
  if (value === undefined) return { $undef: true };
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [k, encode(v)]) };
  if (value instanceof Set) return { $set: [...value].map(encode) };
  if (isCard(value)) {
    fixture.cards[value.id] ??= trimCard(value as unknown as Record<string, unknown>);
    return { $card: value.id };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('$undef' in o) return undefined;
    if ('$card' in o) return structuredClone(fixture.cards[o.$card as string]);
    if ('$map' in o)
      return new Map((o.$map as [string, unknown][]).map(([k, v]) => [k, decode(v)]));
    if ('$set' in o) return new Set((o.$set as unknown[]).map(decode));
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

const argsKey = (args: unknown[]) =>
  JSON.stringify(args, (_k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v] : v));

/** Wrap the async functions of the Scryfall client: record them live, or replay them. */
export function wrapScryfallClient<T extends object>(actual: T): T {
  const wrapped: Record<string, unknown> = {};
  const replayed = new Set<string>(
    RECORD ? Object.keys(actual) : Object.values(fixture.runs).flatMap((run) => Object.keys(run))
  );
  for (const [name, fn] of Object.entries(actual)) {
    if (typeof fn !== 'function') continue;
    // Mutates the Map it is handed (a printing swap) and returns nothing; its
    // arguments are whole decks, so there is nothing worth recording. Both modes skip it.
    if (name === 'upgradeCardPrintings') {
      wrapped[name] = async () => undefined;
      continue;
    }
    // The one synchronous cache read: recorded like the async lookups, because
    // what it returns depends on what the live client had cached by then.
    if (name === 'getCachedCard') {
      wrapped[name] = (...args: unknown[]) => {
        const calls = ((fixture.runs[activeRun] ??= {})[name] ??= {});
        if (RECORD) {
          const encoded = encode((fn as (...a: unknown[]) => unknown)(...args));
          calls[argsKey(args)] = encoded;
          return decode(encoded);
        }
        const hit = calls[argsKey(args)];
        return hit === undefined ? undefined : decode(hit);
      };
      continue;
    }
    if (!replayed.has(name)) continue;
    wrapped[name] = (...args: unknown[]) => {
      if (RECORD) {
        const result = (fn as (...a: unknown[]) => unknown)(...args);
        if (result instanceof Promise) {
          return result.then((value) => {
            const calls = ((fixture.runs[activeRun] ??= {})[name] ??= {});
            const capped =
              name === 'searchCards' && value && Array.isArray((value as { data?: unknown[] }).data)
                ? { ...value, data: (value as { data: unknown[] }).data.slice(0, PAGE_CAP) }
                : value;
            const encoded = encode(capped);
            calls[argsKey(args)] = encoded;
            // The pipeline sees the capped, trimmed answer too, so replay reproduces the same run.
            return decode(encoded);
          });
        }
        return result;
      }
      const calls = fixture.runs[activeRun]?.[name];
      if (!calls) return Promise.resolve(undefined);
      const hit = calls[argsKey(args)];
      if (hit === undefined) {
        return Promise.reject(new Error(`unrecorded ${name}(${argsKey(args).slice(0, 160)})`));
      }
      return Promise.resolve(decode(hit));
    };
  }
  return { ...actual, ...wrapped } as T;
}
