/**
 * Public projections for shared resources. These shape the payload that goes
 * over the wire on `GET /api/shares/public/:token` — i.e. what a friend (or
 * search engine, or scraper) sees when they open a share link.
 *
 * The owner's stored shape (StoredCollection / BinderDef / Deck / ListDef in
 * the frontend, or raw JSONB on the server) carries internal fields that are
 * either noise (importId, lastReviewedSnapshot, pinnedKeys) or owner-only
 * affordances (pinned copyIds, manual order shadows). Projecting drops those
 * so the public shape is a stable, narrower contract — easy to evolve the
 * stored shape without changing what's exposed.
 *
 * Note: input shapes are typed as `unknown`-ish records because the backend
 * treats user_data as opaque JSONB (see routes/sync.ts). Projection functions
 * are defensive — missing/extra fields are tolerated; only the projected
 * fields are guaranteed.
 */

export interface PublicCard {
  name: string;
  scryfallId: string;
  oracleId?: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  finish: 'nonfoil' | 'foil' | 'etched';
  foil: boolean;
  condition?: string;
  language?: string;
  altered?: boolean;
  proxy?: boolean;
  misprint?: boolean;
  purchasePrice: number;
  cmc?: number;
  typeLine?: string;
  colorIdentity?: string[];
  colors?: string[];
  imageSmall?: string;
  imageNormal?: string;
  imageNormalBack?: string;
  layout?: string;
  manaCost?: string;
  /** Per-copy quantity is always 1 — this is a per-physical-copy shape. */
}

export interface PublicCollection {
  ownerUsername: string;
  uploadedAt?: number;
  cards: PublicCard[];
}

export interface PublicListEntry {
  name: string;
  scryfallId: string;
  setCode: string;
  collectorNumber: string;
  finish: 'nonfoil' | 'foil' | 'etched';
  oracleId?: string;
  quantity: number;
  /** Owner's note. v1 includes by design — see share-scope question. */
  note?: string;
  /** Owner's target price. v1 includes by design. */
  targetPrice?: number;
}

export interface PublicList {
  ownerUsername: string;
  id: string;
  name: string;
  entries: PublicListEntry[];
  updatedAt?: number;
}

export interface PublicDeckCard {
  /** Inline ScryfallCard from the deck slot. Owner's stored shape already
   *  carries everything we need; we pass it through minus null/undefineds. */
  card: unknown;
}

export interface PublicDeck {
  ownerUsername: string;
  id: string;
  name: string;
  format: string;
  commander: unknown;
  partnerCommander: unknown;
  cards: PublicDeckCard[];
  sideboard: PublicDeckCard[];
  color: string;
  /** Optional generator stats — kept because they're useful display, not sensitive. */
  averageSalt?: number;
  bracketEstimation?: unknown;
  deckGrade?: { letter: string; headline: string };
  updatedAt?: number;
}

type AnyRecord = Record<string, unknown>;

function asRecord(x: unknown): AnyRecord | null {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as AnyRecord) : null;
}

