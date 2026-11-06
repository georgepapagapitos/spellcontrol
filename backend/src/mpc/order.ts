import type { ScryfallCard } from '../types';

/**
 * MPC Autofill order files (E-mpc). MPC Autofill (github.com/chilli-axe/mpc-autofill)
 * is a community index of print-ready card images plus a desktop tool that
 * uploads an order to MakePlayingCards. Its order file is an XML list of image
 * ids and the slots each fills. We pick the top-ranked image for every card so
 * a deck becomes an order in one click; the file opens in MPC Autofill's own
 * editor (mpcfill.com, "Import XML") for anyone who wants to change the art.
 *
 * The browser can't call the index itself (its CORS list names only its own
 * sites), so the route calls it from here. Nothing is stored.
 */

export const MPC_BASE = 'https://mpcfill.com';
const USER_AGENT = 'SpellControl/1.0 (+https://spellcontrol.com)';
const FETCH_TIMEOUT_MS = 20_000;

/** MakePlayingCards' order sizes. An order is priced by the smallest that fits. */
export const MPC_BRACKETS = [
  18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612,
] as const;
export const MPC_MAX_SLOTS = MPC_BRACKETS[MPC_BRACKETS.length - 1];

/** The index's own per-request caps (cardpicker/constants.py). */
const SEARCH_MAX_QUERIES = 300;
const CARDS_PAGE_SIZE = 1000;

export class MpcUnavailableError extends Error {}

export interface MpcListEntry {
  name: string;
  qty: number;
}

/**
 * Reads the `Nx Name` list the MPC export writes (deck-export.ts
 * buildMpcExport). `N Name` without the x is accepted too, so a pasted
 * MTGA/plain list works. Lines that aren't a card are skipped.
 */
export function parseMpcList(text: string): MpcListEntry[] {
  const counts = new Map<string, MpcListEntry>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)x?\s+(.+?)\s*$/i.exec(raw);
    if (!m) continue;
    const qty = Number(m[1]);
    const name = m[2];
    if (qty <= 0) continue;
    const key = name.toLowerCase();
    const prev = counts.get(key);
    if (prev) prev.qty += qty;
    else counts.set(key, { name, qty });
  }
  return [...counts.values()];
}

/** A card with a separately printed back face (transform, modal DFC, …).
 *  Split, adventure and flip cards have faces but one image, so they don't. */
export function hasPrintedBack(card: ScryfallCard | undefined): boolean {
  const faces = card?.card_faces;
  return !!faces && faces.length >= 2 && !!faces[0].image_uris && !!faces[1].image_uris;
}

export interface MpcImage {
  identifier: string;
  name: string;
  extension: string;
  searchq: string;
  sourceType?: string;
}

/** What the order is built from: one front query (and maybe a back query) per entry. */
export interface PlannedCard {
  name: string;
  qty: number;
  front: string;
  back?: string;
  /** A two-name card our cache doesn't know: its faces, tried when the
   *  whole name finds no image (a DFC the index files face by face). */
  faces?: { front: string; back: string };
}

export function planOrder(
  entries: MpcListEntry[],
  lookup: (names: string[]) => Record<string, ScryfallCard>
): PlannedCard[] {
  const twoName = entries.filter((e) => e.name.includes(' // ')).map((e) => e.name);
  const known = twoName.length > 0 ? lookup(twoName) : {};
  return entries.map((e) => {
    if (e.name.includes(' // ') && hasPrintedBack(known[e.name])) {
      const [front, back] = e.name.split(' // ');
      return { name: e.name, qty: e.qty, front: query(front), back: query(back) };
    }
    if (e.name.includes(' // ') && !known[e.name]) {
      const [front, back] = e.name.split(' // ');
      return {
        name: e.name,
        qty: e.qty,
        front: query(e.name),
        faces: { front: query(front), back: query(back) },
      };
    }
    return { name: e.name, qty: e.qty, front: query(e.name) };
  });
}

/** Every search a planned card may need, its face fallback included. */
export function queriesFor(card: PlannedCard): string[] {
  return [
    card.front,
    ...(card.back ? [card.back] : []),
    ...(card.faces ? [card.faces.front, card.faces.back] : []),
  ];
}

/** The index matches on lowercased names. */
function query(name: string): string {
  return name.trim().toLowerCase();
}

