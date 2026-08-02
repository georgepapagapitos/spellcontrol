// Pure data helpers for DeckDisplay: row aggregation, sorting, grouping, and
// small string/lookup helpers that take data in and return data out (no
// JSX). Split out of DeckDisplay.tsx (was 5427 lines) purely to shrink the
// file — no logic changes. See deck-display-icons.tsx for the sibling
// JSX-returning helpers (SectionIcon, FoilShimmer, AllocationChip).
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import { classifyCardCategory } from '@/deck-builder/services/deckBuilder/categorize';
import { cardTagsOf, isTagsEdited } from '@/lib/deck-tags';
import { classifyType, type TypeGroup } from '@/lib/build-mana-data';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { typeIcon } from '../../lib/card-types';
import { COLOR_INFO } from '../../lib/colors';
import { classifyFoil } from '../../lib/foil-style';
import {
  classifyAllocation,
  BASIC_LAND_NAMES,
  type AllocationInfo,
  type AllocationStatus,
} from '../../lib/allocations';
import type { EnrichedCard } from '../../types';
import { COMMANDER_SLOT_ID, PARTNER_COMMANDER_SLOT_ID } from '../../lib/deck-validation';
import { rolesForCard, ROLE_TITLES, type RoleKey } from '../../lib/role-badges';
import { effectiveSortIndex } from '@/lib/deck-reorder';
import type { DeckDisplayCard } from './DeckDisplay';

/**
 * Resolves a card's EDHREC inclusion % against the deck's `cardInclusionMap`,
 * normalizing "no signal" so downstream renders can trust `classifyInclusion`
 * without re-deriving basic-land/no-data exclusions:
 *
 * - No map at all (deck never ran EDHREC analysis — manual/imported decks, or
 *   an old deck predating this field) → `undefined`, so the chip renders
 *   nothing. We genuinely never checked, so "Off-meta" would overclaim.
 * - A basic land → `undefined` too; the generator excludes basics from the
 *   map by design (they're never scored as a "card" by EDHREC), so absence
 *   there isn't a signal either.
 * - A command-zone row → `undefined`; inclusion % is measured *relative to*
 *   the commander, so the concept doesn't apply to the commander/partner
 *   themselves (they'd otherwise read "Off-meta", which is absurd — they ARE
 *   the meta the map is keyed against).
 * - Otherwise, a card missing from a present map is real "no signal" and
 *   normalizes to `0` so it renders "Off-meta" instead of going blank.
 */
export function resolveInclusionPct(
  cardInclusionMap: Record<string, number> | undefined,
  row: Pick<Row, 'name' | 'legalitySlotKey'>
): number | undefined {
  const isCommandZone =
    row.legalitySlotKey === COMMANDER_SLOT_ID || row.legalitySlotKey === PARTNER_COMMANDER_SLOT_ID;
  if (!cardInclusionMap || isCommandZone || BASIC_LAND_NAMES.has(row.name)) return undefined;
  return cardInclusionMap[row.name] ?? 0;
}

/**
 * Top-level roles for the role-filter lens: the tagger's read plus the
 * generator's enriched `deckRole` (manual decks have no `deckRole`; on
 * generated decks it can cover a card the tagger misses — include it so the
 * lens never dims a row whose visible badge matches the active pill).
 */
export function cardFilterRoles(card: ScryfallCard): RoleKey[] {
  const roles = rolesForCard(card);
  const enriched = card.deckRole as RoleKey | undefined;
  return enriched && enriched in ROLE_TITLES && !roles.includes(enriched)
    ? [...roles, enriched]
    : roles;
}

// ── Canonical card-type grouping ──────────────────────────────────────────
// classifyType / TypeGroup live in lib/build-mana-data (shared with the
// deck-compare page); DISPLAY_ORDER is DeckDisplay's own row ordering.
const DISPLAY_ORDER: TypeGroup[] = [
  'Planeswalker',
  'Creature',
  'Artifact',
  'Enchantment',
  'Instant',
  'Sorcery',
  'Battle',
  'Land',
];

