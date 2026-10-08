/**
 * Device-local map of each printing's current Scryfall image stamp, and the
 * rewrite that moves a stored image URL onto it.
 *
 * A Scryfall image URL ends in a version stamp:
 * `cards.scryfall.io/normal/front/8/1/<id>.jpg?1791120518`. Scryfall bumps the
 * stamp when it replaces an image, most often when a preview-season phone photo
 * gives way to the real scan. The CDN serves the newest file under any stamp,
 * but tells the browser to cache each URL for a year. The app stores image URLs
 * on every collection row and freezes a full Scryfall card into every deck (see
 * memory `project_deck_cards_are_frozen_cache_copies`), so a card added before
 * the swap kept its old stamp, and the browser kept the photo it already had.
 * Perplexing Chimera (SLD 7039) showed a crooked phone photo for exactly this.
 *
 * The fix is reference data like the release dates (`card-release-dates.ts`):
 * the price refresh returns each printing's stamp, `/api/cards/image-versions`
 * covers deck cards outside the collection, and the stores apply the newer
 * stamp in memory when they load. Nothing here is synced: the stored rows keep
 * their URLs, and a later local edit that persists a row carries the fresh one.
 *
 * A stamp is a Unix time, so a URL only ever moves FORWARD. A card resolved
 * after the swap already carries the newest stamp, and an older map entry must
 * never pull it back.
 */

const LS_KEY = 'spellcontrol:card-image-versions';

let cache = new Map<string, number>();
let loaded = false;

/** Load the map from localStorage into memory. Idempotent. */
export function loadImageVersions(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      cache = new Map(
        Object.entries(JSON.parse(raw) as Record<string, number>).filter(
          ([, v]) => typeof v === 'number'
        )
      );
    }
  } catch {
    cache = new Map();
  }
}

/**
 * Merge stamps (printing id → stamp string, as the server sends them) into the
 * map. Returns true when any stamp moved forward, which is the caller's cue to
 * re-apply them to the stores. Writes localStorage only on a change, since most
 * refreshes resend stamps the device already holds.
 */
export function setImageVersions(entries: Record<string, string>): boolean {
  loadImageVersions();
  let changed = false;
  for (const [id, raw] of Object.entries(entries)) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= (cache.get(id) ?? 0)) continue;
    cache.set(id, v);
    changed = true;
  }
  if (changed) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(cache)));
    } catch {
      /* quota / unavailable: the stored URL still renders, just possibly older */
    }
  }
  return changed;
}

/** Test-only: reset the in-memory map + loaded flag. */
export function _resetForTests(): void {
  cache = new Map();
  loaded = false;
}

const SCRYFALL_IMAGE =
  /^(https:\/\/cards\.scryfall\.io\/[^?]*\/([0-9a-f-]{36})\.(?:jpg|png))(?:\?(\d+))?$/;

/**
 * The URL on the newest stamp this device knows for its printing, or the URL
 * unchanged (same reference) when there is nothing newer or it isn't a Scryfall
 * card image.
 */
export function freshImageUrl<T extends string | undefined | null>(url: T): T {
  if (!url || cache.size === 0) return url;
  const m = SCRYFALL_IMAGE.exec(url);
  if (!m) return url;
  const known = cache.get(m[2]);
  if (known === undefined || known <= Number(m[3] ?? 0)) return url;
  return `${m[1]}?${known}` as T;
}

/** A Scryfall `image_uris` block with every URL freshened, or the same object. */
function freshUris<U extends object | undefined>(uris: U): U {
  if (!uris) return uris;
  let out: Record<string, unknown> | undefined;
  for (const [k, v] of Object.entries(uris)) {
    if (typeof v !== 'string') continue;
    const next = freshImageUrl(v);
    if (next !== v) (out ??= { ...uris })[k] = next;
  }
  return (out ?? uris) as U;
}

type ImageUris = Record<string, string | undefined>;

interface ScryfallImages {
  image_uris?: ImageUris;
  card_faces?: Array<{ image_uris?: ImageUris }>;
}