export function bracketFor(slots: number): number {
  return MPC_BRACKETS.find((b) => b >= slots) ?? MPC_MAX_SLOTS;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

export interface BuiltOrder {
  xml: string;
  /** Slots actually filled. */
  slots: number;
  /** List names with no image in the index; left out of the order. */
  missing: string[];
}

/**
 * Lays the planned cards into slots (list order, so commanders lead) and
 * writes the XML the desktop tool reads (desktop-tool/src/order.py): `<details>`,
 * `<fronts>`, `<backs>` for printed back faces, and the shared `<cardback>`.
 */
export function buildOrderXml(
  planned: PlannedCard[],
  images: Map<string, MpcImage>,
  hits: Map<string, string>,
  cardback: string | null
): BuiltOrder {
  const fronts = new Map<string, number[]>();
  const backs = new Map<string, number[]>();
  const missing: string[] = [];
  let slot = 0;
  for (const card of planned) {
    let frontId = hits.get(card.front);
    let backId = card.back ? hits.get(card.back) : undefined;
    let needsBack = !!card.back;
    if (!frontId && card.faces) {
      // Printing a DFC front with the shared cardback would be a wrong card,
      // so the fallback needs both faces or the card stays out.
      frontId = hits.get(card.faces.front);
      backId = hits.get(card.faces.back);
      needsBack = true;
    }
    if (!frontId || (needsBack && !backId)) {
      missing.push(card.name);
      continue;
    }
    for (let i = 0; i < card.qty && slot < MPC_MAX_SLOTS; i++, slot++) {
      push(fronts, frontId, slot);
      if (backId) push(backs, backId, slot);
    }
  }

  const cardXml = (id: string, slots: number[], q: string) => {
    const img = images.get(id);
    const name = img ? `${img.name}.${img.extension}` : id;
    return [
      '    <card>',
      `      <id>${esc(id)}</id>`,
      `      <sourceType>${esc(img?.sourceType ?? 'Google Drive')}</sourceType>`,
      `      <slots>${slots.join(',')}</slots>`,
      `      <name>${esc(name)}</name>`,
      `      <query>${esc(img?.searchq ?? q)}</query>`,
      '    </card>',
    ].join('\n');
  };
  const queryOf = new Map<string, string>();
  for (const [q, id] of hits) if (!queryOf.has(id)) queryOf.set(id, q);

  const section = (tag: string, map: Map<string, number[]>) =>
    map.size === 0
      ? []
      : [
          `  <${tag}>`,
          ...[...map].map(([id, slots]) => cardXml(id, slots, queryOf.get(id) ?? '')),
          `  </${tag}>`,
        ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<order>',
    '  <details>',
    `    <quantity>${slot}</quantity>`,
    `    <bracket>${bracketFor(slot)}</bracket>`,
    '    <stock>(S30) Standard Smooth</stock>',
    '    <foil>false</foil>',
    '  </details>',
    ...section('fronts', fronts),
    ...section('backs', backs),
    ...(cardback ? [`  <cardback>${esc(cardback)}</cardback>`] : []),
    '</order>',
    '',
  ].join('\n');
  return { xml, slots: slot, missing };
}

function push(map: Map<string, number[]>, id: string, slot: number) {
  const slots = map.get(id);
  if (slots) slots.push(slot);
  else map.set(id, [slot]);
}

// ── The index's API ─────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${MPC_BASE}${path}`, {
      ...init,
      headers: { ...init.headers, 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new MpcUnavailableError(`MPC Autofill unreachable: ${String(err)}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new MpcUnavailableError(`MPC Autofill answered ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

const SOURCES_TTL_MS = 24 * 60 * 60 * 1000;
let sourcesCache: { at: number; sources: [number, boolean][] } | null = null;

/** Test hook: forget the cached source list. */
export function resetMpcSourcesCache(): void {
  sourcesCache = null;
}

/** Every image source, enabled, in the index's own priority order. */
async function sources(now: number): Promise<[number, boolean][]> {
  if (sourcesCache && now - sourcesCache.at < SOURCES_TTL_MS) return sourcesCache.sources;
  const data = await call<{ results: Record<string, { pk: number }> }>('/2/sources/');
  const list = Object.values(data.results ?? {}).map((s) => [s.pk, true] as [number, boolean]);
  if (list.length === 0) throw new MpcUnavailableError('MPC Autofill listed no image sources');
  sourcesCache = { at: now, sources: list };
  return list;
}

function searchSettings(srcs: [number, boolean][]) {
  return {
    searchTypeSettings: { fuzzySearch: false, filterCardbacks: false },
    sourceSettings: { sources: srcs },
    filterSettings: {
      minimumDPI: 0,
      maximumDPI: 1500,
      maximumSize: 30,
      languages: [],
      includesTags: [],
      excludesTags: ['NSFW'],
    },
  };
}

/** Top image per query (absent when the index has none) plus the default cardback. */
export async function searchImages(
  queries: string[],
  now = Date.now()
): Promise<{ hits: Map<string, string>; images: Map<string, MpcImage>; cardback: string | null }> {
  const settings = searchSettings(await sources(now));
  const unique = [...new Set(queries)];
  const hits = new Map<string, string>();
  for (let i = 0; i < unique.length; i += SEARCH_MAX_QUERIES) {
    const batch = unique.slice(i, i + SEARCH_MAX_QUERIES);
    const data = await post<{ results: Record<string, { CARD?: string[] }> }>('/2/editorSearch/', {
      searchSettings: settings,
      queries: batch.map((q) => ({ query: q, cardType: 'CARD' })),
    });
    for (const q of batch) {
      const top = data.results?.[q]?.CARD?.[0];
      if (top) hits.set(q, top);
    }
  }

  const { cardbacks } = await post<{ cardbacks?: string[] }>('/2/cardbacks/', {
    searchSettings: settings,
  });
  const cardback = cardbacks?.[0] ?? null;

  const ids = [...new Set([...hits.values(), ...(cardback ? [cardback] : [])])];
  const images = new Map<string, MpcImage>();
  for (let i = 0; i < ids.length; i += CARDS_PAGE_SIZE) {
    const data = await post<{ results: Record<string, MpcImage> }>('/2/cards/', {
      cardIdentifiers: ids.slice(i, i + CARDS_PAGE_SIZE),
    });
    for (const [id, img] of Object.entries(data.results ?? {})) images.set(id, img);
  }
  return { hits, images, cardback };
}