// ── Category grouping (E124) ────────────────────────────────────────────
// Buckets the generator's own 8-bucket DeckCategory shape, so a generated
// deck's shape explains itself against the targets it was built to. See
// `groupByCategory` below.
export const CATEGORY_DISPLAY_ORDER: DeckCategory[] = [
  'lands',
  'ramp',
  'cardDraw',
  'singleRemoval',
  'boardWipes',
  'creatures',
  'synergy',
  'utility',
];

// Reuses ROLE_TITLES for the 4 role-derived buckets so the label matches the
// row badges/legend exactly; the other 4 (type or catch-all buckets) get
// their own title here.
export const CATEGORY_TITLES: Record<DeckCategory, string> = {
  lands: 'Lands',
  ramp: ROLE_TITLES.ramp,
  cardDraw: ROLE_TITLES.cardDraw,
  singleRemoval: ROLE_TITLES.removal,
  boardWipes: ROLE_TITLES.boardwipe,
  creatures: 'Creatures',
  synergy: 'Synergy',
  utility: 'Utility',
};

// ── Helpers ───────────────────────────────────────────────────────────────
export type CurrencyCode = 'USD' | 'EUR';

export function priceOf(card: ScryfallCard, currency: CurrencyCode): number {
  const raw = getCardPrice(card, currency);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// Role-badge data + decoding (ROLE_BADGE_BY_TONE, getRoleBadge,
// multiRoleTitle, …) lives in lib/role-badges so the deck list, grid
// tiles, toolbar legend, tap-to-reveal popover, and card preview panel
// all share one source of truth. See the `role-badges` import above.

export function frontFaceMana(card: ScryfallCard): string | undefined {
  return card.mana_cost ?? card.card_faces?.[0]?.mana_cost;
}

// 'custom' (E172) is the manual drag-order mode — an explicit, visible sort
// choice (never a silent side effect of dragging while another mode is
// selected; see DeckCardRow's drag handle, only rendered when sort==='custom').
export type SortMode = 'name' | 'cmc' | 'price' | 'color' | 'added' | 'custom';

// ── View mode + show prefs ───────────────────────────────────────────────
// Mirrors the reference EDH builder's Sort | Show | Search | View toolbar:
//  - View mode picks the deck rendering (list / grid of images / plaintext).
//  - Show prefs hide row metadata the user does not want in their face
//    (price, role badges, mana cost).
// All persisted to localStorage so the deck the user opened yesterday looks
// the way they left it.
// Decks intentionally don't expose a "compact" list mode — the deck row
// is already text-only and tight, so a denser variant would be visually
// indistinguishable from the regular list.
export type DeckViewMode = 'list' | 'grid';

export interface ShowPrefs {
  price: boolean;
  roles: boolean;
  mana: boolean;
}

export const VIEW_MODE_STORAGE_KEY = 'mtg-decks-view-mode';
export const SHOW_PREFS_STORAGE_KEY = 'mtg-decks-show-prefs';

export const DEFAULT_SHOW_PREFS: ShowPrefs = { price: true, roles: true, mana: true };

export function readStoredViewMode(): DeckViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const v = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === 'list' || v === 'grid') return v;
    // Migrate dropped modes ('compact', 'text') → 'list' for any
    // persisted value.
    if (v === 'compact' || v === 'text') return 'list';
  } catch {
    /* ignore */
  }
  // No explicit choice on record (E127) — default posture is card-forward
  // grid (list ships with zero card art). An explicit persisted 'list'
  // above always wins.
  return 'grid';
}