function asString(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

function asNumber(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

function asBool(x: unknown): boolean | undefined {
  return typeof x === 'boolean' ? x : undefined;
}

function asStringArray(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x.filter((s): s is string => typeof s === 'string');
  return out.length === x.length ? out : out;
}

function asFinish(x: unknown): 'nonfoil' | 'foil' | 'etched' {
  return x === 'foil' || x === 'etched' ? x : 'nonfoil';
}

export function projectCard(raw: unknown): PublicCard | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name = asString(r.name);
  const scryfallId = asString(r.scryfallId);
  if (!name || !scryfallId) return null;
  return {
    name,
    scryfallId,
    oracleId: asString(r.oracleId),
    setCode: asString(r.setCode) ?? '',
    setName: asString(r.setName) ?? '',
    collectorNumber: asString(r.collectorNumber) ?? '',
    rarity: asString(r.rarity) ?? '',
    finish: asFinish(r.finish),
    foil: asBool(r.foil) ?? false,
    condition: asString(r.condition),
    language: asString(r.language),
    altered: asBool(r.altered),
    proxy: asBool(r.proxy),
    misprint: asBool(r.misprint),
    purchasePrice: asNumber(r.purchasePrice) ?? 0,
    cmc: asNumber(r.cmc),
    typeLine: asString(r.typeLine),
    colorIdentity: asStringArray(r.colorIdentity),
    colors: asStringArray(r.colors),
    imageSmall: asString(r.imageSmall),
    imageNormal: asString(r.imageNormal),
    imageNormalBack: asString(r.imageNormalBack),
    layout: asString(r.layout),
    manaCost: asString(r.manaCost),
  };
}

export function projectCollection(ownerUsername: string, collection: unknown): PublicCollection {
  const r = asRecord(collection);
  const rawCards = r && Array.isArray(r.cards) ? r.cards : [];
  const cards: PublicCard[] = [];
  for (const raw of rawCards) {
    const p = projectCard(raw);
    if (p) cards.push(p);
  }
  return {
    ownerUsername,
    uploadedAt: r ? asNumber(r.uploadedAt) : undefined,
    cards,
  };
}

export function projectList(ownerUsername: string, listRaw: unknown): PublicList | null {
  const r = asRecord(listRaw);
  if (!r) return null;
  const id = asString(r.id);
  const name = asString(r.name);
  if (!id || !name) return null;
  const rawEntries = Array.isArray(r.entries) ? r.entries : [];
  const entries: PublicListEntry[] = [];
  for (const raw of rawEntries) {
    const e = asRecord(raw);
    if (!e) continue;
    const entryName = asString(e.name);
    const sid = asString(e.scryfallId);
    if (!entryName || !sid) continue;
    entries.push({
      name: entryName,
      scryfallId: sid,
      setCode: asString(e.setCode) ?? '',
      collectorNumber: asString(e.collectorNumber) ?? '',
      finish: asFinish(e.finish),
      oracleId: asString(e.oracleId),
      quantity: asNumber(e.quantity) ?? 1,
      note: asString(e.note),
      targetPrice: asNumber(e.targetPrice),
    });
  }
  return {
    ownerUsername,
    id,
    name,
    entries,
    updatedAt: asNumber(r.updatedAt),
  };
}

export function projectDeck(ownerUsername: string, deckRaw: unknown): PublicDeck | null {
  const r = asRecord(deckRaw);
  if (!r) return null;
  const id = asString(r.id);
  const name = asString(r.name);
  if (!id || !name) return null;
  // DeckCard already wraps `card: ScryfallCard` and `slotId` — for public,
  // only the card data matters (slotId is owner-side).
  const projectSlots = (xs: unknown): PublicDeckCard[] => {
    if (!Array.isArray(xs)) return [];
    const out: PublicDeckCard[] = [];
    for (const slot of xs) {
      const s = asRecord(slot);
      if (s && s.card) out.push({ card: s.card });
    }
    return out;
  };
  return {
    ownerUsername,
    id,
    name,
    format: asString(r.format) ?? 'commander',
    commander: r.commander ?? null,
    partnerCommander: r.partnerCommander ?? null,
    cards: projectSlots(r.cards),
    sideboard: projectSlots(r.sideboard),
    color: asString(r.color) ?? '#888',
    averageSalt: asNumber(r.averageSalt),
    bracketEstimation: r.bracketEstimation,
    deckGrade: (() => {
      const g = asRecord(r.deckGrade);
      if (!g) return undefined;
      const letter = asString(g.letter);
      const headline = asString(g.headline);
      return letter && headline ? { letter, headline } : undefined;
    })(),
    updatedAt: asNumber(r.updatedAt),
  };
}

/** Find a single list by id inside a stored collection blob. */
export function findListById(collection: unknown, listId: string): unknown {
  const r = asRecord(collection);
  if (!r || !Array.isArray(r.lists)) return null;
  return r.lists.find((l) => {
    const e = asRecord(l);
    return e && asString(e.id) === listId;
  });
}

/** Find a single deck by id in the decks array. */
export function findDeckById(decks: unknown, deckId: string): unknown {
  if (!Array.isArray(decks)) return null;
  return decks.find((d) => {
    const r = asRecord(d);
    return r && asString(r.id) === deckId;
  });
}
