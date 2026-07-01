import {
  Check,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  Boxes,
  Clipboard,
  Download,
  Eye,
  Hand,
  Handshake,
  Layers,
  LayoutGrid,
  List as ListIconLucide,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useListFlip } from '@/lib/use-list-flip';
import { createPortal } from 'react-dom';
import type { ScryfallCard, DeckFormat, ThemeResult, BuildReport } from '@/deck-builder/types';
import { buildManaData, classifyType, tallyNames, type TypeGroup } from '@/lib/build-mana-data';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  validateDeck as runValidation,
  validateDeckSize,
  countFlaggedCards,
  type LegalityIssue,
} from '../../lib/deck-validation';
import type { DeckCard } from '../../store/decks';
import { getCardPrice, getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { ManaCost } from '../ManaCost';
import { ManaSymbol } from '../shared/ManaSymbol';
import { MeterBar } from '../shared/MeterBar';
import { SetSymbol } from '../shared/SetSymbol';
import { setSymbolTitle } from '@/lib/set-symbols';
import { typeIcon } from '../../lib/card-types';
import { formatMoney } from '../../lib/format-money';
import { Modal } from '../Modal';
import { SearchPill } from '../SearchPill';
import { CardPreview, type CardPreviewAction } from '../CardPreview';
import { CardPreviewContext } from '../CardPreviewContext';
import { DeckCardPreviewMeta } from './DeckCardPreviewMeta';
import { DeckHoverPeek } from './DeckHoverPeek';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { COLOR_INFO } from '../../lib/colors';
import { classifyFoil } from '../../lib/foil-style';
import { FoilBadge } from '../FoilBadge';
import { Legend } from '../Legend';
import {
  buildAllocationMap,
  classifyAllocation,
  type AllocationInfo,
  type AllocationStatus,
} from '../../lib/allocations';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { useRarityCorrections } from '../../lib/use-rarity-corrections';
import type { EnrichedCard } from '../../types';
import {
  bracketLabel,
  type BracketEstimation,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { BracketBreakdown } from './BracketBreakdown';
import { BracketVerdictStrip } from './BracketVerdictStrip';
import type { LaneId } from '@/lib/deck-change';
import { useCardCarousel, tallyToEntries, type CarouselEntry } from './useCardCarousel';
import { BuildReportPanel } from './BuildReportPanel';
import { type DeckManaData } from './deck-mana-types';
import { DeckCurvePhases } from './DeckCurvePhases';
import { DeckColorPanel } from './DeckColorPanel';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';
import { SaltiestPanel } from './SaltiestPanel';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { computeRoleDensity } from '@/deck-builder/services/deckBuilder/roleDensity';
import { DeckIdentityCard } from './DeckIdentityCard';
import { buildValidationChecklist } from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import {
  buildCommanderProfile,
  whyCardMatches,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import { deriveDeckIdentity } from '@/deck-builder/services/deckBuilder/deckIdentity';
import {
  getRoleBadge,
  isMultiRole,
  multiRoleTitle,
  ROLE_BADGE_BY_TONE,
  ROLE_BADGE_GROUPS,
} from '../../lib/role-badges';
import { ViewModeToggle as SharedViewModeToggle } from '../ViewModeToggle';
import { BinderBadge, type BinderInfo } from '../BinderBadge';
import { SelectMenu } from '../SelectMenu';
import { SortDirArrow } from '../SortDirArrow';
import { usePanelCascade, panelCascadeClass } from '@/lib/use-panel-cascade';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';

// ── Canonical card-type grouping ──────────────────────────────────────────
// classifyType / tallyNames / TypeGroup live in lib/build-mana-data (shared
// with the deck-compare page); DISPLAY_ORDER is DeckDisplay's own row ordering.
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

// ── Helpers ───────────────────────────────────────────────────────────────
type CurrencyCode = 'USD' | 'EUR';

function priceOf(card: ScryfallCard, currency: CurrencyCode): number {
  const raw = getCardPrice(card, currency);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// Role-badge data + decoding (ROLE_BADGE_BY_TONE, getRoleBadge,
// multiRoleTitle, …) lives in lib/role-badges so the deck list, grid
// tiles, toolbar legend, tap-to-reveal popover, and card preview panel
// all share one source of truth. See the `role-badges` import above.

function frontFaceMana(card: ScryfallCard): string | undefined {
  return card.mana_cost ?? card.card_faces?.[0]?.mana_cost;
}

type SortMode = 'name' | 'cmc' | 'price' | 'color' | 'added';

export type ExportFormat = 'mtga' | 'plain' | 'moxfield';

const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  mtga: 'MTGA',
  plain: 'Plaintext',
  moxfield: 'Moxfield',
};

const EXPORT_FORMAT_STORAGE_KEY = 'mtg-decks-export-format';

function readStoredFormat(): ExportFormat {
  if (typeof window === 'undefined') return 'mtga';
  try {
    const v = window.localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY);
    if (v === 'mtga' || v === 'plain' || v === 'moxfield') return v;
  } catch {
    /* ignore */
  }
  return 'mtga';
}

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

// Card size for grid view — mirrors the collection grid's 1×/2×/3×.
export type DeckGridSize = '1x' | '2x' | '3x';

interface ShowPrefs {
  price: boolean;
  roles: boolean;
  mana: boolean;
}

const VIEW_MODE_STORAGE_KEY = 'mtg-decks-view-mode';
const GRID_SIZE_STORAGE_KEY = 'mtg-decks-grid-size';
const SHOW_PREFS_STORAGE_KEY = 'mtg-decks-show-prefs';
function readStoredGridSize(): DeckGridSize {
  if (typeof window === 'undefined') return '1x';
  try {
    const v = window.localStorage.getItem(GRID_SIZE_STORAGE_KEY);
    if (v === '1x' || v === '2x' || v === '3x') return v;
  } catch {
    /* ignore */
  }
  return '1x';
}

const DEFAULT_SHOW_PREFS: ShowPrefs = { price: true, roles: true, mana: true };

function readStoredViewMode(): DeckViewMode {
  if (typeof window === 'undefined') return 'list';
  try {
    const v = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === 'list' || v === 'grid') return v;
    // Migrate dropped modes ('compact', 'text') → 'list' for any
    // persisted value.
    if (v === 'compact' || v === 'text') return 'list';
  } catch {
    /* ignore */
  }
  return 'list';
}

function readStoredShowPrefs(): ShowPrefs {
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

// ── Props ─────────────────────────────────────────────────────────────────
export interface DeckDisplayCard {
  /** Persisted slot id; when present, used for remove. Generated decks pre-save can omit this. */
  slotId?: string;
  card: ScryfallCard;
  /** scryfallId of the specific collection copy claimed by this slot, if any. */
  allocatedCopyId?: string | null;
  /** Unix ms when this slot was added. Absent on cards predating the field. */
  addedAt?: number;
}

export interface DeckDisplayProps {
  title: string;
  /** When set, the card-preview's "In deck" chip is suppressed for this deck. */
  deckId?: string;
  format?: DeckFormat;
  /** Deck accent color hex (from deck.color). Used in the identity hero banner. */
  color?: string;
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  /** The deck's selected themes (generated decks); refines the identity strip's
   *  archetype to reflect stated intent. Omitted for manual/imported decks. */
  selectedThemes?: ThemeResult[];
  commanderAllocatedCopyId?: string | null;
  partnerCommanderAllocatedCopyId?: string | null;
  cards: DeckDisplayCard[];
  sideboard?: DeckDisplayCard[];
  /** Optional grade/bracket — if provided, renders in the stats and toolbar. */
  bracketEstimation?: BracketEstimation;
  /** Actual deck cards by name — lets bracket-breakdown card previews show the
   *  deck's printing instead of the default printing fetched by name. */
  deckCardsByName?: ReadonlyMap<string, ScryfallCard>;
  /** User-pinned bracket (1–5); when set it overrides the auto estimate. */
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
  /** Set/clear the manual bracket override. Passing null reverts to auto. */
  onSetBracketOverride?: (bracket: 1 | 2 | 3 | 4 | 5 | null) => void;
  deckGrade?: { letter: string; headline: string };
  /** 0-100 PlanScore (strategy/roles/curve/cardFit); kept live by the analysis hook. */
  planScore?: PlanScore;
  /** Mean EDHREC salt score across non-land cards (generated decks only). */
  averageSalt?: number;
  saltiestCards?: Array<{ name: string; salt: number }>;
  /** Role counts from the generator (only present on generated decks). */
  roleCounts?: Record<string, number>;
  /** Target role counts (balanced-roles generation); drives have/want display. */
  roleTargets?: Record<string, number>;
  /** Post-generation fill+flag report (set at generation only). */
  buildReport?: BuildReport;
  /**
   * EDHREC inclusion rate per card name (0–100), persisted by the analysis
   * hook on generated commander decks. When present, each card row shows a
   * subtle inclusion-% chip. Absent for manual/unanalyzed decks.
   */
  cardInclusionMap?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  /** Editing callback. When provided, each row gets a remove option in its menu. */
  onRemoveCard?: (slotId: string) => void;
  onRemoveSideboardCard?: (slotId: string) => void;
  onMoveToSideboard?: (slotId: string) => void;
  onMoveToMainboard?: (slotId: string) => void;
  /**
   * Editing callback for click-to-edit qty. When provided, the qty cell
   * becomes a clickable target that swaps to a numeric input on click;
   * committing the value diffs against the current count and adds/removes
   * slots in bulk. Host owns batching (e.g. one undo toast per edit).
   */
  onSetQty?: (card: ScryfallCard, qty: number) => void;
  /** When provided, each row gets an "Edit printing" option in its menu. */
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  /** When provided, eligible rows get a "Make commander" option in their menu. */
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  /** Predicate that gates the "Make commander" menu item per card. */
  canMakeCommander?: (card: ScryfallCard) => boolean;
  /** When provided, eligible rows get a "Make partner" option in their menu. */
  onMakePartner?: (slotId: string, card: ScryfallCard) => void;
  /** Predicate that gates the "Make partner" menu item per card (e.g. the card
   *  is a legal partner for the current commander). */
  canMakePartner?: (card: ScryfallCard) => boolean;
  /** When provided, the Commander section header shows an "Add/Edit partner"
   *  control that opens the partner picker. Pass only when the commander can
   *  actually have a partner. */
  onEditPartner?: () => void;
  /**
   * When provided, eligible rows get a "Move to another deck…" option that
   * reallocates a physical copy out of this deck. Suppressed for the partner
   * commander row (the commander has no portable list slot). Pass only when
   * there's at least one other deck to move into.
   */
  onMoveToAnotherDeck?: (card: ScryfallCard) => void;
  /**
   * When provided, a row holding an owned physical copy gets a "Release copy"
   * option that frees the copy back to the collection (the slot stays in the
   * deck as a card you still need) — for when you want the card for something
   * else, not a deck.
   */
  onReleaseCopy?: (card: ScryfallCard) => void;
  /**
   * When provided, an unowned row whose every owned copy is in OTHER decks gets
   * a "Use my copy" option that pulls a copy in (routes through the explicit
   * steal-confirm flow).
   */
  onUseOwnCopy?: (card: ScryfallCard) => void;
  /**
   * Open the Shared-copies review for cards this deck wants whose copies are in
   * other decks. Drives the neutral "N cards also in your other decks · Review"
   * banner — pulling a copy in is a conscious per-card choice in the sheet, never
   * a bulk grab. When omitted, the banner is not shown.
   */
  onReviewShared?: () => void;
  /** Lookup of owned cards by scryfallId, for allocation badges + status. */
  collectionByCopyId?: Map<string, EnrichedCard>;
  /** Binder(s) each collection copy is filed in, keyed by copyId — drives
   *  the grid card's binder-membership badge. */
  binderByCopyId?: Map<string, BinderInfo[]>;
  /**
   * Optional parent-controlled state for the Export dialog. When both
   * are provided, the parent owns the open state — useful for opening
   * Export from outside the toolbar (e.g. a page-level action sheet).
   * When omitted, DeckDisplay manages the dialog internally.
   */
  exportOpen?: boolean;
  onExportOpenChange?: (open: boolean) => void;
  /** When provided, the in-deck search shows a "Search Scryfall for X"
   *  trigger (query ≥ 2 chars) that hands the query off to the host's
   *  add panel — so adding a card not in the deck starts from the same
   *  search bar, mirroring the collection page. */
  onAddFromSearch?: (query: string) => void;
  /**
   * Folded-in analysis panels (Combos / EDHREC suggestions). The page builds
   * these so they keep their own data fetching; DeckDisplay slots them into the
   * Power / Improve tabs. (Test hand stays a separate standalone panel.)
   */
  combosSlot?: React.ReactNode;
  /** CoachFeed slot — unified Coach tab surface (NBM + Improve + Cost + Bracket
   *  Fit). Replaces the old improveSlot/nextBestMoveSlot/costSlot/bracketFitSlot.
   *  Built by the page (owns all data + handlers). */
  coachFeedSlot?: React.ReactNode;
  /** Engine *diagnostics* (axis-balance bars + warnings), rendered on the Power
   *  tab. */
  engineSlot?: React.ReactNode;
  /** Win-condition detection panel, rendered on the Power tab. */
  winConditionSlot?: React.ReactNode;
  /** Power-tab verdict hero (bracket + gameplan), rendered atop the Power view. */
  powerHeroSlot?: React.ReactNode;
  /**
   * In-context "Swap this card": for an in-deck card at `slotId`, return the
   * role-scoped replacement section rendered in the card-preview panel. `close`
   * dismisses the preview after a swap commits (the previewed card is gone).
   * Returns null when there's nothing to offer (e.g. commander, untagged role).
   */
  renderSwapSuggestions?: (
    card: ScryfallCard,
    slotId: string,
    close: () => void
  ) => React.ReactNode;
  /**
   * In-context "Similar cards" section, rendered below the swap suggestions for
   * an in-deck card: owned look-alikes from the collection, then broader
   * discovery. Same `(card, slotId, close)` shape as `renderSwapSuggestions`.
   */
  renderSimilarCards?: (card: ScryfallCard, slotId: string, close: () => void) => React.ReactNode;
  /**
   * Which page-top view is active. `deck` shows the card-list editing surface;
   * the analysis ids show that view full-width (the card list is hidden). The
   * hub tab bar lives in the page (`DeckEditorPage`), which owns this state.
   */
  activeView?: DeckView;
  /** Reveal the standalone Test hand panel — surfaced in the Deck-view toolbar. */
  onShowTestHand?: () => void;
  /**
   * UX-310: whether the async commander-deck analysis is still in-flight for
   * the first time. When 'pending', the Coach and Power tabs render skeleton
   * placeholders instead of blank space. 'ready' (default) renders
   * normally — slots that are undefined simply don't appear.
   */
  analysisState?: 'pending' | 'ready';
  /**
   * UX-311: deep-link from a StatsHero shortfall line to the Coach filter that
   * addresses it. The page switches to the Coach tab and activates the matching
   * filter chip. Only passed for commander decks that have a full analysis result.
   */
  onNavigateToTune?: (lane: LaneId) => void;
  /**
   * Session-scoped reveal key for score animations. When non-null, plays the
   * 0→target reveal tween on first delivery; null/undefined suppresses the reveal.
   * Computed by the page from deck.id + gradeBracketSignature.
   */
  scoreRevealKey?: string | null;
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
interface PrintingGroup {
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

interface Row {
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
  /** True for the partner commander's synthetic row — drives the "Partner"
   *  tag that distinguishes it from the primary commander. */
  isPartner?: boolean;
}

// ── Foil treatment ─────────────────────────────────────────────────────────
// Reuses the CardPreview holographic engine (holographic.css) so an owned
// foil/etched copy shimmers in the deck grid + commander tile, not just in the
// full-screen preview. There's no cursor to drive `--active` here, so the CSS
// runs the same ambient-drift mode used for collection-grid thumbnails.

/** ` is-foil foil-<style>` class suffix for a tile when its owned copy is foil,
 *  or '' when it's nonfoil. The palette class selects the per-finish gradient. */
function foilTileClass(row: Row): string {
  const style = classifyFoil(row);
  return style === 'none' ? '' : ` is-foil foil-${style}`;
}

/** The two ambient-drift overlay layers (rainbow shine + glare) reused from the
 *  CardPreview foil engine. Render inside any element carrying `is-foil`. */
function FoilShimmer() {
  return (
    <>
      <div className="card-preview-foil-shine" aria-hidden="true" />
      <div className="card-preview-foil-glare" aria-hidden="true" />
    </>
  );
}

function frontFaceImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

function backFaceImage(card: ScryfallCard): string | undefined {
  if (card.card_faces && card.card_faces.length > 1) {
    return card.card_faces[1].image_uris?.normal;
  }
  return undefined;
}

// Hero-resolution (`large`) counterparts — only the full-screen CardPreview
// consumes these; everything else stays on the normal-res helpers above.
function frontFaceImageLarge(card: ScryfallCard): string | undefined {
  return card.image_uris?.large ?? card.card_faces?.[0]?.image_uris?.large;
}

function backFaceImageLarge(card: ScryfallCard): string | undefined {
  if (card.card_faces && card.card_faces.length > 1) {
    return card.card_faces[1].image_uris?.large;
  }
  return undefined;
}

function colorKeyOf(card: ScryfallCard): string {
  const ci = card.color_identity ?? [];
  if (ci.length === 0) return 'C';
  if (ci.length === 1) return ci[0];
  return 'M';
}

interface CrossDeckCtx {
  copiesByName?: Map<string, EnrichedCard[]>;
  otherDeckAllocations?: Map<string, AllocationInfo>;
}

function buildRows(
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
      if (dc.slotId) existing.slotIds.push(dc.slotId);
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

function statusSeverity(s: AllocationStatus): number {
  return s === 'orphan' ? 3 : s === 'unowned' ? 2 : s === 'claimed-elsewhere' ? 1 : 0;
}

// Plain-language description of how this row's slots map to owned copies.
// Used as the screen-reader label and hover title for the qty pill, so the
// allocation truth is conveyed even when no warning glyph is shown.
function allocationSummary(row: Row): string {
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

function allocationAriaLabel(row: Row, opts: { editable: boolean }): string {
  const base = `${row.qty} in deck`;
  const detail = allocationSummary(row);
  const tail = opts.editable ? ' — click to change quantity' : '';
  return `${base} — ${detail}${tail}`;
}

function allocationTitle(row: Row, opts: { editable: boolean }): string {
  const detail = allocationSummary(row);
  if (!opts.editable) return detail;
  return `${detail} — click to change quantity`;
}

// Inline chip rendered next to the card name. Stays out of the way when the
// row is fully allocated; surfaces a precise "M of N owned" count when only
// some slots are bound to a real collection copy. Orphans get their own
// tone so a stale-allocation row is distinguishable from a never-owned one.
// When the user owns the card but every copy is allocated to a different
// deck, we surface the same "deck badge" (Layers icon + deck color) used
// in the Collection grid so the row reads "in another deck" — never
// "unowned" for a card that's already in the binder.
function AllocationChip({ row }: { row: Row }) {
  const missing = row.unownedQty + row.orphanQty + row.claimedElsewhereQty;
  if (missing === 0) return null;
  // "Claimed elsewhere" gets the deck-link badge — when there's no genuinely
  // unowned/orphan slot mixed in, the chip is purely a navigation affordance.
  if (row.claimedElsewhereQty > 0 && row.unownedQty === 0 && row.orphanQty === 0 && row.claimedBy) {
    const info = row.claimedBy;
    const isCube = info.ownerKind === 'cube';
    const noun = isCube ? 'cube' : 'deck';
    const title =
      row.claimedElsewhereQty === row.qty
        ? `In ${noun}: ${info.ownerName}`
        : `${row.claimedElsewhereQty} of ${row.qty} in ${noun}: ${info.ownerName}`;
    return (
      <Link
        to={isCube ? `/collection/cube/${info.ownerId}` : `/decks/${info.ownerId}`}
        className="deck-row-alloc-badge"
        style={
          {
            ['--deck-color']: isCube ? 'var(--cube-color)' : info.ownerColor || 'var(--accent)',
          } as React.CSSProperties
        }
        title={title}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {isCube ? (
          <Boxes width={11} height={11} strokeWidth={2.2} aria-hidden />
        ) : (
          <Layers width={11} height={11} strokeWidth={2.2} aria-hidden />
        )}
        <span className="deck-row-alloc-badge-label">{info.ownerName}</span>
      </Link>
    );
  }
  const tone = row.orphanQty > 0 ? 'orphan' : row.unownedQty > 0 ? 'unowned' : 'claimed-elsewhere';
  const label =
    row.allocatedQty === 0
      ? row.orphanQty > 0
        ? 'orphan'
        : row.unownedQty > 0
          ? 'unowned'
          : 'in another deck'
      : `${row.allocatedQty} of ${row.qty} owned`;
  return (
    <span
      className={`deck-row-alloc-chip deck-row-alloc-chip-${tone}`}
      title={allocationSummary(row)}
      aria-label={allocationSummary(row)}
    >
      {label}
    </span>
  );
}

const SORT_DEFAULT_DIR: Record<SortMode, 'asc' | 'desc'> = {
  name: 'asc',
  cmc: 'asc',
  price: 'desc',
  color: 'asc',
  added: 'desc',
};

function sortRows(rows: Row[], mode: SortMode, dir: 'asc' | 'desc'): Row[] {
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
    case 'name':
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name) * sign);
  }
  return sorted;
}

type TypedGroup = { title: string; icon: string; rows: Row[] };

// Shared impl for the claimedByFor closure inside buildRows and the
// claimedByForName useCallback inside the component — identical logic.
function findClaimedBy(cardName: string, ctx: CrossDeckCtx): AllocationInfo | undefined {
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
function groupByType(rows: Row[], commanderRows?: Row[]): TypedGroup[] {
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

// Filter by search query and sort each group's rows. Used for both
// mainboard (visibleGroups) and sideboard (visibleSideboardGroups).
function applyFilterSort(
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

// ── Main component ────────────────────────────────────────────────────────
export function DeckDisplay({
  title,
  deckId,
  format = 'commander',
  color,
  commander,
  partnerCommander,
  selectedThemes,
  commanderAllocatedCopyId,
  partnerCommanderAllocatedCopyId,
  cards,
  sideboard = [],
  bracketEstimation,
  deckCardsByName,
  bracketOverride,
  onSetBracketOverride,
  // deckGrade: removed from stat-strip (UX-315: one grading system; letter grades dropped)
  planScore,
  averageSalt,
  saltiestCards,
  roleCounts,
  roleTargets,
  buildReport,
  cardInclusionMap,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
  onRemoveCard,
  onRemoveSideboardCard,
  onMoveToSideboard,
  onMoveToMainboard,
  onSetQty,
  onEditCard,
  onMakeCommander,
  canMakeCommander,
  onMakePartner,
  canMakePartner,
  onEditPartner,
  onMoveToAnotherDeck,
  onReleaseCopy,
  onUseOwnCopy,
  onReviewShared,
  collectionByCopyId,
  binderByCopyId,
  exportOpen: exportOpenProp,
  onExportOpenChange,
  onAddFromSearch,
  combosSlot,
  coachFeedSlot,
  engineSlot,
  winConditionSlot,
  powerHeroSlot,
  renderSwapSuggestions,
  renderSimilarCards,
  activeView = 'deck',
  onShowTestHand,
  analysisState = 'ready',
  onNavigateToTune,
  scoreRevealKey,
}: DeckDisplayProps) {
  const formatConfig = DECK_FORMAT_CONFIGS[format];
  const currency: CurrencyCode = 'USD';
  const [sort, setSort] = useState<SortMode>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onToggleSort = (m: SortMode) => {
    if (m === sort) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(m);
      setSortDir(SORT_DEFAULT_DIR[m]);
    }
  };
  const [search, setSearch] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() => readStoredFormat());
  const [viewMode, setViewMode] = useState<DeckViewMode>(() => readStoredViewMode());
  const [gridSize, setGridSize] = useState<DeckGridSize>(() => readStoredGridSize());
  const [showPrefs, setShowPrefs] = useState<ShowPrefs>(() => readStoredShowPrefs());
  // Mirrors the collection grid: on narrow viewports 3× can't render
  // visibly larger than 2×, so the option is hidden and a persisted 3×
  // is clamped down for layout (without overwriting the stored value).
  const [isNarrowGrid, setIsNarrowGrid] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 640px)');
    const update = () => setIsNarrowGrid(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  const effectiveGridSize: DeckGridSize = isNarrowGrid && gridSize === '3x' ? '2x' : gridSize;

  const handleExportFormatChange = (f: ExportFormat) => {
    setExportFormat(f);
    try {
      window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, f);
    } catch {
      /* ignore */
    }
  };
  const handleViewModeChange = (m: DeckViewMode) => {
    setViewMode(m);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  };
  const handleGridSizeChange = (s: DeckGridSize) => {
    setGridSize(s);
    try {
      window.localStorage.setItem(GRID_SIZE_STORAGE_KEY, s);
    } catch {
      /* ignore */
    }
  };
  const handleShowPrefsChange = (next: ShowPrefs) => {
    setShowPrefs(next);
    try {
      window.localStorage.setItem(SHOW_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  // The analysis surface is now a set of page-top distinct views (the hub tab
  // bar lives in DeckEditorPage and owns the active view), so there's no
  // collapse state or desktop side-column to track here — `activeView` decides
  // what this component renders.

  // Cross-deck context: lets us distinguish "you don't own this card" from
  // "you own it, but a different deck has the copy claimed". We exclude the
  // current deck's own allocations so a slot in *this* deck doesn't count
  // as "claimed elsewhere" against itself.
  const allDecks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const crossDeck: CrossDeckCtx = useMemo(() => {
    if (!collectionByCopyId) return {};
    const copiesByName = new Map<string, EnrichedCard[]>();
    for (const copy of collectionByCopyId.values()) {
      const key = copy.name.toLowerCase();
      const list = copiesByName.get(key);
      if (list) list.push(copy);
      else copiesByName.set(key, [copy]);
    }
    const others = deckId ? allDecks.filter((d) => d.id !== deckId) : allDecks;
    // Physical cubes are always "other" (a cube is never the deck being viewed),
    // so a copy committed to a cube reads as claimed-elsewhere here too.
    const otherDeckAllocations = buildAllocationMap(others, savedCubes);
    return { copiesByName, otherDeckAllocations };
  }, [collectionByCopyId, allDecks, savedCubes, deckId]);

  const claimedByForName = useCallback(
    (cardName: string) => findClaimedBy(cardName, crossDeck),
    [crossDeck]
  );

  // Commander rows are synthetic so they always render first; their slot
  // ids are blank because remove is not allowed on the commander.
  const commanderRows: Row[] = useMemo(() => {
    const rows: Row[] = [];
    const push = (c: ScryfallCard, allocatedCopyId?: string | null, isPartner = false) => {
      const owned = allocatedCopyId ? collectionByCopyId?.get(allocatedCopyId) : undefined;
      const status: AllocationStatus = classifyAllocation(
        allocatedCopyId ?? null,
        collectionByCopyId,
        {
          cardName: c.name,
          copiesByName: crossDeck.copiesByName,
          allocations: crossDeck.otherDeckAllocations,
        }
      );
      rows.push({
        name: c.name,
        qty: 1,
        card: c,
        printings: [],
        cmc: c.cmc ?? 0,
        price: priceOf(c, currency),
        colorKey: colorKeyOf(c),
        addedAt: 0,
        slotIds: [],
        allocatedCopyIds: allocatedCopyId ? [allocatedCopyId] : [],
        status,
        allocatedQty: status === 'allocated' ? 1 : 0,
        unownedQty: status === 'unowned' ? 1 : 0,
        orphanQty: status === 'orphan' ? 1 : 0,
        claimedElsewhereQty: status === 'claimed-elsewhere' ? 1 : 0,
        claimedBy: status === 'claimed-elsewhere' ? claimedByForName(c.name) : undefined,
        imageNormal: owned?.imageNormal ?? frontFaceImage(c),
        imageNormalBack: owned?.imageNormalBack ?? backFaceImage(c),
        imageLarge: owned?.imageLarge ?? frontFaceImageLarge(c),
        imageLargeBack: owned?.imageLargeBack ?? backFaceImageLarge(c),
        foil: owned?.foil ?? false,
        finish: owned?.finish ?? 'nonfoil',
        finishes: owned?.finishes,
        promoTypes: owned?.promoTypes,
        frameEffects: owned?.frameEffects,
        setCode: owned?.setCode || c.set || '',
        setName: owned?.setName || c.set_name,
        collectorNumber: owned?.collectorNumber || c.collector_number || '',
        isPartner,
      });
    };
    if (commander) push(commander, commanderAllocatedCopyId);
    if (partnerCommander) push(partnerCommander, partnerCommanderAllocatedCopyId, true);
    return rows;
  }, [
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    collectionByCopyId,
    crossDeck,
    claimedByForName,
  ]);

  // Non-commander rows grouped by canonical type.
  const groups = useMemo(
    () => groupByType(buildRows(cards, currency, collectionByCopyId, crossDeck), commanderRows),
    [cards, commanderRows, collectionByCopyId, crossDeck]
  );

  // Sideboard rows grouped by canonical type.
  const sideboardGroups = useMemo(
    () =>
      sideboard.length === 0
        ? []
        : groupByType(buildRows(sideboard, currency, collectionByCopyId, crossDeck)),
    [sideboard, collectionByCopyId, crossDeck]
  );

  // Legality issues for the current format.
  const legalityIssues = useMemo(() => {
    const mainDeckCards: DeckCard[] = cards.map((c) => ({
      slotId: c.slotId ?? '',
      card: c.card,
      allocatedCopyId: c.allocatedCopyId ?? null,
    }));
    const sideDeckCards: DeckCard[] = sideboard.map((c) => ({
      slotId: c.slotId ?? '',
      card: c.card,
      allocatedCopyId: c.allocatedCopyId ?? null,
    }));
    return runValidation(mainDeckCards, sideDeckCards, formatConfig, {
      commander,
      partnerCommander: partnerCommander ?? null,
    });
  }, [cards, sideboard, formatConfig, commander, partnerCommander]);

  const legalityBySlot = useMemo(() => {
    const map = new Map<string, LegalityIssue>();
    for (const issue of legalityIssues) {
      // Prefer the more specific issue type if multiple apply to the same slot.
      // Color-identity and not-legal both signal "this card does not belong";
      // copy-limit is a separate flavor. Keep whichever we saw first since the
      // tooltip only has room for one detail line anyway.
      if (!map.has(issue.slotId)) map.set(issue.slotId, issue);
    }
    return map;
  }, [legalityIssues]);

  const flaggedCardCount = useMemo(() => countFlaggedCards(legalityIssues), [legalityIssues]);

  const deckSizeWarning = useMemo(
    () => validateDeckSize(cards.length, formatConfig),
    [cards.length, formatConfig]
  );

  const visibleGroups = useMemo(
    () => applyFilterSort(groups, search, sort, sortDir),
    [groups, search, sort, sortDir]
  );

  const visibleSideboardGroups = useMemo(
    () => applyFilterSort(sideboardGroups, search, sort, sortDir),
    [sideboardGroups, search, sort, sortDir]
  );

  // No card in the deck (main or sideboard) matches the current query —
  // the cue to surface the "search Scryfall to add it" trigger.
  const noDeckMatches =
    !visibleGroups.some((g) => g.rows.length > 0) &&
    !visibleSideboardGroups.some((g) => g.rows.length > 0);

  // Flat list for stats panels (commanders included, since color identity
  // and curve are commander-relevant too).
  const allCards = useMemo<ScryfallCard[]>(() => {
    const list: ScryfallCard[] = [];
    if (commander) list.push(commander);
    if (partnerCommander) list.push(partnerCommander);
    for (const dc of cards) list.push(dc.card);
    return list;
  }, [commander, partnerCommander, cards]);

  // The deck's legal color identity = the commander(s)' combined identity.
  // Undefined when there's no commander, which skips the identity validation gate.
  const commanderIdentity = useMemo<string[] | undefined>(() => {
    if (!commander) return undefined;
    const set = new Set<string>();
    for (const c of [commander, partnerCommander]) {
      for (const k of c?.color_identity ?? []) set.add(k);
    }
    return [...set];
  }, [commander, partnerCommander]);

  // The commander's parsed ability profile — shared by the per-card synergy
  // reasons and the deck-identity strip.
  const commanderProfile = useMemo(
    () => (commander ? buildCommanderProfile(commander, partnerCommander) : null),
    [commander, partnerCommander]
  );

  // Live-computed deck identity (archetype + pacing + themes), derived from the
  // current card list so it stays honest as the deck is edited.
  const identity = useMemo(
    () =>
      commanderProfile
        ? deriveDeckIdentity({ profile: commanderProfile, selectedThemes, cards: allCards })
        : null,
    [commanderProfile, selectedThemes, allCards]
  );

  // "Why this card" synergy reasons, keyed by card name. Computed from the
  // commander's parsed ability profile so each row can explain its fit.
  const synergyByName = useMemo<Map<string, string[]>>(() => {
    const map = new Map<string, string[]>();
    if (!commanderProfile || commanderProfile.abilities.length === 0) return map;
    for (const dc of cards) {
      const card = dc.card;
      if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) continue;
      if (map.has(card.name)) continue;
      const reasons = whyCardMatches(card, commanderProfile);
      if (reasons.length > 0) map.set(card.name, reasons);
    }
    return map;
  }, [commanderProfile, cards]);

  // Stats summary line.
  const totalCards = allCards.length;
  const totalPrice = useMemo(
    () => allCards.reduce((sum, c) => sum + priceOf(c, currency), 0),
    [allCards, currency]
  );
  // Missing summary — cards in the deck that aren't allocated to a collection
  // copy (i.e. status !== 'allocated'). Surfaces buy-list info inline so we
  // don't need a separate banner above the deck.
  const missing = useMemo(() => {
    let count = 0;
    let price = 0;
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId);
      if (status === 'allocated') continue;
      count += 1;
      price += priceOf(dc.card, currency);
    }
    return { count, price };
  }, [cards, collectionByCopyId, currency]);
  // Owned-but-elsewhere count — mainboard cards you own where every copy is in
  // another deck. Drives the "Use my copies (N)" resolver banner. Uses the same
  // cross-deck context as the per-row chips so the number matches the rows.
  const claimedElsewhereCount = useMemo(() => {
    if (!crossDeck.copiesByName || !crossDeck.otherDeckAllocations) return 0;
    let n = 0;
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId, {
        cardName: dc.card.name,
        copiesByName: crossDeck.copiesByName,
        allocations: crossDeck.otherDeckAllocations,
      });
      if (status === 'claimed-elsewhere') n += 1;
    }
    return n;
  }, [cards, collectionByCopyId, crossDeck]);
  // Tally of the unallocated (missing) cards — the tappable "missing" stat opens
  // a carousel of these so the count doubles as a shopping list.
  const missingTally = useMemo(() => {
    const list: ScryfallCard[] = [];
    for (const dc of cards) {
      const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId);
      if (status === 'allocated') continue;
      list.push(dc.card);
    }
    return tallyNames(list);
  }, [cards, collectionByCopyId]);
  // Tally of every card in the deck (commanders included), feeding the tappable
  // "cards" stat → swipe the whole list.
  const deckTally = useMemo(() => tallyNames(allCards), [allCards]);
  // The deck's cards as carousel entries sorted by price (desc) — the tappable
  // "value" stat opens the most expensive cards first, each labeled with its
  // price so the carousel reads as a value breakdown.
  const valueEntries = useMemo<CarouselEntry[]>(() => {
    return tallyNames(allCards)
      .slice()
      .sort((a, b) => priceOf(b.card, currency) - priceOf(a.card, currency))
      .map((t) => ({
        name: t.name,
        label: formatMoney(priceOf(t.card, currency), { currency }),
        card: t.card,
      }));
  }, [allCards, currency]);
  // Mana curve / color demand+production / type breakdown / drill-downs — the
  // shared pure builder so this view and the deck-compare page agree exactly.
  const manaData = useMemo(
    () => buildManaData(allCards, commander, partnerCommander),
    [allCards, commander, partnerCommander]
  );

  const exportText = useMemo(
    () =>
      buildExport(
        commander,
        partnerCommander,
        cards,
        exportFormat,
        sideboard,
        collectionByCopyId,
        commanderAllocatedCopyId,
        partnerCommanderAllocatedCopyId
      ),
    [
      commander,
      partnerCommander,
      cards,
      exportFormat,
      sideboard,
      collectionByCopyId,
      commanderAllocatedCopyId,
      partnerCommanderAllocatedCopyId,
    ]
  );
  // If the parent passes both props, treat it as a controlled component
  // (their boolean wins). Otherwise fall back to internal state — keeps
  // simple callers ergonomic and avoids any setState-in-effect dance.
  const [internalExportOpen, setInternalExportOpen] = useState(false);
  const isControlled = exportOpenProp !== undefined && onExportOpenChange !== undefined;
  const exportOpen = isControlled ? exportOpenProp : internalExportOpen;
  const setExportOpen = (next: boolean) => {
    if (isControlled) onExportOpenChange(next);
    else setInternalExportOpen(next);
  };
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
    } catch {
      /* ignore */
    }
  };
  const handleDownload = () => {
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'deck';
    a.download = `${safeName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Card preview wiring ──────────────────────────────────────────────
  // Re-resolve rarity for cards whose stored snapshot defaulted to 'common'
  // (decks generated against the pre-#329 offline oracle). See the hook doc.
  const previewCards = useMemo<ScryfallCard[]>(
    () => visibleGroups.flatMap((g) => g.rows.map((r) => r.card)),
    [visibleGroups]
  );
  const rarityCorrections = useRarityCorrections(previewCards);
  const flat = useMemo(() => {
    const enrichedCards: EnrichedCard[] = [];
    const labels: string[] = [];
    const rows: Row[] = [];
    const indexByName = new Map<string, number>();
    // Mainboard first, then sideboard — so the carousel + hover-peek resolve
    // sideboard cards too (same inspect path as the mainboard). A name only in
    // the sideboard maps to its sideboard entry; a name in both keeps the
    // mainboard one (first wins).
    const pushGroups = (groups: typeof visibleGroups) => {
      for (const g of groups) {
        for (const row of g.rows) {
          if (!indexByName.has(row.name)) indexByName.set(row.name, enrichedCards.length);
          rows.push(row);
          enrichedCards.push(
            scryfallToEnrichedCard(row.card, {
              frontImageOverride: row.imageNormal,
              backImageOverride: row.imageNormalBack,
              sourceFormat: 'deck-builder',
              overrides: {
                foil: row.foil,
                finish: row.finish,
                finishes: row.finishes,
                promoTypes: row.promoTypes,
                frameEffects: row.frameEffects,
                setCode: row.setCode,
                setName: row.setName,
                collectorNumber: row.collectorNumber,
                rarity: row.card.oracle_id ? rarityCorrections.get(row.card.oracle_id) : undefined,
              },
            })
          );
          labels.push(g.title);
        }
      }
    };
    pushGroups(visibleGroups);
    pushGroups(visibleSideboardGroups);
    return { cards: enrichedCards, labels, rows, indexByName };
  }, [visibleGroups, visibleSideboardGroups, rarityCorrections]);

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Hover-peek for the list view — ROW-anchored (parks the card beside the row,
  // centered, stable) rather than cursor-anchored, so it never tracks the mouse
  // or floats over the row's ⋮ kebab. Gated to ≥1024px: the list is a dense CSS
  // multi-column flow, so only wide desktop has room beside it for a legible
  // (~200px) card without overlapping the columns. Tablet/phone (<1024px) skip
  // the peek and use the row's own thumbnail + click→carousel. No-op on
  // touch/native regardless.
  const hoverPeek = useDeckHoverPeek({ anchor: 'row', minViewport: 1024 });
  const openPreview = (rowName: string) => {
    hoverPeek.clear(); // the carousel supersedes the transient peek
    const i = flat.indexByName.get(rowName);
    if (i !== undefined) setPreviewIndex(i);
  };

  // Tap a headline stat (cards / value / missing) to drill into the cards behind
  // it — the same carousel pattern as the analysis-tab drill-downs.
  const statCarousel = useCardCarousel(title);

  const ctxValue = useMemo(
    () => ({
      openCard: () => {},
      openPages: () => {},
      isPreviewOpen: previewIndex !== null,
    }),
    [previewIndex]
  );

  return (
    <CardPreviewContext.Provider value={ctxValue}>
      <div
        className="deck-display"
        role="tabpanel"
        id={`deck-view-panel-${activeView}`}
        aria-labelledby={`sc-tab-${activeView}`}
      >
        {/* `deck` view: the card-list editing surface (toolbar + banner + body).
            The analysis views (stats/power/tune) replace it full-width — the
            page-top hub tab bar in DeckEditorPage switches between them. */}
        {activeView === 'deck' ? (
          <>
            <DeckToolbar
              title={title}
              sort={sort}
              sortDir={sortDir}
              onToggleSort={onToggleSort}
              search={search}
              onSearch={setSearch}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              gridSize={effectiveGridSize}
              onGridSizeChange={handleGridSizeChange}
              isNarrowGrid={isNarrowGrid}
              showPrefs={showPrefs}
              onShowPrefsChange={handleShowPrefsChange}
              onExport={() => setExportOpen(true)}
              onShowTestHand={onShowTestHand}
            />

            {/* High-level stats, glanceable while editing the list — these used
                to live behind the Overview analysis tab. Each reads as a metric:
                a bold value over a small muted label. */}
            <div className="deck-stat-strip" aria-label="Deck stats">
              {deckTally.length > 0 ? (
                <button
                  type="button"
                  className="deck-stat deck-stat-btn"
                  onClick={() =>
                    void statCarousel.open(tallyToEntries(deckTally), deckTally[0]?.name ?? '')
                  }
                  aria-label={`Show all ${totalCards} cards in the deck`}
                >
                  <span className="deck-stat-value">{totalCards}</span>
                  <span className="deck-stat-label">cards</span>
                </button>
              ) : (
                <span className="deck-stat">
                  <span className="deck-stat-value">{totalCards}</span>
                  <span className="deck-stat-label">cards</span>
                </span>
              )}
              <span className="deck-stat">
                <span className="deck-stat-value">{manaData.averageCmc.toFixed(2)}</span>
                <span className="deck-stat-label">avg mana value</span>
              </span>
              {valueEntries.length > 0 ? (
                <button
                  type="button"
                  className="deck-stat deck-stat-btn"
                  onClick={() => void statCarousel.open(valueEntries, valueEntries[0]?.name ?? '')}
                  aria-label="Show the deck's cards sorted by price, most valuable first"
                >
                  <span className="deck-stat-value">{formatMoney(totalPrice, { currency })}</span>
                  <span className="deck-stat-label">value</span>
                </button>
              ) : (
                <span className="deck-stat">
                  <span className="deck-stat-value">{formatMoney(totalPrice, { currency })}</span>
                  <span className="deck-stat-label">value</span>
                </span>
              )}
              {identity && (
                <span className="deck-stat">
                  <span className="deck-stat-value">{identity.archetypeLabel}</span>
                  <span className="deck-stat-label">archetype</span>
                </span>
              )}
              {missing.count > 0 &&
                (missingTally.length > 0 ? (
                  <button
                    type="button"
                    className="deck-stat deck-stat-missing deck-stat-btn"
                    onClick={() =>
                      void statCarousel.open(
                        tallyToEntries(missingTally),
                        missingTally[0]?.name ?? ''
                      )
                    }
                    aria-label={`Show the ${missing.count} missing cards (buy list)`}
                  >
                    <span className="deck-stat-value">{missing.count}</span>
                    <span className="deck-stat-label">
                      missing ({formatMoney(missing.price, { currency })})
                    </span>
                  </button>
                ) : (
                  <span className="deck-stat deck-stat-missing">
                    <span className="deck-stat-value">{missing.count}</span>
                    <span className="deck-stat-label">
                      missing ({formatMoney(missing.price, { currency })})
                    </span>
                  </span>
                ))}
            </div>
            {statCarousel.preview}

            {(flaggedCardCount > 0 || deckSizeWarning) && (
              <div className="deck-legality-banner">
                <CircleAlert width={16} height={16} strokeWidth={2} aria-hidden />
                {deckSizeWarning && <span>{deckSizeWarning}</span>}
                {deckSizeWarning && flaggedCardCount > 0 && <span aria-hidden>·</span>}
                {flaggedCardCount > 0 && (
                  <span>
                    {flaggedCardCount} {flaggedCardCount === 1 ? 'card' : 'cards'} flagged in{' '}
                    {formatConfig.label}
                  </span>
                )}
              </div>
            )}

            {onReviewShared && claimedElsewhereCount > 0 && (
              <div className="deck-claimed-banner">
                <Layers width={16} height={16} strokeWidth={2} aria-hidden />
                <span className="deck-claimed-banner-text">
                  {claimedElsewhereCount} {claimedElsewhereCount === 1 ? 'card' : 'cards'} here{' '}
                  {claimedElsewhereCount === 1 ? 'is' : 'are'} also in your other decks
                </span>
                <button
                  type="button"
                  className="btn btn-sm deck-claimed-banner-btn"
                  onClick={onReviewShared}
                >
                  Review
                </button>
              </div>
            )}

            <div className="deck-display-body">
              <div className="deck-display-main">
                {viewMode === 'list' && (
                  <div className="deck-card-list" {...hoverPeek.listHandlers}>
                    {visibleGroups.map((g) => (
                      <CategorySection
                        key={g.title}
                        title={g.title}
                        icon={g.icon}
                        rows={g.rows}
                        currency={currency}
                        showPrefs={showPrefs}
                        onRowClick={openPreview}
                        onRemoveCard={onRemoveCard}
                        onSetQty={onSetQty}
                        onEditCard={onEditCard}
                        legalityBySlot={legalityBySlot}
                        onMoveToSideboard={
                          formatConfig.sideboardSize > 0 ? onMoveToSideboard : undefined
                        }
                        onMakeCommander={onMakeCommander}
                        canMakeCommander={canMakeCommander}
                        onMakePartner={onMakePartner}
                        canMakePartner={canMakePartner}
                        onMoveToAnotherDeck={onMoveToAnotherDeck}
                        onReleaseCopy={onReleaseCopy}
                        onUseOwnCopy={onUseOwnCopy}
                        headerAction={
                          g.icon === 'ms-commander' && onEditPartner ? (
                            <PartnerHeaderButton
                              hasPartner={!!partnerCommander}
                              onClick={onEditPartner}
                            />
                          ) : undefined
                        }
                        synergyByName={synergyByName}
                        cardInclusionMap={cardInclusionMap}
                      />
                    ))}

                    {formatConfig.sideboardSize > 0 && (
                      <div className="deck-sideboard-section">
                        <h3 className="deck-sideboard-header">
                          Sideboard ({sideboard.length}
                          {Number.isFinite(formatConfig.sideboardSize)
                            ? `/${formatConfig.sideboardSize}`
                            : ''}
                          )
                        </h3>
                        {visibleSideboardGroups.map((g) => (
                          <CategorySection
                            key={`sb-${g.title}`}
                            title={g.title}
                            icon={g.icon}
                            rows={g.rows}
                            currency={currency}
                            showPrefs={showPrefs}
                            onRowClick={openPreview}
                            onRemoveCard={onRemoveSideboardCard}
                            onSetQty={undefined}
                            onEditCard={onEditCard}
                            legalityBySlot={legalityBySlot}
                            onMoveToMainboard={onMoveToMainboard}
                            onMakeCommander={onMakeCommander}
                            canMakeCommander={canMakeCommander}
                            onMakePartner={onMakePartner}
                            canMakePartner={canMakePartner}
                            onMoveToAnotherDeck={onMoveToAnotherDeck}
                            onReleaseCopy={onReleaseCopy}
                            onUseOwnCopy={onUseOwnCopy}
                            synergyByName={synergyByName}
                            cardInclusionMap={cardInclusionMap}
                          />
                        ))}
                        {sideboard.length === 0 && (
                          <p className="deck-sideboard-empty">No sideboard cards yet</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {viewMode === 'grid' && (
                  <DeckCardGrid
                    groups={visibleGroups}
                    onRowClick={openPreview}
                    legalityBySlot={legalityBySlot}
                    gridSize={effectiveGridSize}
                    showRoles={showPrefs.roles}
                    synergyByName={synergyByName}
                    binderByCopyId={binderByCopyId}
                    hasPartner={!!partnerCommander}
                    onEditPartner={onEditPartner}
                  />
                )}
                {onAddFromSearch && search.trim().length >= 1 && noDeckMatches && (
                  <button
                    type="button"
                    className="deck-display-scryfall-trigger"
                    onClick={() => onAddFromSearch(search.trim())}
                    aria-label={`Search Scryfall for ${search.trim()} to add a card not in this deck`}
                  >
                    <Search width={16} height={16} strokeWidth={1.8} aria-hidden />
                    <span className="deck-display-scryfall-trigger-text">
                      <span className="deck-display-scryfall-trigger-title">Search Scryfall</span>
                      <span className="deck-display-scryfall-trigger-sub">
                        for "{search.trim()}" — add a card not in this deck
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <DeckAnalysisView
            view={activeView}
            allCards={allCards}
            manaData={manaData}
            bracketEstimation={bracketEstimation}
            deckCardsByName={deckCardsByName}
            bracketOverride={bracketOverride}
            onSetBracketOverride={onSetBracketOverride}
            roleCounts={roleCounts}
            roleTargets={roleTargets}
            buildReport={buildReport}
            rampSubtypeCounts={rampSubtypeCounts}
            removalSubtypeCounts={removalSubtypeCounts}
            boardwipeSubtypeCounts={boardwipeSubtypeCounts}
            cardDrawSubtypeCounts={cardDrawSubtypeCounts}
            averageSalt={averageSalt}
            saltiestCards={saltiestCards}
            planScore={planScore}
            combosSlot={combosSlot}
            coachFeedSlot={coachFeedSlot}
            engineSlot={engineSlot}
            winConditionSlot={winConditionSlot}
            powerHeroSlot={powerHeroSlot}
            commanderIdentity={commanderIdentity}
            analysisState={analysisState}
            onNavigateToTune={onNavigateToTune}
            commander={commander}
            partnerCommander={partnerCommander}
            deckName={title}
            format={format}
            deckColor={color ?? 'var(--accent)'}
            identity={identity}
            scoreRevealKey={scoreRevealKey}
          />
        )}

        {/* Desktop-only floating hover-peek: a transient card-art preview in the
            gutter beside the list while hovering a row. No-op on touch/native. */}
        {hoverPeek.peek &&
          (() => {
            // A printing sub-row carries its own art (data-peek-img); use it so
            // each expanded printing peeks its real card. Otherwise resolve the
            // hovered card's hero art by name from the same flat list the
            // carousel uses, so the peek matches the owned printing.
            const i = flat.indexByName.get(hoverPeek.peek.name);
            const card = i !== undefined ? flat.cards[i] : undefined;
            return (
              <DeckHoverPeek
                imageUrl={hoverPeek.peek.img || card?.imageLarge || card?.imageNormal}
                left={hoverPeek.peek.left}
                top={hoverPeek.peek.top}
                width={hoverPeek.peek.width}
              />
            );
          })()}

        {previewIndex !== null && (
          <CardPreview
            source="deck"
            cards={flat.cards}
            sectionLabels={flat.labels}
            pageNumbers={flat.cards.map(() => 0)}
            totalPages={1}
            binderName={title}
            currentDeckId={deckId}
            index={previewIndex}
            onIndexChange={setPreviewIndex}
            onClose={() => setPreviewIndex(null)}
            renderPanelMeta={(i) => {
              const r = flat.rows[i];
              if (!r) return null;
              return (
                <DeckCardPreviewMeta
                  card={r.card}
                  isPartner={r.isPartner}
                  isCommander={!r.isPartner && commander?.name === r.name}
                  synergies={synergyByName?.get(r.name)}
                  inclusionPct={cardInclusionMap?.[r.name]}
                  legality={r.slotIds[0] ? legalityBySlot.get(r.slotIds[0]) : undefined}
                  status={r.status}
                />
              );
            }}
            renderPanelExtra={(i) => {
              // In-context "Swap this card" + "Similar cards": offered only for a
              // real in-deck card (commander/partner rows carry no slotId, so
              // they're excluded).
              const r = flat.rows[i];
              if (!r) return null;
              const slotId = r.slotIds[r.slotIds.length - 1];
              if (!slotId) return null;
              const close = () => setPreviewIndex(null);
              return (
                <>
                  {renderSwapSuggestions?.(r.card, slotId, close)}
                  {renderSimilarCards?.(r.card, slotId, close)}
                </>
              );
            }}
            getStackBinders={(i) => {
              const r = flat.rows[i];
              if (!r || !binderByCopyId) return [];
              const seen = new Set<string>();
              const out: BinderInfo[] = [];
              for (const cid of r.allocatedCopyIds) {
                for (const b of binderByCopyId.get(cid) ?? []) {
                  if (!seen.has(b.id)) {
                    seen.add(b.id);
                    out.push(b);
                  }
                }
              }
              return out;
            }}
            getStackAllocations={(i) => {
              const r = flat.rows[i];
              if (!r || !crossDeck.otherDeckAllocations) return [];
              const seen = new Set<string>();
              const out: AllocationInfo[] = [];
              for (const cid of r.allocatedCopyIds) {
                const a = crossDeck.otherDeckAllocations.get(cid);
                // Dedupe on ownerId, not the legacy deckId alias — every cube
                // claim shares deckId='' and would otherwise collapse to one.
                if (a && !seen.has(a.ownerId)) {
                  seen.add(a.ownerId);
                  out.push(a);
                }
              }
              return out;
            }}
            getActions={(i) => {
              const r = flat.rows[i];
              if (!r) return [];
              const acts: CardPreviewAction[] = [];
              const slotId = r.slotIds[0];
              if (onEditCard && slotId) {
                acts.push({
                  key: 'edit',
                  label: 'Edit',
                  icon: <Pencil width={18} height={18} strokeWidth={2} aria-hidden />,
                  onClick: () => {
                    setPreviewIndex(null);
                    onEditCard(slotId, r.card);
                  },
                });
              }
              if (onRemoveCard && r.slotIds.length > 0) {
                acts.push({
                  key: 'delete',
                  label: 'Delete',
                  danger: true,
                  icon: <Trash2 width={18} height={18} strokeWidth={2} aria-hidden />,
                  onClick: () => {
                    setPreviewIndex(null);
                    onRemoveCard(r.slotIds[r.slotIds.length - 1]);
                  },
                });
              }
              return acts;
            }}
          />
        )}
        {exportOpen && (
          <ExportDialog
            text={exportText}
            format={exportFormat}
            onFormatChange={handleExportFormatChange}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
    </CardPreviewContext.Provider>
  );
}

function ExportDialog({
  text,
  format,
  onFormatChange,
  onCopy,
  onDownload,
  onClose,
}: {
  text: string;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const lineCount = useMemo(() => text.split('\n').filter(Boolean).length, [text]);
  const handleCopyClick = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Modal onClose={onClose} className="modal export-dialog" labelledBy="export-deck-title">
      <div className="export-dialog-header">
        <h2 id="export-deck-title" className="export-dialog-title">
          Export deck
        </h2>
        <button type="button" className="export-dialog-close" aria-label="Close" onClick={onClose}>
          <X width={18} height={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <div className="export-dialog-body">
        <div className="export-dialog-controls">
          <SelectMenu
            label="Format"
            ariaLabel="Export format"
            value={format}
            onChange={(v) => onFormatChange(v as ExportFormat)}
            options={(Object.keys(EXPORT_FORMAT_LABEL) as ExportFormat[]).map((f) => ({
              value: f,
              label: EXPORT_FORMAT_LABEL[f],
            }))}
          />
          <span className="export-dialog-meta">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
          <div className="export-dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={onDownload}
              aria-label="Download as text file"
            >
              <Download width={14} height={14} strokeWidth={2} aria-hidden />
              <span>Download</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopyClick}
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check width={14} height={14} strokeWidth={2.5} aria-hidden />
              ) : (
                <Clipboard width={14} height={14} strokeWidth={2} aria-hidden />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
        <textarea
          className="export-dialog-preview"
          value={text}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </Modal>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────
interface ToolbarProps {
  title: string;
  sort: SortMode;
  sortDir: 'asc' | 'desc';
  onToggleSort: (s: SortMode) => void;
  search: string;
  onSearch: (s: string) => void;
  viewMode: DeckViewMode;
  onViewModeChange: (m: DeckViewMode) => void;
  gridSize: DeckGridSize;
  onGridSizeChange: (s: DeckGridSize) => void;
  isNarrowGrid: boolean;
  showPrefs: ShowPrefs;
  onShowPrefsChange: (next: ShowPrefs) => void;
  onExport: () => void;
  /** Reveal the standalone Test hand panel (goldfishing acts on this list). */
  onShowTestHand?: () => void;
}

const SORT_LABEL: Record<SortMode, string> = {
  name: 'Name',
  cmc: 'Mana value',
  color: 'Color',
  price: 'Price',
  added: 'Added',
};
const SORT_ORDER: SortMode[] = ['name', 'cmc', 'color', 'price', 'added'];

const SHOW_PREFS_LABEL: Record<keyof ShowPrefs, string> = {
  price: 'Price',
  roles: 'Roles',
  mana: 'Mana cost',
};

// The full role-badge key: every 2-letter abbreviation spelled out,
// grouped by top-level role. Shared by the toolbar legend (below) and
// the tap-to-reveal badge popover so the two can't drift. `highlightTone`
// emphasises the row for the badge a user just tapped.
function RoleBadgeKey({ highlightTone }: { highlightTone?: string }) {
  return (
    <div className="deck-role-legend-body" role="group" aria-label="Role badge key">
      {ROLE_BADGE_GROUPS.map((g) => (
        <div key={g.group} className="deck-role-legend-group">
          <div className="deck-role-legend-group-title">{g.group}</div>
          {g.tones.map((tone) => (
            <div
              key={tone}
              className={`deck-role-legend-item${
                tone === highlightTone ? ' deck-role-legend-item--active' : ''
              }`}
            >
              <span className={`deck-row-role-badge deck-row-role-${tone}`} aria-hidden>
                {ROLE_BADGE_BY_TONE[tone].label}
              </span>
              {ROLE_BADGE_BY_TONE[tone].title}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Collapsible key for the cryptic 2-letter role badges, surfaced from
// the toolbar "Show" popover (next to the Roles toggle). Lives inside
// that popover so it inherits its dismiss handling.
function RoleBadgeLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="deck-role-legend">
      <button
        type="button"
        className="deck-role-legend-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown width={13} height={13} strokeWidth={2} aria-hidden />
        ) : (
          <ChevronRight width={13} height={13} strokeWidth={2} aria-hidden />
        )}
        What do the role badges mean?
      </button>
      {open && <RoleBadgeKey />}
    </div>
  );
}

// A single deck-list / grid role badge, now tap-to-reveal: on touch (no
// hover) the native `title` tooltip never appears, so tapping the badge
// opens a popover with the full role key — the tapped role highlighted.
// Tapping the badge on mobile shows just the role name — no legend.
// The full legend is still reachable via the toolbar "Show" → "What do
// the role badges mean?" disclosure. Desktop keeps the native title
// hover tooltip so it still works without a tap.
function RoleBadge({ card, variant }: { card: ScryfallCard; variant: 'row' | 'grid' }) {
  const roleBadge = getRoleBadge(card);
  if (!roleBadge) return null;
  const multi = variant === 'row' && isMultiRole(card);
  const baseClass = variant === 'grid' ? 'deck-card-grid-role' : 'deck-row-role-badge';
  const toneClass = multi ? 'deck-row-role-multi' : `deck-row-role-${roleBadge.tone}`;
  const tipText = multi ? multiRoleTitle(card) : roleBadge.title;
  return (
    <ToolbarPopover
      wrapperClassName="role-badge-pop-wrap"
      triggerClassName={`role-badge-btn ${baseClass} ${toneClass}`}
      triggerTitle={tipText}
      triggerAriaLabel={`Role: ${tipText}`}
      triggerContent={
        multi ? <span className="deck-row-role-multi-dot" aria-hidden /> : roleBadge.label
      }
    >
      {() => <div className="role-badge-pop">{tipText}</div>}
    </ToolbarPopover>
  );
}

function DeckToolbar({
  title,
  sort,
  sortDir,
  onToggleSort,
  search,
  onSearch,
  viewMode,
  onViewModeChange,
  gridSize,
  onGridSizeChange,
  isNarrowGrid,
  showPrefs,
  onShowPrefsChange,
  onExport,
  onShowTestHand,
}: ToolbarProps) {
  return (
    <header className="deck-toolbar">
      <div className="deck-toolbar-summary">
        <span className="deck-toolbar-title">{title}</span>
        {/* Grade and missing-cards count live in the Statistics → Overview
            panel now, so the toolbar stays focused on the deck title +
            controls. */}
      </div>
      <div className="deck-toolbar-controls">
        <SelectMenu
          ariaLabel="Sort"
          value={sort}
          options={SORT_ORDER.map((m) => ({ value: m, label: SORT_LABEL[m] }))}
          onChange={onToggleSort}
          closeOnSelect={false}
          leadingIcon={<SortDirArrow dir={sortDir} />}
          renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={sortDir} /> : null)}
        />

        <ToolbarPopover
          label="Show"
          icon={<Eye width={14} height={14} strokeWidth={2} aria-hidden />}
        >
          {() => (
            <>
              <ul className="toolbar-popover-list" role="menu" aria-label="Row details">
                {(Object.keys(SHOW_PREFS_LABEL) as (keyof ShowPrefs)[]).map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={showPrefs[k]}
                      className={`toolbar-popover-item${showPrefs[k] ? ' active' : ''}`}
                      onClick={() => onShowPrefsChange({ ...showPrefs, [k]: !showPrefs[k] })}
                    >
                      <span className="toolbar-popover-check" aria-hidden>
                        {showPrefs[k] ? '✓' : ''}
                      </span>
                      {SHOW_PREFS_LABEL[k]}
                    </button>
                  </li>
                ))}
              </ul>
              <RoleBadgeLegend />
            </>
          )}
        </ToolbarPopover>

        <SearchPill
          className="deck-toolbar-search"
          placeholder="Search…"
          value={search}
          onChange={onSearch}
          ariaLabel="Search this deck"
        />

        <DeckViewModeToggle value={viewMode} onChange={onViewModeChange} />

        {viewMode === 'grid' && (
          <SharedViewModeToggle<DeckGridSize>
            ariaLabel="Card size"
            value={gridSize}
            onChange={onGridSizeChange}
            options={
              isNarrowGrid
                ? [
                    { value: '1x', label: 'Small cards', icon: <span>1×</span> },
                    { value: '2x', label: 'Medium cards', icon: <span>2×</span> },
                  ]
                : [
                    { value: '1x', label: 'Small cards', icon: <span>1×</span> },
                    { value: '2x', label: 'Medium cards', icon: <span>2×</span> },
                    { value: '3x', label: 'Large cards', icon: <span>3×</span> },
                  ]
            }
          />
        )}

        {/* The symbol key is the trailing reference control, grouped with the
            view-mode toggles — it sits after them and before the action buttons
            (Test hand / Export), per STYLE_GUIDE § Symbol key / Legend. */}
        <Legend context="deck" align="right" variant="pill" />

        {onShowTestHand && (
          <button
            type="button"
            className="btn deck-toolbar-test-hand"
            onClick={onShowTestHand}
            title="Draw an opening hand"
          >
            <Hand width={14} height={14} strokeWidth={2} aria-hidden />
            Test hand
          </button>
        )}

        <button type="button" className="btn btn-primary deck-toolbar-export" onClick={onExport}>
          Export
        </button>
      </div>
    </header>
  );
}

// ── Toolbar popover (portal-positioned, same mechanism as SelectMenu) ───
type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

function ToolbarPopover({
  label,
  ariaLabel,
  icon,
  triggerClassName,
  triggerContent,
  triggerTitle,
  triggerAriaLabel,
  wrapperClassName,
  haspopup,
  panelClassName,
  panelRole,
  panelAriaLabel,
  children,
}: {
  label?: string;
  ariaLabel?: string;
  icon?: React.ReactNode;
  // Custom trigger styling/content. When set, replaces the default
  // toolbar pill — ToolbarPopover still owns the <button> (and its
  // ref), so non-toolbar callers (e.g. the tap-to-reveal role badge)
  // reuse this popover's portal + viewport-clamping machinery.
  triggerClassName?: string;
  triggerContent?: React.ReactNode;
  triggerTitle?: string;
  triggerAriaLabel?: string;
  wrapperClassName?: string;
  // Panel semantics/skin overrides. Default is the toolbar dialog look; a
  // role="menu" caller (e.g. the deck-row kebab) passes its own class + role.
  haspopup?: 'menu' | 'dialog';
  panelClassName?: string;
  panelRole?: string;
  panelAriaLabel?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      buttonRef.current.getBoundingClientRect(),
      panelRef.current.getBoundingClientRect(),
      safe,
      'right',
      6
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => {
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    let scrollRaf = 0;
    scrollRaf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(scrollRaf);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    // Keep the tap on the trigger — don't let it reach an ancestor
    // handler (e.g. the deck row / grid tile that opens the card).
    e.stopPropagation();
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const safe = getSafeViewport();
      const spaceBelow = safe.bottom - rect.bottom;
      const right = Math.max(0, safe.right - rect.right);
      setPanelPos(
        spaceBelow >= 160
          ? { top: rect.bottom + 6, right }
          : { bottom: window.innerHeight - rect.top + 6, right }
      );
    }
    setOpen((v) => !v);
  };

  const panel =
    open &&
    panelPos &&
    createPortal(
      <div
        ref={panelRef}
        className={panelClassName ?? 'toolbar-popover-panel toolbar-popover-panel--fixed'}
        role={panelRole}
        aria-label={panelAriaLabel}
        style={{
          position: 'fixed',
          left: panelPos.left,
          right: panelPos.right,
          top: panelPos.top,
          bottom: panelPos.bottom,
          zIndex: 1200,
          // Scale the enter animation from the trigger corner: anchored-side
          // top/bottom + left/right mirror how the panel was placed.
          transformOrigin: `${panelPos.top !== undefined ? 'top' : 'bottom'} ${
            panelPos.left !== undefined ? 'left' : 'right'
          }`,
        }}
      >
        {children(() => setOpen(false))}
      </div>,
      document.body
    );

  return (
    <div className={wrapperClassName ?? 'toolbar-popover'} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName ?? `toolbar-pill${open ? ' open' : ''}`}
        aria-haspopup={haspopup ?? (triggerClassName ? 'dialog' : 'menu')}
        aria-expanded={open}
        data-open={open || undefined}
        aria-label={triggerAriaLabel ?? (!label ? ariaLabel : undefined)}
        title={triggerTitle}
        onClick={handleToggle}
      >
        {triggerClassName ? (
          triggerContent
        ) : (
          <>
            {icon}
            {label && <span className="toolbar-pill-label">{label}</span>}
            <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
          </>
        )}
      </button>
      {panel}
    </div>
  );
}

// ── View mode segmented control ──────────────────────────────────────────
// Thin wrapper around the shared <SharedViewModeToggle /> with deck-specific
// options (grid / list / text). No 'compact' — see the type declaration.
function DeckViewModeToggle({
  value,
  onChange,
}: {
  value: DeckViewMode;
  onChange: (m: DeckViewMode) => void;
}) {
  return (
    <SharedViewModeToggle<DeckViewMode>
      ariaLabel="Deck view mode"
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'grid',
          label: 'Grid view',
          icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
        },
        {
          value: 'list',
          label: 'List view',
          icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
        },
      ]}
    />
  );
}

// ── Legality badge ──────────────────────────────────────────────────────
// Shared by list and grid view. Theme-colored; caller sets size/position
// via className.
function LegalityBadge({ issue, className }: { issue: LegalityIssue; className: string }) {
  return (
    <span className={className} role="img" aria-label={issue.detail} title={issue.detail}>
      <CircleAlert width="100%" height="100%" strokeWidth={2.2} aria-hidden />
    </span>
  );
}

// ── Grid view ────────────────────────────────────────────────────────────
function DeckCardGrid({
  groups,
  onRowClick,
  legalityBySlot,
  gridSize,
  showRoles,
  synergyByName,
  binderByCopyId,
  hasPartner,
  onEditPartner,
}: {
  groups: { title: string; icon: string; rows: Row[] }[];
  onRowClick: (name: string) => void;
  legalityBySlot?: Map<string, LegalityIssue>;
  gridSize: DeckGridSize;
  showRoles: boolean;
  synergyByName?: Map<string, string[]>;
  binderByCopyId?: Map<string, BinderInfo[]>;
  hasPartner?: boolean;
  onEditPartner?: () => void;
}) {
  return (
    <div className="deck-card-grid-sections">
      {groups.map((g) => {
        if (g.rows.length === 0) return null;
        const count = g.rows.reduce((s, r) => s + r.qty, 0);
        return (
          <section key={g.title} className="deck-grid-section">
            <header className="deck-section-header">
              <span className="deck-section-icon">
                <ManaSymbol symbol={g.icon} />
              </span>
              <h3 className="deck-section-title">
                {g.title} <span className="deck-section-count">({count})</span>
              </h3>
              {g.icon === 'ms-commander' && onEditPartner && (
                <PartnerHeaderButton hasPartner={!!hasPartner} onClick={onEditPartner} />
              )}
            </header>
            <ul className={`deck-card-grid grid-${gridSize}`}>
              {g.rows.map((row) => {
                const role = showRoles ? getRoleBadge(row.card) : null;
                const synergy = synergyByName?.get(row.name);
                const binders: BinderInfo[] = [];
                if (binderByCopyId) {
                  const seen = new Set<string>();
                  for (const cid of row.allocatedCopyIds) {
                    for (const b of binderByCopyId.get(cid) ?? []) {
                      if (!seen.has(b.id)) {
                        seen.add(b.id);
                        binders.push(b);
                      }
                    }
                  }
                }
                return (
                  <li key={row.name} className="deck-card-grid-cell">
                    <button
                      type="button"
                      className={`deck-card-grid-tile${foilTileClass(row)}`}
                      onClick={() => onRowClick(row.name)}
                      aria-label={`${row.name} (${row.qty} in deck — ${allocationSummary(row)})`}
                    >
                      {row.imageNormal ? (
                        <img
                          src={row.imageNormal}
                          alt=""
                          className="deck-card-grid-image"
                          loading="lazy"
                        />
                      ) : (
                        <span className="deck-card-grid-fallback">{row.name}</span>
                      )}
                      {/* Foil is shown by the holographic overlay alone — no
                          text pip (keeps the corners free for status icons). */}
                      {row.foil && row.imageNormal && <FoilShimmer />}
                      {row.qty > 1 && <span className="deck-card-grid-qty">×{row.qty}</span>}
                      {row.status !== 'allocated' &&
                        (row.allocatedQty > 0 ? (
                          <span
                            className={`deck-card-grid-alloc deck-card-grid-alloc-${
                              row.orphanQty > 0 ? 'orphan' : 'unowned'
                            }`}
                            title={allocationSummary(row)}
                            aria-label={allocationSummary(row)}
                          >
                            {row.allocatedQty}/{row.qty}
                          </span>
                        ) : (
                          <span
                            className="deck-card-grid-missing"
                            title={allocationSummary(row)}
                            aria-label={allocationSummary(row)}
                          />
                        ))}
                      {(() => {
                        const issue = legalityBySlot?.get(row.slotIds[0]);
                        return issue ? (
                          <LegalityBadge issue={issue} className="deck-card-grid-illegal" />
                        ) : null;
                      })()}
                    </button>
                    {(row.isPartner ||
                      role ||
                      (synergy && synergy.length > 0) ||
                      binders.length > 0) && (
                      <div className="deck-card-grid-badges">
                        {row.isPartner && (
                          <span
                            className="deck-card-grid-partner"
                            title="Partner commander"
                            aria-label="Partner commander"
                          >
                            <Handshake width={13} height={13} strokeWidth={2.4} aria-hidden />
                          </span>
                        )}
                        {binders.length > 0 && <BinderBadge binders={binders} />}
                        {synergy && synergy.length > 0 && (
                          <span
                            className="deck-card-grid-synergy"
                            role="img"
                            title={`Synergy with your commander:\n• ${synergy.join('\n• ')}`}
                            aria-label={`Synergy: ${synergy.join('; ')}`}
                          >
                            ✦
                          </span>
                        )}
                        {role && <RoleBadge card={row.card} variant="grid" />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// Commander-section header control for adding / changing the partner
// commander. Shared by the list and grid views so the affordance reads the
// same in both. Label flips to "Edit partner" once a partner is set.
function PartnerHeaderButton({
  hasPartner,
  onClick,
}: {
  hasPartner: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-link deck-section-partner-btn"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {hasPartner ? 'Edit partner' : '+ Add partner'}
    </button>
  );
}

// ── Category section ──────────────────────────────────────────────────────
function CategorySection({
  title,
  icon,
  rows,
  currency,
  showPrefs,
  onRowClick,
  onRemoveCard,
  onSetQty,
  onEditCard,
  legalityBySlot,
  onMoveToSideboard,
  onMoveToMainboard,
  onMakeCommander,
  canMakeCommander,
  onMakePartner,
  canMakePartner,
  onMoveToAnotherDeck,
  onReleaseCopy,
  onUseOwnCopy,
  headerAction,
  synergyByName,
  cardInclusionMap,
}: {
  title: string;
  icon: string;
  rows: Row[];
  currency: CurrencyCode;
  showPrefs: ShowPrefs;
  onRowClick: (name: string) => void;
  onRemoveCard?: (slotId: string) => void;
  onSetQty?: (card: ScryfallCard, qty: number) => void;
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  legalityBySlot?: Map<string, LegalityIssue>;
  onMoveToSideboard?: (slotId: string) => void;
  onMoveToMainboard?: (slotId: string) => void;
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  canMakeCommander?: (card: ScryfallCard) => boolean;
  onMakePartner?: (slotId: string, card: ScryfallCard) => void;
  canMakePartner?: (card: ScryfallCard) => boolean;
  onMoveToAnotherDeck?: (card: ScryfallCard) => void;
  onReleaseCopy?: (card: ScryfallCard) => void;
  onUseOwnCopy?: (card: ScryfallCard) => void;
  /** Optional control rendered at the end of the section header (e.g. the
   *  Commander section's "Add/Edit partner" button). */
  headerAction?: React.ReactNode;
  synergyByName?: Map<string, string[]>;
  cardInclusionMap?: Record<string, number>;
}) {
  // Hooks must run unconditionally — keep them above the empty-section early
  // return (a section emptying from N→0 cards would otherwise change the hook
  // count between renders and crash).
  const listRef = useRef<HTMLUListElement | null>(null);
  const { entries, registerItem, onExitEnd } = useListFlip(rows, (r) => r.name, listRef);

  if (rows.length === 0) return null;
  const subtotal = rows.reduce((sum, r) => sum + r.price, 0);
  const count = rows.reduce((sum, r) => sum + r.qty, 0);

  return (
    <section className="deck-section">
      <header className="deck-section-header">
        <span className="deck-section-icon">
          <ManaSymbol symbol={icon} />
        </span>
        <h3 className="deck-section-title">
          {title} <span className="deck-section-count">({count})</span>
        </h3>
        {showPrefs.price && (
          <span className="deck-section-subtotal">{formatMoney(subtotal, { currency })}</span>
        )}
        {headerAction}
      </header>
      <ul className="deck-section-rows" ref={listRef}>
        {entries.map((entry) => (
          <DeckCardRow
            key={entry.key}
            row={entry.item}
            currency={currency}
            showPrefs={showPrefs}
            onClick={() => onRowClick(entry.item.name)}
            onRemoveCard={entry.leaving ? undefined : onRemoveCard}
            onSetQty={entry.leaving ? undefined : onSetQty}
            onEditCard={entry.leaving ? undefined : onEditCard}
            legalityIssue={legalityBySlot?.get(entry.item.slotIds[0])}
            onMoveToZone={entry.leaving ? undefined : (onMoveToSideboard ?? onMoveToMainboard)}
            moveLabel={
              onMoveToSideboard
                ? 'Move to sideboard'
                : onMoveToMainboard
                  ? 'Move to mainboard'
                  : undefined
            }
            onMakeCommander={entry.leaving ? undefined : onMakeCommander}
            canMakeCommander={canMakeCommander}
            onMakePartner={entry.leaving ? undefined : onMakePartner}
            canMakePartner={canMakePartner}
            onMoveToAnotherDeck={entry.leaving ? undefined : onMoveToAnotherDeck}
            onReleaseCopy={entry.leaving ? undefined : onReleaseCopy}
            onUseOwnCopy={entry.leaving ? undefined : onUseOwnCopy}
            synergyReasons={synergyByName?.get(entry.item.card.name)}
            inclusionPct={cardInclusionMap?.[entry.item.card.name]}
            entering={entry.entering}
            leaving={entry.leaving}
            leavingStyle={entry.leaving ? entry.style : undefined}
            itemRef={(el) => registerItem(entry.key, el)}
            onLeavingAnimationEnd={() => onExitEnd(entry.key)}
          />
        ))}
      </ul>
    </section>
  );
}

function DeckCardRow({
  row,
  currency,
  showPrefs,
  onClick,
  onRemoveCard,
  onSetQty,
  onEditCard,
  legalityIssue,
  onMoveToZone,
  moveLabel,
  onMakeCommander,
  canMakeCommander,
  onMakePartner,
  canMakePartner,
  onMoveToAnotherDeck,
  onReleaseCopy,
  onUseOwnCopy,
  synergyReasons,
  inclusionPct,
  entering,
  leaving,
  leavingStyle,
  itemRef,
  onLeavingAnimationEnd,
}: {
  row: Row;
  currency: CurrencyCode;
  showPrefs: ShowPrefs;
  onClick: () => void;
  onRemoveCard?: (slotId: string) => void;
  onSetQty?: (card: ScryfallCard, qty: number) => void;
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  legalityIssue?: LegalityIssue;
  onMoveToZone?: (slotId: string) => void;
  moveLabel?: string;
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  canMakeCommander?: (card: ScryfallCard) => boolean;
  onMakePartner?: (slotId: string, card: ScryfallCard) => void;
  canMakePartner?: (card: ScryfallCard) => boolean;
  onMoveToAnotherDeck?: (card: ScryfallCard) => void;
  onReleaseCopy?: (card: ScryfallCard) => void;
  onUseOwnCopy?: (card: ScryfallCard) => void;
  synergyReasons?: string[];
  /** EDHREC inclusion rate (0–100) for this card; renders a subtle chip when set. */
  inclusionPct?: number;
  /** True on the commit this key first appears — drives the enter keyframe. */
  entering?: boolean;
  /** True when this row is a ghost playing its leave animation. */
  leaving?: boolean;
  /** Inline style pinning the ghost at its last in-flow top offset (absolute). */
  leavingStyle?: React.CSSProperties;
  /** Callback ref forwarded to the root <li> for FLIP measurement. */
  itemRef?: (el: HTMLLIElement | null) => void;
  /** Called on animationend to drop the ghost. */
  onLeavingAnimationEnd?: () => void;
}) {
  const roleBadge = showPrefs.roles ? getRoleBadge(row.card) : null;
  const mana = showPrefs.mana ? frontFaceMana(row.card) : undefined;
  const canRemove = !!onRemoveCard && row.slotIds.length > 0;
  const canEditQty = !!onSetQty && row.slotIds.length > 0;
  const [editingQty, setEditingQty] = useState(false);
  // Only stacks that actually span >1 printing get an expand affordance — a
  // uniform "Mountain ×22" has nothing to reveal.
  const multiPrinting = row.printings.length > 1;
  const [expanded, setExpanded] = useState(false);
  const subListId = `printings-${row.slotIds[0] ?? row.name}`;

  const handleRemoveOne = (e: React.MouseEvent | React.KeyboardEvent, close: () => void) => {
    e.stopPropagation();
    close();
    if (canRemove) onRemoveCard!(row.slotIds[row.slotIds.length - 1]);
  };
  const handleRemoveAll = (e: React.MouseEvent, close: () => void) => {
    e.stopPropagation();
    close();
    // Prefer the bulk path so the host can show one undo toast for the whole batch.
    if (canEditQty) onSetQty!(row.card, 0);
    else if (canRemove) {
      for (const slotId of [...row.slotIds].reverse()) onRemoveCard!(slotId);
    }
  };
  const startEditQty = (e: React.MouseEvent) => {
    if (!canEditQty) return;
    e.stopPropagation();
    setEditingQty(true);
  };
  const commitQty = (raw: string) => {
    setEditingQty(false);
    if (!canEditQty) return;
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(99, parsed));
    if (clamped !== row.qty) onSetQty!(row.card, clamped);
  };

  const rowClass =
    `deck-row` +
    (entering ? ' is-entering' : '') +
    (leaving ? ' is-leaving' : '') +
    (multiPrinting && expanded ? ' is-expanded' : '');

  return (
    <>
      <li
        className={rowClass}
        data-peek-name={row.name}
        onClick={leaving ? undefined : onClick}
        role={leaving ? undefined : 'button'}
        tabIndex={leaving ? -1 : 0}
        aria-hidden={leaving ? true : undefined}
        ref={itemRef}
        style={leavingStyle}
        onAnimationEnd={leaving ? onLeavingAnimationEnd : undefined}
        onKeyDown={
          leaving
            ? undefined
            : (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick();
                }
              }
        }
      >
        {canEditQty && editingQty ? (
          <input
            type="number"
            min={0}
            max={99}
            autoFocus
            defaultValue={row.qty}
            className={`deck-row-qty-input${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
            aria-label={`Quantity of ${row.name} in deck`}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitQty(e.currentTarget.value);
              if (e.key === 'Escape') setEditingQty(false);
            }}
            onBlur={(e) => commitQty(e.target.value)}
          />
        ) : canEditQty ? (
          <button
            type="button"
            className={`deck-row-qty deck-row-qty-edit${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
            aria-label={allocationAriaLabel(row, { editable: true })}
            title={allocationTitle(row, { editable: true })}
            onClick={startEditQty}
          >
            {row.qty}
          </button>
        ) : (
          <span
            className={`deck-row-qty${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
            aria-label={allocationAriaLabel(row, { editable: false })}
            title={allocationTitle(row, { editable: false })}
          >
            {row.qty}
          </span>
        )}
        {showPrefs.roles &&
          (roleBadge ? (
            <RoleBadge card={row.card} variant="row" />
          ) : (
            <span className="deck-row-role-badge deck-row-role-empty" aria-hidden />
          ))}
        <span className="deck-row-name" title={row.card.type_line}>
          <span className="deck-row-name-text" title={row.name}>
            {row.name}
          </span>
          {multiPrinting && (
            <button
              type="button"
              className="deck-row-printings-toggle"
              aria-expanded={expanded}
              aria-controls={subListId}
              aria-label={
                expanded
                  ? `Collapse ${row.name} printings`
                  : `Show ${row.printings.length} printings of ${row.name}`
              }
              title={
                expanded
                  ? `Collapse ${row.name} printings`
                  : `Show ${row.printings.length} printings of ${row.name}`
              }
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              <span className="deck-row-printings-count">{row.printings.length} printings</span>
              <ChevronDown
                className="deck-row-printings-chevron"
                width={12}
                height={12}
                strokeWidth={2.4}
                aria-hidden
              />
            </button>
          )}
          {row.isPartner && (
            <span className="deck-row-partner-tag" title="Partner commander">
              <Handshake width={12} height={12} strokeWidth={2.4} aria-hidden />
              <span className="deck-row-partner-label">Partner</span>
            </span>
          )}
          {legalityIssue && <LegalityBadge issue={legalityIssue} className="deck-row-illegal" />}
          {row.foil && <FoilBadge card={row} />}
          {/* Secondary metadata (which deck holds the copy, synergy, EDHREC %).
              On hover-capable pointers it's hidden at rest so the card name reads
              fully in the dense multi-column desktop layout, and revealed on row
              hover/focus; on touch (no hover) it stays inline — those rows are
              full-width. Allocation status is still conveyed at rest via the
              dimmed qty cell (deck-row-qty-missing) and the deck-level banner. */}
          <span className="deck-row-hovermeta">
            <AllocationChip row={row} />
            {synergyReasons && synergyReasons.length > 0 && (
              <span
                className="deck-row-synergy"
                title={`Synergy with your commander:\n• ${synergyReasons.join('\n• ')}`}
                aria-label={`Synergy: ${synergyReasons.join('; ')}`}
              >
                <span className="deck-row-synergy-icon" aria-hidden>
                  ✦
                </span>
              </span>
            )}
            {typeof inclusionPct === 'number' && (
              <span
                className="deck-row-inclusion"
                title={`${Math.round(inclusionPct)}% of EDHREC decks with this commander run this card`}
                aria-label={`EDHREC inclusion ${Math.round(inclusionPct)} percent`}
              >
                {Math.round(inclusionPct)}%
              </span>
            )}
          </span>
        </span>
        {showPrefs.mana &&
          (mana ? (
            <ManaCost cost={mana} className="mana-cost-row" />
          ) : (
            <span className="mana-cost-row" aria-hidden />
          ))}
        {showPrefs.price &&
          (row.price > 0 ? (
            <span
              className="deck-row-price"
              title={
                row.qty > 1 ? `${formatMoney(row.price / row.qty, { currency })} each` : undefined
              }
            >
              {formatMoney(row.price, { currency })}
            </span>
          ) : (
            // Unknown/zero price — keep the cell so the menu column stays
            // aligned across rows (mirrors the empty mana-cost placeholder).
            <span className="deck-row-price" aria-hidden />
          ))}
        <ToolbarPopover
          wrapperClassName="deck-row-menu"
          triggerClassName="deck-row-menu-trigger"
          triggerAriaLabel="Card actions"
          haspopup="menu"
          panelClassName="deck-row-menu-popover toolbar-popover-panel--fixed"
          panelRole="menu"
          panelAriaLabel={`Actions for ${row.name}`}
          triggerContent={
            <MoreVertical
              className="deck-row-menu-icon"
              width={14}
              height={14}
              strokeWidth={2}
              aria-hidden
            />
          }
        >
          {(close) => (
            <>
              {onEditCard && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onEditCard(row.slotIds[0], row.card);
                  }}
                >
                  Edit printing
                </button>
              )}
              {canEditQty && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onSetQty!(row.card, row.qty + 1);
                  }}
                >
                  Add another copy
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                disabled={!canRemove}
                onClick={(e) => handleRemoveOne(e, close)}
              >
                {row.qty > 1 ? 'Remove one copy' : 'Remove from deck'}
              </button>
              {row.qty > 1 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  disabled={!canRemove && !canEditQty}
                  onClick={(e) => handleRemoveAll(e, close)}
                >
                  Remove all {row.qty} copies
                </button>
              )}
              {onMoveToZone && moveLabel && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onMoveToZone(row.slotIds[0]);
                  }}
                >
                  {moveLabel}
                </button>
              )}
              {onUseOwnCopy && row.claimedElsewhereQty > 0 && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onUseOwnCopy(row.card);
                  }}
                >
                  Use my copy
                </button>
              )}
              {onMoveToAnotherDeck && !row.isPartner && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onMoveToAnotherDeck(row.card);
                  }}
                >
                  Move to another deck…
                </button>
              )}
              {onReleaseCopy && row.allocatedQty > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onReleaseCopy(row.card);
                  }}
                >
                  Release copy
                </button>
              )}
              {onMakeCommander && canMakeCommander?.(row.card) && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onMakeCommander(row.slotIds[0], row.card);
                  }}
                >
                  Make commander
                </button>
              )}
              {onMakePartner && canMakePartner?.(row.card) && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onMakePartner(row.slotIds[0], row.card);
                  }}
                >
                  Make partner
                </button>
              )}
            </>
          )}
        </ToolbarPopover>
      </li>
      {multiPrinting && expanded && !leaving && (
        <li className="deck-row-printings-wrap">
          <ul id={subListId} className="deck-row-printings-list">
            {/* Informational rows — they surface the distinct printings the
                stack hides. Changing a printing stays on the aggregated row's
                "Edit printing" / "Use my copy" menu (a per-printing carousel
                deep-link is the deferred follow-up). */}
            {row.printings.map((p) => (
              <li
                key={p.key}
                className="deck-printing-sub"
                data-peek-name={row.name}
                data-peek-img={frontFaceImageLarge(p.card) ?? frontFaceImage(p.card)}
              >
                {/* Per-printing count, in the same left column as the row's
                    aggregate qty — so it reads as a breakdown (7 + 7 + 8 = 22). */}
                <span className="deck-printing-sub-qty">{p.qty}</span>
                <span className="deck-printing-sub-indent" aria-hidden />
                <span className="deck-printing-sub-id">
                  <SetSymbol
                    className="deck-printing-sub-symbol"
                    setCode={p.setCode}
                    rarity={p.rarity}
                    title={setSymbolTitle({
                      setCode: p.setCode,
                      setName: p.setName,
                      collectorNumber: p.collectorNumber,
                      rarity: p.rarity,
                    })}
                  />
                  <span className="deck-printing-sub-set">
                    {(p.setCode || '—').toUpperCase()}
                    {p.collectorNumber && (
                      <span className="deck-printing-sub-cn"> · #{p.collectorNumber}</span>
                    )}
                  </span>
                  {p.foil && (
                    <span
                      className="deck-printing-sub-foil"
                      title={p.finish === 'etched' ? 'Etched foil' : 'Foil'}
                    >
                      {p.finish === 'etched' ? 'Etched' : 'Foil'}
                    </span>
                  )}
                </span>
                <span className="deck-printing-sub-spacer" />
                {p.price > 0 && (
                  <span className="deck-printing-sub-price">
                    {formatMoney(p.price, { currency })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </li>
      )}
    </>
  );
}

// ── Analysis views ─────────────────────────────────────────────────────────
/** The page-top analysis view ids. (Test hand is a separate standalone panel,
 *  not a view — goldfishing is a distinct activity.) */
export type AnalysisTabId = 'stats' | 'power' | 'tune';

/** The full page-top view set: the card-list editing surface plus the analysis
 *  views. `DeckEditorPage` owns this state and renders the hub tab bar. */
export type DeckView = 'deck' | AnalysisTabId;

/** Renders a single analysis view's content full-width (no header / tabs /
 *  collapse — the hub tab bar in the page does the switching). */
function DeckAnalysisView({
  view,
  allCards,
  manaData,
  bracketEstimation,
  deckCardsByName,
  bracketOverride,
  onSetBracketOverride,
  roleCounts,
  roleTargets,
  buildReport,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
  averageSalt,
  saltiestCards,
  planScore,
  combosSlot,
  coachFeedSlot,
  engineSlot,
  winConditionSlot,
  powerHeroSlot,
  commanderIdentity,
  analysisState = 'ready',
  onNavigateToTune,
  commander,
  partnerCommander,
  deckName,
  format,
  deckColor,
  identity,
  scoreRevealKey,
}: {
  view: AnalysisTabId;
  allCards: ScryfallCard[];
  manaData: DeckManaData;
  bracketEstimation?: BracketEstimation;
  deckCardsByName?: ReadonlyMap<string, ScryfallCard>;
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
  onSetBracketOverride?: (bracket: 1 | 2 | 3 | 4 | 5 | null) => void;
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  buildReport?: BuildReport;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  averageSalt?: number;
  saltiestCards?: Array<{ name: string; salt: number }>;
  planScore?: PlanScore;
  /** Folded-in panels from the page (own their data fetching). */
  combosSlot?: React.ReactNode;
  /** CoachFeed slot — replaces improveSlot/nextBestMoveSlot/costSlot/bracketFitSlot. */
  coachFeedSlot?: React.ReactNode;
  engineSlot?: React.ReactNode;
  winConditionSlot?: React.ReactNode;
  powerHeroSlot?: React.ReactNode;
  /** The deck's legal color identity (commander union); drives the identity gate. */
  commanderIdentity?: string[];
  /** UX-310: 'pending' shows skeleton placeholders on Tune/Power while analysis loads. */
  analysisState?: 'pending' | 'ready';
  /** UX-311: deep-link from a DeckIdentityCard shortfall to the Tune lane that fixes it. */
  onNavigateToTune?: (lane: LaneId) => void;
  /** Session-scoped reveal key for score animations. Null/undefined suppresses the reveal. */
  scoreRevealKey?: string | null;
  /** Commander card for DeckIdentityCard art + arc. */
  commander?: ScryfallCard | null;
  /** Partner commander card for DeckIdentityCard arc. */
  partnerCommander?: ScryfallCard | null;
  /** Deck name for DeckIdentityCard header. */
  deckName: string;
  /** Deck format label for DeckIdentityCard. */
  format: string;
  /** Deck color hex for DeckIdentityCard no-commander banner. */
  deckColor: string;
  /** Live-computed deck identity for DeckIdentityCard. */
  identity: import('@/deck-builder/services/deckBuilder/deckIdentity').DeckIdentity | null;
}) {
  // Generated decks pass roleCounts in; manual decks don't — derive them on
  // the fly from the tagger so the Roles panel works for either flow.
  const derivedRoles = useMemo(() => {
    if (roleCounts !== undefined) return null;
    return computeRoleCounts(allCards);
  }, [allCards, roleCounts]);

  // Overlapping multi-role counts (a card counts toward every role it fills),
  // always derived from the live card list — complements the primary-role bars.
  const roleDensity = useMemo(() => computeRoleDensity(allCards), [allCards]);

  const effectiveRoleCounts = roleCounts ?? derivedRoles?.roleCounts;
  const effectiveRampSub = rampSubtypeCounts ?? derivedRoles?.rampSubtypeCounts;
  const effectiveRemovalSub = removalSubtypeCounts ?? derivedRoles?.removalSubtypeCounts;
  const effectiveBoardwipeSub = boardwipeSubtypeCounts ?? derivedRoles?.boardwipeSubtypeCounts;
  const effectiveDrawSub = cardDrawSubtypeCounts ?? derivedRoles?.cardDrawSubtypeCounts;
  const showRoles = effectiveRoleCounts !== undefined;

  // Pass/fail deck-health checklist for the Stats board — legality gates plus the
  // soft role/curve targets, derived from the live list + role analysis.
  const validation = useMemo(
    () =>
      buildValidationChecklist({
        cards: allCards,
        commanderIdentity,
        roleCounts: effectiveRoleCounts,
        roleTargets,
        averageCmc: manaData.averageCmc,
      }),
    [allCards, commanderIdentity, effectiveRoleCounts, roleTargets, manaData.averageCmc]
  );

  const effectiveBracketValue = bracketOverride ?? bracketEstimation?.bracket;
  const bracketOverridden = bracketOverride != null;
  // The parent `.deck-display` is the tabpanel for the active view; this just
  // renders the view's content. `current` aliases `view` so the per-view blocks
  // below stay untouched.
  const current = view;

  // Panel cascade: staggered entrance when analysis first becomes ready.
  // Keyed to scoreRevealKey so it fires once per analysis delivery (same registry
  // as the score number reveals — remounts and tab switches don't replay).
  const cascade = usePanelCascade(scoreRevealKey ? `${scoreRevealKey}:cascade` : null);

  return (
    <div className="deck-analysis-view">
      {current === 'stats' && (
        <div className="deck-bento deck-bento--stats">
          {/* Deck identity hero — leads the stats tab with the deck's visual identity,
              functional verdict, and build health. Renders always (no checks guard). */}
          <div className={panelCascadeClass(0, cascade.animating) || undefined}>
            <DeckIdentityCard
              commander={commander ?? null}
              partnerCommander={partnerCommander}
              deckName={deckName}
              format={format}
              deckColor={deckColor}
              bracket={effectiveBracketValue}
              analysisPending={analysisState === 'pending'}
              validation={validation}
              planScore={planScore ?? null}
              manaCurve={manaData.manaCurve}
              identity={identity}
              averageCmc={manaData.averageCmc}
              onNavigate={onNavigateToTune}
              cards={allCards}
              revealKey={scoreRevealKey}
            />
          </div>
          {/* Mana curve — full-width so the stacked curve reads well. */}
          <Panel title="Mana curve" wide className={panelCascadeClass(1, cascade.animating)}>
            <DeckCurvePhases
              manaCurve={manaData.manaCurve}
              curveByColor={manaData.curveByColor}
              averageCmc={manaData.averageCmc}
              cardsByCmc={manaData.cardsByCmc}
            />
          </Panel>
          {/* Color + Types — a compact pair (lone survivor spans full width). */}
          <div
            className={`deck-stats-pair${panelCascadeClass(2, cascade.animating) ? ` ${panelCascadeClass(2, cascade.animating)}` : ''}`}
          >
            <Panel title="Color">
              <DeckColorPanel
                colorDist={manaData.colorDist}
                manaProduction={manaData.manaProduction}
                cardsByColor={manaData.cardsByColor}
                manaCurve={manaData.manaCurve}
              />
            </Panel>
            <Panel title="Types">
              <DeckTypeBreakdown
                typeCounts={manaData.typeBreakdown}
                cardsByType={manaData.cardsByType}
              />
            </Panel>
          </div>
          {/* Saltiest — lone, spans full width. */}
          <div
            className={`deck-stats-pair${panelCascadeClass(3, cascade.animating) ? ` ${panelCascadeClass(3, cascade.animating)}` : ''}`}
          >
            {saltiestCards && saltiestCards.length > 0 && (
              <Panel title="Saltiest cards">
                <SaltiestPanel cards={saltiestCards} averageSalt={averageSalt} />
              </Panel>
            )}
          </div>
          {/* Build report — full width, list-heavy. */}
          {buildReport && (
            <Panel title="Build report" wide className={panelCascadeClass(4, cascade.animating)}>
              <BuildReportPanel report={buildReport} />
            </Panel>
          )}
        </div>
      )}

      {current === 'power' && (
        <div className="deck-bento deck-bento--power">
          {/* UX-310: skeleton while the async analysis is still in flight. Only
              show when analysis hasn't delivered a hero or any panel yet — an
              incomplete result (e.g. bracket landed but engine hasn't) still
              has real content to show. */}
          {analysisState === 'pending' && !powerHeroSlot && !bracketEstimation && !engineSlot && (
            <div
              className="deck-analysis-skeleton"
              role="status"
              aria-label="Analyzing your deck…"
              aria-live="polite"
            >
              <p className="deck-analysis-skeleton-eyebrow">Analyzing your deck…</p>
              <div className="deck-analysis-skeleton-bar is-headline" />
              <div className="deck-analysis-skeleton-bar is-body" />
              <div className="deck-analysis-skeleton-bar is-body is-short" />
              <div className="deck-analysis-skeleton-lane">
                <div className="deck-analysis-skeleton-bar is-body" />
                <div className="deck-analysis-skeleton-bar is-body is-short" />
              </div>
              <div className="deck-analysis-skeleton-lane">
                <div className="deck-analysis-skeleton-bar is-body" />
                <div className="deck-analysis-skeleton-bar is-body is-short" />
              </div>
            </div>
          )}
          {powerHeroSlot}
          {/* Detailed breakdowns under the verdict hero. */}
          {/* Bracket + Roles — a compact pair (lone survivor spans full width). */}
          <div className="deck-stats-pair">
            {(bracketEstimation || bracketOverride != null) && (
              <Panel id="deck-power-bracket" title="Bracket">
                <div className="deck-stats-bracket">
                  <strong>
                    Bracket {effectiveBracketValue} —{' '}
                    {effectiveBracketValue != null ? bracketLabel(effectiveBracketValue) : '—'}
                    {bracketOverridden && <span className="deck-stats-bracket-tag"> manual</span>}
                  </strong>
                  <BracketVerdictStrip
                    target={bracketOverride}
                    detected={bracketEstimation?.bracket}
                  />
                  {/* Detected vs target now lives in the strip above; keep the
                      top hard-floor reason as context when on Auto. */}
                  {!bracketOverridden &&
                    bracketEstimation &&
                    bracketEstimation.hardFloors.length > 0 && (
                      <span className="deck-stats-bracket-note">
                        {bracketEstimation.hardFloors[0].reason}
                      </span>
                    )}
                  {/* UX-313: the target-bracket control moved to the PowerHero above
                      (the "Target: N ▾" SelectMenu). Keeping just a small note here
                      when a manual override is active so the Bracket panel stays
                      self-explaining without re-providing a redundant control. */}
                  {bracketOverridden && (
                    <p className="deck-stats-bracket-override-note">
                      Target set in Power level above.{' '}
                      {onSetBracketOverride && (
                        <button
                          type="button"
                          className="deck-stats-bracket-clear-btn"
                          onClick={() => onSetBracketOverride(null)}
                        >
                          Clear target
                        </button>
                      )}
                    </p>
                  )}
                  {bracketEstimation && (
                    <BracketBreakdown
                      estimation={bracketEstimation}
                      deckCardsByName={deckCardsByName}
                    />
                  )}
                </div>
              </Panel>
            )}
            {showRoles && (
              <Panel title="Roles">
                <RolesPanel
                  roleCounts={effectiveRoleCounts}
                  roleTargets={roleTargets}
                  density={roleDensity}
                  rampSubtypeCounts={effectiveRampSub}
                  removalSubtypeCounts={effectiveRemovalSub}
                  boardwipeSubtypeCounts={effectiveBoardwipeSub}
                  cardDrawSubtypeCounts={effectiveDrawSub}
                />
              </Panel>
            )}
          </div>
          {/* Engine — the synergy engine (lone, spans full width). */}
          {engineSlot && (
            <div className="deck-stats-pair">
              <Panel id="deck-power-engine" title="Engine">
                {engineSlot}
              </Panel>
            </div>
          )}
          {/* Win conditions — how the deck wins (lone, spans full width). */}
          {winConditionSlot && (
            <div className="deck-stats-pair">
              <Panel id="deck-power-wincon" title="Win conditions">
                {winConditionSlot}
              </Panel>
            </div>
          )}
          {/* Combos — full width (its own multi-column grid inside). */}
          {combosSlot && (
            <Panel title="Combos" wide>
              {combosSlot}
            </Panel>
          )}
        </div>
      )}

      {current === 'tune' && (
        <div className="deck-bento deck-bento--tune">
          {analysisState === 'pending' && !coachFeedSlot && (
            <div
              className="deck-analysis-skeleton"
              role="status"
              aria-label="Analyzing your deck…"
              aria-live="polite"
            >
              <p className="deck-analysis-skeleton-eyebrow">Analyzing your deck…</p>
              <div className="deck-analysis-skeleton-bar is-headline" />
              <div className="deck-analysis-skeleton-bar is-body" />
              <div className="deck-analysis-skeleton-lane">
                <div className="deck-analysis-skeleton-bar is-body" />
                <div className="deck-analysis-skeleton-bar is-body is-short" />
              </div>
              <div className="deck-analysis-skeleton-lane">
                <div className="deck-analysis-skeleton-bar is-body is-short" />
                <div className="deck-analysis-skeleton-bar is-body" />
              </div>
            </div>
          )}
          {coachFeedSlot}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  children,
  wide,
  id,
  className,
}: {
  title: string;
  children: React.ReactNode;
  /** Span the full surface width (for list-heavy panels whose items lay out in
   *  their own multi-column grid, e.g. Cards to consider). */
  wide?: boolean;
  /** Stable id so the Power hero's summary lines can scroll to this panel. */
  id?: string;
  /** Additional CSS classes (e.g. cascade animation classes). */
  className?: string;
}) {
  const cls = ['deck-stats-panel', wide ? 'deck-stats-panel--wide' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div id={id} className={cls}>
      <h4 className="deck-stats-panel-title">{title}</h4>
      {children}
    </div>
  );
}

function RolesPanel({
  roleCounts,
  roleTargets,
  density,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
}: {
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  /** Overlapping multi-role counts (a card counts in every role it fills). */
  density?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
}) {
  const ramp = roleCounts?.ramp ?? 0;
  const removal = roleCounts?.singleRemoval ?? roleCounts?.removal ?? 0;
  const wipes = roleCounts?.boardWipes ?? roleCounts?.boardwipe ?? 0;
  const draw = roleCounts?.cardDraw ?? roleCounts?.cardAdvantage ?? 0;

  // Targets share the canonical role keys with roleCounts; tolerate either casing.
  const rampWant = roleTargets?.ramp;
  const removalWant = roleTargets?.singleRemoval ?? roleTargets?.removal;
  const wipesWant = roleTargets?.boardWipes ?? roleTargets?.boardwipe;
  const drawWant = roleTargets?.cardDraw ?? roleTargets?.cardAdvantage;

  const subSummary = (counts: Record<string, number> | undefined): string => {
    if (!counts) return '';
    const entries = Object.entries(counts).filter(([, v]) => v > 0);
    return entries.map(([k, v]) => `${v} ${k}`).join(' · ');
  };

  // Density one-liner: how many cards fill each role counting overlaps, busiest
  // first. Totals exceed the deck size because a card can do several jobs.
  const densityLabels: Record<string, string> = {
    cardDraw: 'Draw',
    ramp: 'Ramp',
    removal: 'Removal',
    boardwipe: 'Wipes',
  };
  const densityEntries = density
    ? Object.entries(density)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  const items = [
    {
      label: 'Ramp',
      value: ramp,
      want: rampWant,
      sub: subSummary(rampSubtypeCounts),
      color: 'var(--accent)',
    },
    {
      label: 'Removal',
      value: removal,
      want: removalWant,
      sub: subSummary(removalSubtypeCounts),
      color: '#d8442a',
    },
    {
      label: 'Board wipes',
      value: wipes,
      want: wipesWant,
      sub: subSummary(boardwipeSubtypeCounts),
      color: '#d4a838',
    },
    {
      label: 'Card draw',
      value: draw,
      want: drawWant,
      sub: subSummary(cardDrawSubtypeCounts),
      color: '#3a85cc',
    },
  ];

  const max = Math.max(1, ...items.map((it) => Math.max(it.value, it.want ?? 0)));

  return (
    <>
      {densityEntries.length > 0 && (
        <div className="deck-roles-density">
          <span className="deck-roles-density-line">
            {densityEntries.map(([k, v]) => `${v} ${densityLabels[k] ?? k}`).join(' · ')}
          </span>
          <span className="deck-roles-density-note">cards fill multiple roles</span>
        </div>
      )}
      <ul className="deck-roles">
        {items.map((it) => {
          const hasTarget = typeof it.want === 'number';
          const short = hasTarget && it.value < (it.want as number);
          return (
            <li key={it.label}>
              <div className="deck-roles-row">
                <span className="deck-roles-name">{it.label}</span>
                <span className="deck-roles-count">
                  {hasTarget ? (
                    <span className={short ? 'deck-roles-count-short' : undefined}>
                      {it.value}/{it.want}
                      {short && (
                        <span
                          title={`${(it.want as number) - it.value} short of target`}
                          aria-label="below target"
                        >
                          {' '}
                          ▾
                        </span>
                      )}
                    </span>
                  ) : (
                    it.value
                  )}
                </span>
              </div>
              <MeterBar className="deck-roles-bar" value={it.value} max={max} color={it.color} />
              {it.sub && <div className="deck-roles-sub">{it.sub}</div>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── Export decklist ───────────────────────────────────────────────────────
type PrintingFinish = 'nonfoil' | 'foil' | 'etched';

interface ExportEntry {
  name: string;
  set: string;
  collectorNumber: string;
  qty: number;
  finish: PrintingFinish;
  language?: string;
}

function formatLine(entry: ExportEntry, format: ExportFormat): string {
  const { name, qty, finish, language } = entry;
  const set = entry.set.toUpperCase();
  const num = entry.collectorNumber;
  const lang = language && language !== 'en' ? language.toUpperCase() : '';
  switch (format) {
    case 'mtga': {
      // Arena syntax doesn't carry foil; printings still distinguished by set+cn.
      if (set && num) return `${qty} ${name} (${set}) ${num}`;
      return `${qty} ${name}`;
    }
    case 'moxfield': {
      // Moxfield: `1 Sol Ring (CMR) 472 *F*` / `*E*` for etched.
      const finishTag = finish === 'foil' ? ' *F*' : finish === 'etched' ? ' *E*' : '';
      if (set && num) return `${qty} ${name} (${set}) ${num}${finishTag}`;
      if (set) return `${qty} ${name} (${set})${finishTag}`;
      return `${qty} ${name}${finishTag}`;
    }
    case 'plain':
    default: {
      // Plain text: human-readable. Always identify printing when known.
      const parts: string[] = [`${qty} ${name}`];
      if (set && num) parts.push(`(${set}) ${num}`);
      else if (set) parts.push(`(${set})`);
      if (finish === 'foil') parts.push('[Foil]');
      else if (finish === 'etched') parts.push('[Etched]');
      if (lang) parts.push(`[${lang}]`);
      return parts.join(' ');
    }
  }
}

function entryKey(
  e: Pick<ExportEntry, 'name' | 'set' | 'collectorNumber' | 'finish' | 'language'>
): string {
  return [e.name, e.set, e.collectorNumber, e.finish, e.language ?? ''].join('|');
}

/**
 * Resolve the effective printing for a deck slot. When the slot has an
 * allocated physical copy, the copy's set/collector_number/finish/language
 * win — that's the actual card the user owns and will pull from their box.
 * The slot's stored `card` is only used as a fallback when no copy is
 * allocated (or when the lookup fails).
 */
function resolvePrinting(
  card: ScryfallCard,
  allocatedCopyId: string | null | undefined,
  collectionByCopyId?: Map<string, EnrichedCard>
): {
  name: string;
  set: string;
  collectorNumber: string;
  finish: PrintingFinish;
  language?: string;
} {
  if (allocatedCopyId && collectionByCopyId) {
    const copy = collectionByCopyId.get(allocatedCopyId);
    if (copy) {
      const finish = (copy.finish ?? (copy.foil ? 'foil' : 'nonfoil')) as PrintingFinish;
      return {
        name: copy.name || card.name,
        set: copy.setCode || card.set || '',
        collectorNumber: copy.collectorNumber || card.collector_number || '',
        finish,
        language: copy.language,
      };
    }
  }
  return {
    name: card.name,
    set: card.set || '',
    collectorNumber: card.collector_number || '',
    finish: 'nonfoil',
  };
}

function groupAndSort(
  cards: DeckDisplayCard[],
  collectionByCopyId?: Map<string, EnrichedCard>
): ExportEntry[] {
  const grouped = new Map<string, ExportEntry>();
  for (const dc of cards) {
    const printing = resolvePrinting(dc.card, dc.allocatedCopyId, collectionByCopyId);
    const key = entryKey(printing);
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += 1;
    } else {
      grouped.set(key, { ...printing, qty: 1 });
    }
  }
  return [...grouped.values()].sort((a, b) => {
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    const s = a.set.localeCompare(b.set);
    if (s !== 0) return s;
    const cn = a.collectorNumber.localeCompare(b.collectorNumber);
    if (cn !== 0) return cn;
    return a.finish.localeCompare(b.finish);
  });
}

function buildExport(
  commander: ScryfallCard | null,
  partner: ScryfallCard | null | undefined,
  cards: DeckDisplayCard[],
  format: ExportFormat,
  sideboardCards: DeckDisplayCard[] = [],
  collectionByCopyId?: Map<string, EnrichedCard>,
  commanderAllocatedCopyId?: string | null,
  partnerAllocatedCopyId?: string | null
): string {
  const lines: string[] = [];
  const cmdEntry = (card: ScryfallCard, copyId: string | null | undefined): ExportEntry => {
    const printing = resolvePrinting(card, copyId ?? null, collectionByCopyId);
    return { ...printing, qty: 1 };
  };
  if (format === 'mtga' && (commander || partner)) {
    lines.push('Commander');
    if (commander) lines.push(formatLine(cmdEntry(commander, commanderAllocatedCopyId), format));
    if (partner) lines.push(formatLine(cmdEntry(partner, partnerAllocatedCopyId), format));
    lines.push('');
    lines.push('Deck');
  } else {
    if (commander) lines.push(formatLine(cmdEntry(commander, commanderAllocatedCopyId), format));
    if (partner) lines.push(formatLine(cmdEntry(partner, partnerAllocatedCopyId), format));
  }

  for (const entry of groupAndSort(cards, collectionByCopyId)) {
    lines.push(formatLine(entry, format));
  }

  if (sideboardCards.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const entry of groupAndSort(sideboardCards, collectionByCopyId)) {
      lines.push(formatLine(entry, format));
    }
  }
  return lines.join('\n');
}