export function readStoredShowPrefs(): ShowPrefs {
  if (typeof window === 'undefined') return DEFAULT_SHOW_PREFS;
  try {
    const raw = window.localStorage.getItem(SHOW_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_SHOW_PREFS;
    const parsed = JSON.parse(raw) as Partial<ShowPrefs>;
    return { ...DEFAULT_SHOW_PREFS, ...parsed };
  } catch {
    return DEFAULT_SHOW_PREFS;
  }
}

// ── Group-by (E124, +'tag' E171) ─────────────────────────────────────────
// Mainboard grouping lens: 'type' (canonical card type — the long-standing
// default), 'category' (the generator's 8-bucket DeckCategory shape, with
// target gauges), or 'tag' (user-defined tags — a card can land in more than
// one group here, see groupByTag's doc). Persisted like view mode/show
// prefs; default stays 'type' so an existing deck's mainboard renders
// byte-identical until the user opts in.
export type DeckGroupBy = 'type' | 'category' | 'tag';
export const GROUP_BY_STORAGE_KEY = 'mtg-decks-group-by';

export function readStoredGroupBy(): DeckGroupBy {
  if (typeof window === 'undefined') return 'type';
  try {
    const v = window.localStorage.getItem(GROUP_BY_STORAGE_KEY);
    if (v === 'type' || v === 'category' || v === 'tag') return v;
  } catch {
    /* ignore */
  }
  return 'type';
}

// ── Row shape ────────────────────────────────────────────────────────────
/**
 * One distinct printing inside an aggregated {@link Row}. Built only so a row
 * whose copies span more than one printing (e.g. three different Secret Lair
 * Mountains) can expand into per-printing sub-rows — the data is otherwise
 * collapsed by name. `printings.length <= 1` means "uniform stack, nothing to
 * expand". Keyed by the slot's printing (`ScryfallCard.id`), so it reflects the
 * printing the deck actually holds, not a default-by-name lookup.
 */
export interface PrintingGroup {
  /** Scryfall printing id (or set|collector fallback) — the dedup key. */
  key: string;
  card: ScryfallCard;
  qty: number;
  slotIds: string[];
  price: number;
  setCode: string;
  setName?: string;
  collectorNumber: string;
  rarity?: string;
  foil: boolean;
  finish: EnrichedCard['finish'];
}

export interface Row {
  name: string;
  qty: number;
  card: ScryfallCard;
  /** Distinct printings this row aggregates. Only meaningful (and only
   *  rendered as an expand disclosure) when length > 1. */
  printings: PrintingGroup[];
  cmc: number;
  price: number;
  colorKey: string;
  /** Slot ids covered by this aggregated row (for remove-one). */
  slotIds: string[];
  /** Non-null allocatedCopyIds across this row's slots — resolves to
   *  binder membership for the grid badge. */
  allocatedCopyIds: string[];
  /** Allocation status of this row, summarised across the slots it covers. */
  status: AllocationStatus;
  /** Number of slots in this row whose allocatedCopyId resolves to a real owned copy. */
  allocatedQty: number;
  /** Number of slots in this row with no allocatedCopyId (deck wants it, collection lacks it). */
  unownedQty: number;
  /** Number of slots in this row whose allocatedCopyId no longer exists in the collection. */
  orphanQty: number;
  /** Number of slots in this row where the user owns a copy by name but every copy is allocated to another deck. */
  claimedElsewhereQty: number;
  /** First deck claiming a copy of this card (for the badge link/color). Only set when claimedElsewhereQty > 0. */
  claimedBy?: AllocationInfo;
  /**
   * Front-face image to display for this row. Prefers the user's owned
   * printing (via `allocatedCopyId` → collection EnrichedCard) so the
   * deck mirrors what's actually in the binder, falling back to the
   * deck-stored ScryfallCard's image when the slot isn't allocated.
   */
  imageNormal?: string;
  imageNormalBack?: string;
  /** Hero-resolution variants (Scryfall `large`) — only the full-screen
   *  CardPreview opened from this row consumes these; the grid keeps using
   *  imageNormal. Falls back to imageNormal when absent. */
  imageLarge?: string;
  imageLargeBack?: string;
  foil: boolean;
  finish: EnrichedCard['finish'];
  finishes?: string[];
  promoTypes?: string[];
  frameEffects?: string[];
  /**
   * Set / collector number / set name from the owned printing when an
   * allocated copy exists, otherwise from the deck slot's stored card.
   * Used so the carousel and detail panes show metadata that matches the
   * displayed image — no more "image is M20 but the chip says HOB".
   */
  setCode: string;
  setName?: string;
  collectorNumber: string;
  /** Earliest addedAt across all slots for this row. 0 for legacy cards. */
  addedAt: number;
  /** Manual drag-order position (E172) — min across the row's slots, mirroring
   *  addedAt's aggregation. Undefined until the row (or its stack) is dragged
   *  at least once; 'custom' sort then falls back to addedAt (see sortRows /
   *  lib/deck-reorder.ts). */
  sortIndex?: number;
  /** True for the partner commander's synthetic row — drives the "Partner"
   *  tag that distinguishes it from the primary commander. */
  isPartner?: boolean;
  /** Legality lookup key for rows with no list slot (the commander zone).
   *  Slot-based rows resolve their badge via slotIds[0]; commander rows keep
   *  slotIds empty (no remove/qty actions) but still need their issues shown. */
  legalitySlotKey?: string;
  /** Union of every slot's user tags (E171) across this aggregated row —
   *  normally identical across slots (edits apply to the whole row, see
   *  `onSetCardTags`), but unioned defensively for pre-E171 data where a
   *  same-name stack's slots could disagree. */
  tags: string[];
  /** True if ANY slot in this row has been tag-edited (sticky — see the
   *  `tags` doc on `DeckCard`). Drives the "edited" affordance and hides the
   *  live auto-suggestion once true. */
  tagsEdited: boolean;
}

// ── Foil treatment ─────────────────────────────────────────────────────────
// Reuses the CardPreview holographic engine (holographic.css) so an owned
// foil/etched copy shimmers in the deck grid + commander tile, not just in the
// full-screen preview. There's no cursor to drive `--active` here, so the CSS
// runs the same ambient-drift mode used for collection-grid thumbnails.

/** ` is-foil foil-<style>` class suffix for a tile when its owned copy is foil,
 *  or '' when it's nonfoil. The palette class selects the per-finish gradient. */
export function foilTileClass(row: Row): string {
  const style = classifyFoil(row);
  return style === 'none' ? '' : ` is-foil foil-${style}`;
}

export function frontFaceImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

export function backFaceImage(card: ScryfallCard): string | undefined {
  if (card.card_faces && card.card_faces.length > 1) {
    return card.card_faces[1].image_uris?.normal;
  }
  return undefined;
}

// Hero-resolution (`large`) counterparts — only the full-screen CardPreview
// consumes these; everything else stays on the normal-res helpers above.
export function frontFaceImageLarge(card: ScryfallCard): string | undefined {
  return card.image_uris?.large ?? card.card_faces?.[0]?.image_uris?.large;
}

export function backFaceImageLarge(card: ScryfallCard): string | undefined {
  if (card.card_faces && card.card_faces.length > 1) {
    return card.card_faces[1].image_uris?.large;
  }
  return undefined;
}

export function colorKeyOf(card: ScryfallCard): string {
  const ci = card.color_identity ?? [];
  if (ci.length === 0) return 'C';
  if (ci.length === 1) return ci[0];
  return 'M';
}

export interface CrossDeckCtx {
  copiesByName?: Map<string, EnrichedCard[]>;
  otherDeckAllocations?: Map<string, AllocationInfo>;
}

export function buildRows(
  cards: DeckDisplayCard[],
  currency: CurrencyCode,
  collectionById: Map<string, EnrichedCard> | undefined,
  crossDeck?: CrossDeckCtx
): Row[] {
  const map = new Map<string, Row>();
  // Per-name → per-printing buckets, attached to each Row as `printings` at the
  // end so a multi-printing stack can expand into sub-rows.
  const printingMaps = new Map<string, Map<string, PrintingGroup>>();
  // Tracks whether a row's image was sourced from an owned printing — if so,
  // we don't downgrade it to a deck-stored fallback later.
  const ownedImage = new Set<string>();
  const classify = (dc: DeckDisplayCard): AllocationStatus =>
    classifyAllocation(dc.allocatedCopyId ?? null, collectionById, {
      cardName: dc.card.name,
      copiesByName: crossDeck?.copiesByName,
      allocations: crossDeck?.otherDeckAllocations,
    });
  const claimedByFor = (cardName: string) => findClaimedBy(cardName, crossDeck ?? {});
  for (const dc of cards) {
    const card = dc.card;
    const existing = map.get(card.name);
    const status = classify(dc);
    const owned = dc.allocatedCopyId ? collectionById?.get(dc.allocatedCopyId) : undefined;

    // Per-printing bucket, keyed by the slot's *printing identity* (set +
    // collector number), not the raw card.id. Generated decks may carry
    // per-copy-unique synthetic ids (older builds suffixed basics/multi-copy
    // ids), so keying on card.id would split N copies of one printing into N
    // qty-1 sub-rows. set|collector_number is the true printing key and is 1:1
    // with card.id for normal cards. Falls back to card.id when a card has no
    // set/collector (e.g. some tokens). Only the owned copy that actually
    // matches this printing upgrades its set/finish display.
    const pkey =
      card.set && card.collector_number
        ? `${card.set}|${card.collector_number}`
        : card.id || card.name;
    const matchOwned = owned && owned.scryfallId === card.id ? owned : undefined;
    let pmap = printingMaps.get(card.name);
    if (!pmap) {
      pmap = new Map<string, PrintingGroup>();
      printingMaps.set(card.name, pmap);
    }
    const pg = pmap.get(pkey);
    if (pg) {
      pg.qty += 1;
      pg.price += priceOf(card, currency);
      if (dc.slotId) pg.slotIds.push(dc.slotId);
      if (matchOwned?.foil) {
        pg.foil = true;
        pg.finish = matchOwned.finish;
      }
    } else {
      pmap.set(pkey, {
        key: pkey,
        card,
        qty: 1,
        slotIds: dc.slotId ? [dc.slotId] : [],
        price: priceOf(card, currency),
        setCode: matchOwned?.setCode || card.set || '',
        setName: matchOwned?.setName || card.set_name,
        collectorNumber: matchOwned?.collectorNumber || card.collector_number || '',
        rarity: card.rarity,
        foil: matchOwned?.foil ?? false,
        finish: matchOwned?.finish ?? 'nonfoil',
      });
    }

    if (existing) {
      existing.qty += 1;
      existing.price += priceOf(card, currency);
      if (dc.addedAt !== undefined) existing.addedAt = Math.min(existing.addedAt, dc.addedAt);
      if (dc.sortIndex !== undefined) {
        existing.sortIndex =
          existing.sortIndex !== undefined
            ? Math.min(existing.sortIndex, dc.sortIndex)
            : dc.sortIndex;
      }
      if (dc.slotId) existing.slotIds.push(dc.slotId);
      for (const t of cardTagsOf(dc)) if (!existing.tags.includes(t)) existing.tags.push(t);
      if (isTagsEdited(dc)) existing.tagsEdited = true;
      if (dc.allocatedCopyId) existing.allocatedCopyIds.push(dc.allocatedCopyId);
      if (status === 'allocated') existing.allocatedQty += 1;
      else if (status === 'orphan') existing.orphanQty += 1;
      else if (status === 'claimed-elsewhere') existing.claimedElsewhereQty += 1;
      else existing.unownedQty += 1;
      if (status === 'claimed-elsewhere' && !existing.claimedBy) {
        existing.claimedBy = claimedByFor(card.name);
      }
      // Severity: orphan > unowned > allocated. Keep the most-noteworthy.
      if (statusSeverity(status) > statusSeverity(existing.status)) {
        existing.status = status;
      }
      // First owned printing for this row wins — later duplicates may be
      // unowned (and therefore have no collection image), but if an earlier
      // copy fell back to the deck-stored image, an owned copy upgrades it.
      if (owned?.imageNormal && !ownedImage.has(card.name)) {
        existing.imageNormal = owned.imageNormal;
        existing.imageNormalBack = owned.imageNormalBack;
        existing.foil = owned.foil;
        existing.finish = owned.finish;
        existing.finishes = owned.finishes;
        existing.promoTypes = owned.promoTypes;
        existing.frameEffects = owned.frameEffects;
        existing.setCode = owned.setCode || existing.setCode;
        existing.setName = owned.setName || existing.setName;
        existing.collectorNumber = owned.collectorNumber || existing.collectorNumber;
        ownedImage.add(card.name);
      }
      continue;
    }
    if (owned?.imageNormal) ownedImage.add(card.name);
    map.set(card.name, {
      name: card.name,
      qty: 1,
      card,
      printings: [],
      cmc: card.cmc ?? 0,
      price: priceOf(card, currency),
      colorKey: colorKeyOf(card),
      addedAt: dc.addedAt ?? 0,
      sortIndex: dc.sortIndex,
      slotIds: dc.slotId ? [dc.slotId] : [],
      allocatedCopyIds: dc.allocatedCopyId ? [dc.allocatedCopyId] : [],
      status,
      allocatedQty: status === 'allocated' ? 1 : 0,
      unownedQty: status === 'unowned' ? 1 : 0,
      orphanQty: status === 'orphan' ? 1 : 0,
      claimedElsewhereQty: status === 'claimed-elsewhere' ? 1 : 0,
      claimedBy: status === 'claimed-elsewhere' ? claimedByFor(card.name) : undefined,
      imageNormal: owned?.imageNormal ?? frontFaceImage(card),
      imageNormalBack: owned?.imageNormalBack ?? backFaceImage(card),
      imageLarge: owned?.imageLarge ?? frontFaceImageLarge(card),
      imageLargeBack: owned?.imageLargeBack ?? backFaceImageLarge(card),
      foil: owned?.foil ?? false,
      finish: owned?.finish ?? 'nonfoil',
      finishes: owned?.finishes,
      promoTypes: owned?.promoTypes,
      frameEffects: owned?.frameEffects,
      setCode: owned?.setCode || card.set || '',
      setName: owned?.setName || card.set_name,
      collectorNumber: owned?.collectorNumber || card.collector_number || '',
      tags: [...cardTagsOf(dc)],
      tagsEdited: isTagsEdited(dc),
    });
  }
  const rows = [...map.values()];
  for (const r of rows) {
    const pm = printingMaps.get(r.name);
    r.printings = pm
      ? [...pm.values()].sort(
          (a, b) => b.qty - a.qty || a.collectorNumber.localeCompare(b.collectorNumber)
        )
      : [];
  }
  return rows;
}

export function statusSeverity(s: AllocationStatus): number {
  return s === 'orphan' ? 3 : s === 'unowned' ? 2 : s === 'claimed-elsewhere' ? 1 : 0;
}

// Plain-language description of how this row's slots map to owned copies.
// Used as the screen-reader label and hover title for the qty pill, so the
// allocation truth is conveyed even when no warning glyph is shown.
export function allocationSummary(row: Row): string {
  const missing = row.unownedQty + row.orphanQty + row.claimedElsewhereQty;
  if (missing === 0) {
    return row.qty === 1 ? 'From your collection' : `All ${row.qty} copies from your collection`;
  }
  if (row.allocatedQty === 0) {
    if (row.orphanQty > 0)
      return 'The collection copy this slot was assigned to is no longer present';
    if (row.unownedQty > 0) return 'Not in your collection';
    return row.claimedBy
      ? `Owned, but currently in ${row.claimedBy.ownerKind === 'cube' ? 'cube' : 'deck'}: ${row.claimedBy.ownerName}`
      : 'Owned, but currently in another deck';
  }
  const parts: string[] = [];
  if (row.claimedElsewhereQty > 0) parts.push(`${row.claimedElsewhereQty} in another deck`);
  if (row.orphanQty > 0) parts.push(`${row.orphanQty} no longer in collection`);
  if (row.unownedQty > 0) parts.push(`${row.unownedQty} not in collection`);
  const note = parts.length > 0 ? ` (${parts.join('; ')})` : '';
  return `${row.allocatedQty} of ${row.qty} from your collection${note}`;
}

export function allocationAriaLabel(row: Row, opts: { editable: boolean }): string {
  const base = `${row.qty} in deck`;
  const detail = allocationSummary(row);
  const tail = opts.editable ? ' — click to change quantity' : '';
  return `${base} — ${detail}${tail}`;
}

export function allocationTitle(row: Row, opts: { editable: boolean }): string {
  const detail = allocationSummary(row);
  if (!opts.editable) return detail;
  return `${detail} — click to change quantity`;
}

export const SORT_DEFAULT_DIR: Record<SortMode, 'asc' | 'desc'> = {
  name: 'asc',
  cmc: 'asc',
  price: 'desc',
  color: 'asc',
  added: 'desc',
  // 'asc' reads as "the order you left it in" — there's no meaningful
  // "reversed custom order," so this direction is effectively decorative,
  // but every SortMode needs an entry here (onToggleSort indexes into it).
  custom: 'asc',
};

export function sortRows(rows: Row[], mode: SortMode, dir: 'asc' | 'desc'): Row[] {
  const sorted = [...rows];
  const sign = dir === 'asc' ? 1 : -1;
  switch (mode) {
    case 'cmc':
      sorted.sort((a, b) => (a.cmc - b.cmc) * sign || a.name.localeCompare(b.name));
      break;
    case 'price':
      sorted.sort((a, b) => (a.price - b.price) * sign || a.name.localeCompare(b.name));
      break;
    case 'color': {
      const order = (key: string) => COLOR_INFO[key]?.order ?? 99;
      sorted.sort(
        (a, b) => (order(a.colorKey) - order(b.colorKey)) * sign || a.name.localeCompare(b.name)
      );
      break;
    }
    case 'added':
      sorted.sort((a, b) => (a.addedAt - b.addedAt) * sign || a.name.localeCompare(b.name));
      break;
    case 'custom':
      // Dragged rows compare by their persisted sortIndex; never-dragged rows
      // fall back to addedAt (same ms scale — see lib/deck-reorder.ts).
      sorted.sort(
        (a, b) =>
          (effectiveSortIndex(a) - effectiveSortIndex(b)) * sign || a.name.localeCompare(b.name)
      );
      break;
    case 'name':
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name) * sign);
  }
  return sorted;
}