/** A Scryfall card with its top-level and per-face image URLs freshened. */
export function freshenScryfallCard<C extends ScryfallImages | null | undefined>(card: C): C {
  if (!card || cache.size === 0) return card;
  const uris = freshUris(card.image_uris);
  let faces = card.card_faces;
  if (faces) {
    const next = faces.map((f) => {
      const u = freshUris(f.image_uris);
      return u === f.image_uris ? f : { ...f, image_uris: u };
    });
    if (next.some((f, i) => f !== faces![i])) faces = next;
  }
  if (uris === card.image_uris && faces === card.card_faces) return card;
  const out = { ...card };
  if (uris !== card.image_uris) out.image_uris = uris;
  if (faces !== card.card_faces) out.card_faces = faces;
  return out;
}

const ENRICHED_IMAGE_FIELDS = [
  'imageSmall',
  'imageNormal',
  'imageLarge',
  'imageNormalBack',
  'imageLargeBack',
] as const;

type EnrichedImages = Partial<Record<(typeof ENRICHED_IMAGE_FIELDS)[number], string>>;

/**
 * Collection rows with their image fields freshened. Returns the input array
 * by reference when nothing moved, so a `useMemo` over it stays put.
 */
export function freshenCollectionImages<T extends EnrichedImages>(cards: T[]): T[] {
  loadImageVersions();
  if (cache.size === 0) return cards;
  let touched = false;
  const out = cards.map((card) => {
    let next: T | undefined;
    for (const field of ENRICHED_IMAGE_FIELDS) {
      const v = card[field];
      const fresh = freshImageUrl(v);
      if (fresh !== v) (next ??= { ...card })[field] = fresh as T[typeof field];
    }
    if (!next) return card;
    touched = true;
    return next;
  });
  return touched ? out : cards;
}

interface DeckImages {
  commander: ScryfallImages | null;
  partnerCommander: ScryfallImages | null;
  cards: Array<{ card: ScryfallImages }>;
  sideboard: Array<{ card: ScryfallImages }>;
  considering: Array<{ card: ScryfallImages }>;
}

function freshSlots<S extends { card: ScryfallImages }>(slots: S[] | undefined): S[] | undefined {
  if (!slots) return slots;
  let touched = false;
  const out = slots.map((s) => {
    const card = freshenScryfallCard(s.card);
    if (card === s.card) return s;
    touched = true;
    return { ...s, card };
  });
  return touched ? out : slots;
}

/**
 * Decks with every card they hold (commanders, main, sideboard, considering)
 * freshened. Same reference out when nothing moved, per deck and overall.
 */
export function freshenDeckImages<D extends DeckImages>(decks: D[]): D[] {
  loadImageVersions();
  if (cache.size === 0) return decks;
  let touched = false;
  const out = decks.map((d) => {
    const commander = freshenScryfallCard(d.commander);
    const partnerCommander = freshenScryfallCard(d.partnerCommander);
    const cards = freshSlots(d.cards);
    const sideboard = freshSlots(d.sideboard);
    const considering = freshSlots(d.considering);
    if (
      commander === d.commander &&
      partnerCommander === d.partnerCommander &&
      cards === d.cards &&
      sideboard === d.sideboard &&
      considering === d.considering
    )
      return d;
    touched = true;
    return { ...d, commander, partnerCommander, cards, sideboard, considering };
  });
  return touched ? out : decks;
}

/** Printing ids of every card the decks hold, for asking the server's stamps. */
export function deckPrintingIds(decks: DeckImages[]): string[] {
  const ids = new Set<string>();
  const add = (c: (ScryfallImages & { id?: string }) | null) => {
    if (c?.id) ids.add(c.id);
  };
  for (const d of decks) {
    add(d.commander);
    add(d.partnerCommander);
    for (const list of [d.cards, d.sideboard, d.considering])
      for (const s of list ?? []) add(s.card);
  }
  return [...ids];
}