export type TypedGroup = { title: string; icon: string; rows: Row[]; target?: number };

// Buckets that never render a header gauge in category view — 'synergy' and
// 'utility' are the generator's fill/catch-all buckets, not planned slot
// counts, so a target there would be a made-up number, not a real gauge.
export const CATEGORY_GAUGE_EXEMPT = new Set<DeckCategory>(['synergy', 'utility']);

// Shared impl for the claimedByFor closure inside buildRows and the
// claimedByForName useCallback inside the component — identical logic.
export function findClaimedBy(cardName: string, ctx: CrossDeckCtx): AllocationInfo | undefined {
  const copies = ctx.copiesByName?.get(cardName.toLowerCase());
  if (!copies || !ctx.otherDeckAllocations) return undefined;
  for (const c of copies) {
    const info = ctx.otherDeckAllocations.get(c.copyId);
    if (info) return info;
  }
  return undefined;
}

// Group a flat Row[] by canonical card type, optionally prepending a
// commander group. Used for both mainboard and sideboard.
export function groupByType(rows: Row[], commanderRows?: Row[]): TypedGroup[] {
  const buckets = new Map<TypeGroup, Row[]>();
  for (const row of rows) {
    const t = classifyType(row.card);
    const bucket = buckets.get(t) ?? [];
    bucket.push(row);
    buckets.set(t, bucket);
  }
  const ordered: TypedGroup[] = [];
  if (commanderRows && commanderRows.length > 0) {
    ordered.push({
      title: commanderRows.length > 1 ? 'Commanders' : 'Commander',
      icon: 'commander',
      rows: commanderRows,
    });
  }
  for (const t of DISPLAY_ORDER) {
    const r = buckets.get(t);
    if (r && r.length > 0) ordered.push({ title: t, icon: typeIcon(t.toLowerCase()), rows: r });
  }
  return ordered;
}

// Group a flat Row[] by the generator's 8-bucket DeckCategory, optionally
// prepending a commander group — same shape/contract as groupByType (used
// for both mainboard and sideboard). A bucket with 0 rows is still included
// when `categoryTargets` names a positive target for it (the "0/N gap" story
// — a deck that generated 0 board wipes against a target of 3 should say so,
// not silently omit the section); otherwise an empty bucket is dropped.
// synergy/utility never carry a target — see CATEGORY_GAUGE_EXEMPT.
export function groupByCategory(
  rows: Row[],
  categoryTargets: Partial<Record<DeckCategory, number>> | undefined,
  commanderRows?: Row[]
): TypedGroup[] {
  const buckets = new Map<DeckCategory, Row[]>();
  for (const row of rows) {
    const cat = classifyCardCategory(row.card);
    const bucket = buckets.get(cat) ?? [];
    bucket.push(row);
    buckets.set(cat, bucket);
  }
  const ordered: TypedGroup[] = [];
  if (commanderRows && commanderRows.length > 0) {
    ordered.push({
      title: commanderRows.length > 1 ? 'Commanders' : 'Commander',
      icon: 'commander',
      rows: commanderRows,
    });
  }
  for (const cat of CATEGORY_DISPLAY_ORDER) {
    const rowsForCat = buckets.get(cat);
    const target = CATEGORY_GAUGE_EXEMPT.has(cat) ? undefined : categoryTargets?.[cat];
    if ((rowsForCat && rowsForCat.length > 0) || (target !== undefined && target > 0)) {
      const icon = cat === 'lands' ? 'land' : cat === 'creatures' ? 'creature' : cat;
      ordered.push({ title: CATEGORY_TITLES[cat], icon, rows: rowsForCat ?? [], target });
    }
  }
  return ordered;
}

// Group a flat Row[] by user tag (E171). Unlike groupByType/groupByCategory
// this is NOT a partition — a multi-tagged row appears in every one of its
// tag's groups, by design (multi-tag was a deliberate ruling, see the
// DeckCard.tags doc). That's exactly what makes the section-header counts
// here NOT summable into a deck total: the true count lives only in the
// stat-strip's `totalCards` (computed straight from `cards.length`, never
// from these groups — see the honesty note this function's caller renders).
// Rows are alphabetical by tag name; an "Untagged" bucket trails last so a
// deck that's only partially tagged still shows the whole list.
export const UNTAGGED_GROUP_TITLE = 'Untagged';
export function groupByTag(rows: Row[], commanderRows?: Row[]): TypedGroup[] {
  const buckets = new Map<string, Row[]>();
  const untagged: Row[] = [];
  for (const row of rows) {
    if (row.tags.length === 0) {
      untagged.push(row);
      continue;
    }
    for (const tag of row.tags) {
      const bucket = buckets.get(tag) ?? [];
      bucket.push(row);
      buckets.set(tag, bucket);
    }
  }
  const ordered: TypedGroup[] = [];
  if (commanderRows && commanderRows.length > 0) {
    ordered.push({
      title: commanderRows.length > 1 ? 'Commanders' : 'Commander',
      icon: 'commander',
      rows: commanderRows,
    });
  }
  for (const tag of [...buckets.keys()].sort((a, b) => a.localeCompare(b))) {
    ordered.push({ title: tag, icon: 'tag', rows: buckets.get(tag)! });
  }
  if (untagged.length > 0) {
    ordered.push({ title: UNTAGGED_GROUP_TITLE, icon: 'tag', rows: untagged });
  }
  return ordered;
}

// Filter by search query and sort each group's rows. Used for both
// mainboard (visibleGroups) and sideboard (visibleSideboardGroups).
export function applyFilterSort(
  groups: TypedGroup[],
  search: string,
  sort: SortMode,
  sortDir: 'asc' | 'desc'
): TypedGroup[] {
  const q = search.trim().toLowerCase();
  return groups.map((g) => {
    const filtered = q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)) : g.rows;
    return { ...g, rows: sortRows(filtered, sort, sortDir) };
  });
}
