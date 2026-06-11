import {
  Check,
  CircleAlert,
  ChevronDown,
  ChevronRight,
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
  PiggyBank,
  Search,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScryfallCard, DeckFormat, ThemeResult, BuildReport } from '@/deck-builder/types';
import { producedManaColors, isManaSourceType, deckColorIdentity } from '@/lib/mana-sources';
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
import { typeIcon } from '../../lib/card-types';
import { formatMoney } from '../../lib/format-money';
import { Modal } from '../Modal';
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
import { useRarityCorrections } from '../../lib/use-rarity-corrections';
import type { EnrichedCard } from '../../types';
import {
  bracketLabel,
  type BracketEstimation,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { BracketBreakdown } from './BracketBreakdown';
import { BracketVerdictStrip } from './BracketVerdictStrip';
import { CollapsibleLane, type CollapsibleLaneHandle } from './CollapsibleLane';
import type { LaneId } from '@/lib/deck-change';
import { useCardCarousel, tallyToEntries, type CarouselEntry } from './useCardCarousel';
import { BuildReportPanel } from './BuildReportPanel';
import { type DeckManaData } from './deck-mana-types';
import { DeckCurvePhases } from './DeckCurvePhases';
import { DeckColorPanel } from './DeckColorPanel';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';
import { PlanScoreDashboard } from './PlanScoreDashboard';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { computeRoleDensity } from '@/deck-builder/services/deckBuilder/roleDensity';
import { ValidationChecklist } from './ValidationChecklist';
import { StatsHero } from './StatsHero';
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

// ── Canonical card-type grouping ──────────────────────────────────────────
const CLASSIFY_PRIORITY = [
  'Land',
  'Creature',
  'Planeswalker',
  'Battle',
  'Sorcery',
  'Instant',
  'Artifact',
  'Enchantment',
] as const;
type TypeGroup = (typeof CLASSIFY_PRIORITY)[number];

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

function classifyType(card: ScryfallCard): TypeGroup {
  const tl = (card.type_line || '').toLowerCase();
  for (const group of CLASSIFY_PRIORITY) {
    if (tl.includes(group.toLowerCase())) return group;
  }
  return 'Artifact';
}

/** Collapse a list of cards to unique name → copy count (keeping one
 *  representative card object so the drill-down carousel renders without
 *  re-fetching), sorted by count desc then name. */
function tallyNames(
  cards: ScryfallCard[]
): Array<{ name: string; count: number; card: ScryfallCard }> {
  const m = new Map<string, { count: number; card: ScryfallCard }>();
  for (const c of cards) {
    const e = m.get(c.name);
    if (e) e.count += 1;
    else m.set(c.name, { count: 1, card: c });
  }
  return [...m.entries()]
    .map(([name, { count, card }]) => ({ name, count, card }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

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
  /** Unified Tune "Improve the deck" engine — merges EDHREC gap staples, optimizer
   *  additions, off-meta synergy picks, and (in Owned-only mode) owned
   *  substitutes into one list; optimizer removals fall into "Consider cutting".
   *  Replaces the old fill-gaps / upgrade / collection lanes. Built by the page
   *  (owns the add/cut flow + the EDHREC theme-browser). */
  improveSlot?: React.ReactNode;
  /** "Next best move" suggestions, rendered atop the Overview view. Built by
   *  the page (it owns the live combo data + view-navigation callback). */
  nextBestMoveSlot?: React.ReactNode;
  /** Budget cost-optimizer surface — the Tune tab's "Fit a budget" lane. */
  costSlot?: React.ReactNode;
  /** Engine *diagnostics* (axis-balance bars + warnings), rendered on the Power
   *  tab. */
  engineSlot?: React.ReactNode;
  /** Win-condition detection panel, rendered on the Power tab. */
  winConditionSlot?: React.ReactNode;
  /** Bracket Fit coaching lane — target-bracket card moves, rendered inside the
   *  Power tab's Bracket panel below the verdict strip. Built by the page (owns
   *  the plan + the add/cut/swap handlers); only passed when bracketOverride is
   *  set and the plan isn't aligned. */
  bracketFitSlot?: React.ReactNode;
  /** Power-tab verdict hero (bracket + gameplan), rendered atop the Power view. */
  powerHeroSlot?: React.ReactNode;
  /** Tune lane to expand on first paint (the one the verdict hero points at). */
  tuneDefaultLane?: LaneId;
  /** One-shot reveal target: a hero deep-link force-expands + scrolls this lane. */
  tuneFocusLane?: LaneId | null;
  /** Called once `tuneFocusLane` has been revealed, so the page can clear it. */
  onTuneFocusHandled?: () => void;
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
}

// ── Row shape ────────────────────────────────────────────────────────────
interface Row {
  name: string;
  qty: number;
  card: ScryfallCard;
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
  // Tracks whether a row's image was sourced from an owned printing — if so,
  // we don't downgrade it to a deck-stored fallback later.
  const ownedImage = new Set<string>();
  const classify = (dc: DeckDisplayCard): AllocationStatus =>
    classifyAllocation(dc.allocatedCopyId ?? null, collectionById, {
      cardName: dc.card.name,
      copiesByName: crossDeck?.copiesByName,
      allocations: crossDeck?.otherDeckAllocations,
    });
  const claimedByFor = (cardName: string): AllocationInfo | undefined => {
    const copies = crossDeck?.copiesByName?.get(cardName.toLowerCase());
    if (!copies || !crossDeck?.otherDeckAllocations) return undefined;
    for (const c of copies) {
      const info = crossDeck.otherDeckAllocations.get(c.copyId);
      if (info) return info;
    }
    return undefined;
  };
  for (const dc of cards) {
    const card = dc.card;
    const existing = map.get(card.name);
    const status = classify(dc);
    const owned = dc.allocatedCopyId ? collectionById?.get(dc.allocatedCopyId) : undefined;
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
  return [...map.values()];
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
      ? `Owned, but currently in deck: ${row.claimedBy.deckName}`
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
    const title =
      row.claimedElsewhereQty === row.qty
        ? `In deck: ${info.deckName}`
        : `${row.claimedElsewhereQty} of ${row.qty} in deck: ${info.deckName}`;
    return (
      <Link
        to={`/decks/${info.deckId}`}
        className="deck-row-alloc-badge"
        style={{ ['--deck-color']: info.deckColor || 'var(--accent)' } as React.CSSProperties}
        title={title}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <Layers width={11} height={11} strokeWidth={2.2} aria-hidden />
        <span className="deck-row-alloc-badge-label">{info.deckName}</span>
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

// ── Main component ────────────────────────────────────────────────────────
export function DeckDisplay({
  title,
  deckId,
  format = 'commander',
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
  deckGrade,
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
  collectionByCopyId,
  binderByCopyId,
  exportOpen: exportOpenProp,
  onExportOpenChange,
  onAddFromSearch,
  combosSlot,
  improveSlot,
  nextBestMoveSlot,
  costSlot,
  engineSlot,
  winConditionSlot,
  bracketFitSlot,
  powerHeroSlot,
  tuneDefaultLane,
  tuneFocusLane,
  onTuneFocusHandled,
  renderSwapSuggestions,
  renderSimilarCards,
  activeView = 'deck',
  onShowTestHand,
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
    const otherDeckAllocations = buildAllocationMap(others);
    return { copiesByName, otherDeckAllocations };
  }, [collectionByCopyId, allDecks, deckId]);

  const claimedByForName = useCallback(
    (cardName: string): AllocationInfo | undefined => {
      const copies = crossDeck.copiesByName?.get(cardName.toLowerCase());
      if (!copies || !crossDeck.otherDeckAllocations) return undefined;
      for (const c of copies) {
        const info = crossDeck.otherDeckAllocations.get(c.copyId);
        if (info) return info;
      }
      return undefined;
    },
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
  const groups = useMemo(() => {
    const rows = buildRows(cards, currency, collectionByCopyId, crossDeck);
    const buckets = new Map<TypeGroup, Row[]>();
    for (const row of rows) {
      const t = classifyType(row.card);
      const bucket = buckets.get(t) ?? [];
      bucket.push(row);
      buckets.set(t, bucket);
    }
    const ordered: { title: string; icon: string; rows: Row[] }[] = [];
    if (commanderRows.length > 0) {
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
  }, [cards, commanderRows, collectionByCopyId, crossDeck]);

  // Sideboard rows grouped by canonical type.
  const sideboardGroups = useMemo(() => {
    if (sideboard.length === 0) return [];
    const rows = buildRows(sideboard, currency, collectionByCopyId, crossDeck);
    const buckets = new Map<TypeGroup, Row[]>();
    for (const row of rows) {
      const t = classifyType(row.card);
      const bucket = buckets.get(t) ?? [];
      bucket.push(row);
      buckets.set(t, bucket);
    }
    const ordered: { title: string; icon: string; rows: Row[] }[] = [];
    for (const t of DISPLAY_ORDER) {
      const r = buckets.get(t);
      if (r && r.length > 0) ordered.push({ title: t, icon: typeIcon(t.toLowerCase()), rows: r });
    }
    return ordered;
  }, [sideboard, collectionByCopyId, crossDeck]);

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

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.map((g) => {
      const filtered = q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)) : g.rows;
      return { ...g, rows: sortRows(filtered, sort, sortDir) };
    });
  }, [groups, sort, sortDir, search]);

  const visibleSideboardGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sideboardGroups.map((g) => {
      const filtered = q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)) : g.rows;
      return { ...g, rows: sortRows(filtered, sort, sortDir) };
    });
  }, [sideboardGroups, sort, sortDir, search]);

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
  const averageCmc = useMemo(() => {
    const nonLand = allCards.filter((c) => !(c.type_line || '').toLowerCase().includes('land'));
    if (nonLand.length === 0) return 0;
    return nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLand.length;
  }, [allCards]);
  const manaCurve = useMemo(() => {
    const out: Record<number, number> = {};
    for (const c of allCards) {
      if ((c.type_line || '').toLowerCase().includes('land')) continue;
      const cmc = Math.min(7, Math.round(c.cmc ?? 0));
      out[cmc] = (out[cmc] ?? 0) + 1;
    }
    return out;
  }, [allCards]);

  // Color / production / type breakdowns power the Mana view, which renders
  // either as a persistent desktop column (below) or the surface's Mana tab.
  const colorDist = useMemo(() => {
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    let total = 0;
    for (const c of allCards) {
      if ((c.type_line || '').toLowerCase().includes('land')) continue;
      const ci = c.color_identity ?? [];
      if (ci.length === 0) {
        counts.C += 1;
        total += 1;
        continue;
      }
      for (const k of ci) {
        counts[k] = (counts[k] ?? 0) + 1;
        total += 1;
      }
    }
    return { counts, total };
  }, [allCards]);
  const manaProduction = useMemo(() => {
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    // Per-color source cards; tallyNames dedupes them by name → copy count for
    // the drill-down carousel (10x Plains is one entry, ×10) while `counts`
    // still reflects every physical copy.
    const sources: Record<string, ScryfallCard[]> = { W: [], U: [], B: [], R: [], G: [], C: [] };

    // The deck's color identity, used to clamp commander-identity fixers
    // (Command Tower, Arcane Signet) — see lib/mana-sources.
    const identity = deckColorIdentity(allCards, [commander, partnerCommander]);

    let totalSources = 0;
    for (const c of allCards) {
      // One-shot rituals aren't part of the mana base; a permanent that
      // produces mana — land, rock, dork — is.
      if (!isManaSourceType(c)) continue;
      const colors = producedManaColors(c, identity);
      if (colors.length === 0) continue;
      totalSources += 1;
      for (const k of colors) {
        counts[k] = (counts[k] ?? 0) + 1;
        (sources[k] ??= []).push(c);
      }
    }
    const sourcesByColor = Object.fromEntries(
      Object.entries(sources).map(([k, v]) => [k, tallyNames(v)])
    );
    return { counts, totalSources, sourcesByColor };
  }, [allCards, commander, partnerCommander]);
  const typeBreakdown = useMemo(() => {
    const out: Record<TypeGroup, number> = {
      Land: 0,
      Creature: 0,
      Planeswalker: 0,
      Battle: 0,
      Sorcery: 0,
      Instant: 0,
      Artifact: 0,
      Enchantment: 0,
    };
    for (const c of allCards) {
      out[classifyType(c)] += 1;
    }
    return out;
  }, [allCards]);
  // Per-bucket card lists powering the Mana tab drill-downs (tap a stat → a
  // carousel of the exact cards behind it). Bucketed to match the displayed
  // counts: curve/color exclude lands and bucket CMC at 7+ like `manaCurve` /
  // `colorDist`; types span every card like `typeBreakdown`.
  const manaDrilldowns = useMemo(() => {
    const byCmc: Record<number, ScryfallCard[]> = {};
    const byType: Record<string, ScryfallCard[]> = {};
    const byColor: Record<string, ScryfallCard[]> = {};
    for (const c of allCards) {
      const isLand = (c.type_line || '').toLowerCase().includes('land');
      if (!isLand) {
        const cmc = Math.min(7, Math.round(c.cmc ?? 0));
        (byCmc[cmc] ??= []).push(c);
        const ci = c.color_identity ?? [];
        if (ci.length === 0) (byColor.C ??= []).push(c);
        else for (const k of ci) (byColor[k] ??= []).push(c);
      }
      (byType[classifyType(c)] ??= []).push(c);
    }
    const tally = (m: Record<string | number, ScryfallCard[]>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, tallyNames(v)]));
    return {
      cardsByCmc: tally(byCmc) as Record<number, Array<{ name: string; count: number }>>,
      cardsByType: tally(byType),
      cardsByColor: tally(byColor),
    };
  }, [allCards]);
  // Normalized for DeckColorPanel/DeckManaPanel (which want `total`).
  const manaData = useMemo(
    () => ({
      manaCurve,
      averageCmc,
      colorDist,
      manaProduction: {
        counts: manaProduction.counts,
        total: manaProduction.totalSources,
        sourcesByColor: manaProduction.sourcesByColor,
      },
      typeBreakdown,
      cardsByCmc: manaDrilldowns.cardsByCmc,
      cardsByType: manaDrilldowns.cardsByType,
      cardsByColor: manaDrilldowns.cardsByColor,
    }),
    [manaCurve, averageCmc, colorDist, manaProduction, typeBreakdown, manaDrilldowns]
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
            scryfallToEnriched(row.card, row.imageNormal, row.imageNormalBack, {
              foil: row.foil,
              finish: row.finish,
              finishes: row.finishes,
              promoTypes: row.promoTypes,
              frameEffects: row.frameEffects,
              setCode: row.setCode,
              setName: row.setName,
              collectorNumber: row.collectorNumber,
              rarity: row.card.oracle_id ? rarityCorrections.get(row.card.oracle_id) : undefined,
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
                <span className="deck-stat-value">{averageCmc.toFixed(2)}</span>
                <span className="deck-stat-label">avg CMC</span>
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
              {deckGrade && (
                <span className="deck-stat">
                  <span className="deck-stat-value" title={deckGrade.headline}>
                    {deckGrade.letter}
                  </span>
                  <span className="deck-stat-label">grade</span>
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
            improveSlot={improveSlot}
            nextBestMoveSlot={nextBestMoveSlot}
            costSlot={costSlot}
            engineSlot={engineSlot}
            winConditionSlot={winConditionSlot}
            bracketFitSlot={bracketFitSlot}
            powerHeroSlot={powerHeroSlot}
            tuneDefaultLane={tuneDefaultLane}
            tuneFocusLane={tuneFocusLane}
            onTuneFocusHandled={onTuneFocusHandled}
            commanderIdentity={commanderIdentity}
          />
        )}

        {/* Desktop-only floating hover-peek: a transient card-art preview in the
            gutter beside the list while hovering a row. No-op on touch/native. */}
        {hoverPeek.peek &&
          (() => {
            // Resolve the hovered card's hero art from the same flat list the
            // carousel uses, so the peek matches the owned printing.
            const i = flat.indexByName.get(hoverPeek.peek.name);
            const card = i !== undefined ? flat.cards[i] : undefined;
            return (
              <DeckHoverPeek
                imageUrl={card?.imageLarge || card?.imageNormal}
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
                if (a && !seen.has(a.deckId)) {
                  seen.add(a.deckId);
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

// ── ScryfallCard → EnrichedCard adapter for the preview carousel ─────────
// Deck-builder cards never went through our import flow, so they have no
// "purchase price" from a CSV. We fall back to Scryfall's listed USD price
// so the carousel still shows a meaningful number instead of $0.00.
interface EnrichedOverrides {
  foil?: boolean;
  finish?: EnrichedCard['finish'];
  finishes?: string[];
  promoTypes?: string[];
  frameEffects?: string[];
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
}

function scryfallToEnriched(
  card: ScryfallCard,
  frontOverride?: string,
  backOverride?: string,
  overrides?: EnrichedOverrides
): EnrichedCard {
  const front =
    frontOverride ?? card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
  const back =
    backOverride ??
    (card.card_faces && card.card_faces.length > 1
      ? card.card_faces[1].image_uris?.normal
      : undefined);
  // An override is a specific normal-res printing URL with no large
  // counterpart; pulling `large` off the base card here could surface a
  // different printing's art, so suppress it and let the consumer fall
  // back to the override normal.
  const frontLarge = frontOverride
    ? undefined
    : (card.image_uris?.large ?? card.card_faces?.[0]?.image_uris?.large);
  const backLarge =
    backOverride || !(card.card_faces && card.card_faces.length > 1)
      ? undefined
      : card.card_faces[1].image_uris?.large;
  const usd = card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched;
  const price = usd ? Number(usd) : NaN;
  return {
    copyId: crypto.randomUUID(),
    name: card.name,
    setCode: overrides?.setCode ?? card.set,
    setName: overrides?.setName ?? card.set_name,
    collectorNumber: overrides?.collectorNumber ?? card.collector_number ?? '',
    rarity: overrides?.rarity ?? card.rarity,
    scryfallId: card.id,
    purchasePrice: Number.isFinite(price) ? price : 0,
    sourceCategory: '',
    sourceFormat: 'deck-builder',
    foil: overrides?.foil ?? false,
    finish: overrides?.finish ?? ('nonfoil' as const),
    finishes: overrides?.finishes,
    promoTypes: overrides?.promoTypes,
    frameEffects: overrides?.frameEffects,
    cmc: card.cmc,
    typeLine: card.type_line,
    colorIdentity: card.color_identity,
    colors: card.colors,
    imageNormal: front,
    imageNormalBack: back,
    imageLarge: frontLarge,
    imageLargeBack: backLarge,
    layout: card.layout,
    manaCost: card.mana_cost,
    oracleText: card.oracle_text,
  };
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
  cmc: 'CMC',
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

        <Legend context="deck" align="right" variant="pill" />

        <div className="toolbar-search">
          <Search
            className="toolbar-search-icon"
            width={14}
            height={14}
            strokeWidth={2}
            aria-hidden
          />
          <input
            type="search"
            className="toolbar-search-input"
            placeholder="Search…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search this deck"
          />
        </div>

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
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const triggerRect = buttonRef.current.getBoundingClientRect();
    setPanelPos((p) => {
      if (!p) return p;
      let next = p;
      if (p.top !== undefined && rect.bottom > window.innerHeight) {
        next = { ...next, top: undefined, bottom: window.innerHeight - triggerRect.top + 6 };
      }
      if (next.bottom !== undefined) {
        const upwardTop = triggerRect.top - 6 - rect.height;
        if (upwardTop < 8) {
          next = { ...next, top: 8, bottom: undefined };
        }
      }
      if (rect.left < 8) {
        next = { ...next, right: undefined, left: Math.max(8, triggerRect.left) };
      }
      return next === p ? p : next;
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
      const spaceBelow = window.innerHeight - rect.bottom;
      const right = Math.max(0, window.innerWidth - rect.right);
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
        className="toolbar-popover-panel toolbar-popover-panel--fixed"
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
        aria-haspopup={triggerClassName ? 'dialog' : 'menu'}
        aria-expanded={open}
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
  /** Optional control rendered at the end of the section header (e.g. the
   *  Commander section's "Add/Edit partner" button). */
  headerAction?: React.ReactNode;
  synergyByName?: Map<string, string[]>;
  cardInclusionMap?: Record<string, number>;
}) {
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
      <ul className="deck-section-rows">
        {rows.map((row) => (
          <DeckCardRow
            key={row.name}
            row={row}
            currency={currency}
            showPrefs={showPrefs}
            onClick={() => onRowClick(row.name)}
            onRemoveCard={onRemoveCard}
            onSetQty={onSetQty}
            onEditCard={onEditCard}
            legalityIssue={legalityBySlot?.get(row.slotIds[0])}
            onMoveToZone={onMoveToSideboard ?? onMoveToMainboard}
            moveLabel={
              onMoveToSideboard
                ? 'Move to sideboard'
                : onMoveToMainboard
                  ? 'Move to mainboard'
                  : undefined
            }
            onMakeCommander={onMakeCommander}
            canMakeCommander={canMakeCommander}
            onMakePartner={onMakePartner}
            canMakePartner={canMakePartner}
            synergyReasons={synergyByName?.get(row.card.name)}
            inclusionPct={cardInclusionMap?.[row.card.name]}
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
  synergyReasons,
  inclusionPct,
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
  synergyReasons?: string[];
  /** EDHREC inclusion rate (0–100) for this card; renders a subtle chip when set. */
  inclusionPct?: number;
}) {
  const roleBadge = showPrefs.roles ? getRoleBadge(row.card) : null;
  const mana = showPrefs.mana ? frontFaceMana(row.card) : undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const canRemove = !!onRemoveCard && row.slotIds.length > 0;
  const canEditQty = !!onSetQty && row.slotIds.length > 0;
  const [editingQty, setEditingQty] = useState(false);

  const handleRemoveOne = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (canRemove) onRemoveCard!(row.slotIds[row.slotIds.length - 1]);
  };
  const handleRemoveAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
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

  return (
    <li
      className="deck-row"
      data-peek-name={row.name}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
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
        {row.name}
        {row.isPartner && (
          <span className="deck-row-partner-tag" title="Partner commander">
            <Handshake width={12} height={12} strokeWidth={2.4} aria-hidden />
            <span className="deck-row-partner-label">Partner</span>
          </span>
        )}
        {legalityIssue && <LegalityBadge issue={legalityIssue} className="deck-row-illegal" />}
        <AllocationChip row={row} />
        {row.foil && <FoilBadge card={row} />}
        {synergyReasons && synergyReasons.length > 0 && (
          <span
            className="deck-row-synergy"
            title={`Synergy with your commander:\n• ${synergyReasons.join('\n• ')}`}
            aria-label={`Synergy: ${synergyReasons.join('; ')}`}
          >
            <span className="deck-row-synergy-icon" aria-hidden>
              ✦
            </span>
            <span className="deck-row-synergy-label">{synergyReasons[0]}</span>
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
      <div className="deck-row-menu" ref={menuRef}>
        <button
          type="button"
          className="deck-row-menu-trigger"
          aria-label="Card actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-open={menuOpen || undefined}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreVertical
            className="deck-row-menu-icon"
            width={14}
            height={14}
            strokeWidth={2}
            aria-hidden
          />
        </button>
        {menuOpen && (
          <div role="menu" className="deck-row-menu-popover">
            {onEditCard && row.slotIds.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
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
                  setMenuOpen(false);
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
              onClick={handleRemoveOne}
            >
              {row.qty > 1 ? 'Remove one copy' : 'Remove from deck'}
            </button>
            {row.qty > 1 && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                disabled={!canRemove && !canEditQty}
                onClick={handleRemoveAll}
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
                  setMenuOpen(false);
                  onMoveToZone(row.slotIds[0]);
                }}
              >
                {moveLabel}
              </button>
            )}
            {onMakeCommander && canMakeCommander?.(row.card) && row.slotIds.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
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
                  setMenuOpen(false);
                  onMakePartner(row.slotIds[0], row.card);
                }}
              >
                Make partner
              </button>
            )}
          </div>
        )}
      </div>
    </li>
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
  improveSlot,
  nextBestMoveSlot,
  costSlot,
  engineSlot,
  winConditionSlot,
  bracketFitSlot,
  powerHeroSlot,
  tuneDefaultLane,
  tuneFocusLane,
  onTuneFocusHandled,
  commanderIdentity,
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
  improveSlot?: React.ReactNode;
  nextBestMoveSlot?: React.ReactNode;
  costSlot?: React.ReactNode;
  engineSlot?: React.ReactNode;
  winConditionSlot?: React.ReactNode;
  /** Bracket Fit coaching lane — rendered inside the Bracket panel. */
  bracketFitSlot?: React.ReactNode;
  powerHeroSlot?: React.ReactNode;
  /** Tune lane to expand on first paint (the verdict hero's target). */
  tuneDefaultLane?: LaneId;
  /** One-shot lane to reveal + scroll (a hero deep-link). */
  tuneFocusLane?: LaneId | null;
  /** Cleared by the page once the focus lane has been revealed. */
  onTuneFocusHandled?: () => void;
  /** The deck's legal color identity (commander union); drives the identity gate. */
  commanderIdentity?: string[];
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

  // Tap a saltiest-card name to preview it (swipe through the salt list).
  const saltCarousel = useCardCarousel('Saltiest cards');

  // ── Tune intent lanes — imperative reveal targets for hero deep-links. ──
  // The three improve-flavored focuses (fill-gaps / upgrade / collection) all
  // resolve to the single merged Improve lane; budget is its own lane.
  const improveLaneRef = useRef<CollapsibleLaneHandle>(null);
  const budgetLaneRef = useRef<CollapsibleLaneHandle>(null);
  // Bracket Fit lives on the Power tab (inside the Bracket panel), not the Tune
  // tab — the page builds + owns its CollapsibleLane. This ref keeps the laneRefs
  // map exhaustive over LaneId; the Tune-tab deep-link below never targets it
  // (its slot isn't mounted on Tune), so it stays inert until a future hero link.
  const bracketFitLaneRef = useRef<CollapsibleLaneHandle>(null);
  const laneRefs = useMemo<Record<LaneId, React.RefObject<CollapsibleLaneHandle | null>>>(
    () => ({
      'fill-gaps': improveLaneRef,
      upgrade: improveLaneRef,
      collection: improveLaneRef,
      budget: budgetLaneRef,
      // 'similar' only tags the carousel's similar-card rows — it's never a
      // collapsible Tune lane, so it maps to the inert Improve ref purely to keep
      // this map exhaustive over LaneId (nothing deep-links to it).
      similar: improveLaneRef,
      'bracket-fit': bracketFitLaneRef,
    }),
    []
  );
  // A hero move deep-linked into a lane: expand + scroll it, then let the page
  // clear the one-shot target. Lanes only mount on the Tune tab, so wait for it.
  useEffect(() => {
    if (!tuneFocusLane || current !== 'tune') return;
    // Consume the one-shot FIRST. A lane with no data isn't mounted (ref null) —
    // there's nothing to reveal, but the page state must still clear, or a later
    // mount (analysis populating optimizeSwaps) would surprise-scroll.
    onTuneFocusHandled?.();
    laneRefs[tuneFocusLane]?.current?.reveal();
  }, [tuneFocusLane, current, laneRefs, onTuneFocusHandled]);

  return (
    <div className="deck-analysis-view">
      {current === 'stats' && (
        <div className="deck-bento deck-bento--stats">
          {/* Functional verdict hero — leads the tab with the "is it functional?"
              answer; demotes curve/color/types/validation below. Guarded like the
              checklist itself (no checks → nothing to verdict). */}
          {validation.checks.length > 0 && (
            <StatsHero validation={validation} planScore={planScore ?? null} />
          )}
          {/* Mana curve — full-width so the stacked curve reads well. */}
          <Panel title="Mana curve" wide>
            <DeckCurvePhases
              manaCurve={manaData.manaCurve}
              curveByColor={manaData.curveByColor}
              averageCmc={manaData.averageCmc}
              cardsByCmc={manaData.cardsByCmc}
            />
          </Panel>
          {/* Color + Types — a compact pair (lone survivor spans full width). */}
          <div className="deck-stats-pair">
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
          {/* Validation — pass/fail deck-health gate, pairs with Build health. */}
          <div className="deck-stats-pair">
            {validation.checks.length > 0 && (
              <Panel title="Validation">
                <ValidationChecklist result={validation} />
              </Panel>
            )}
            {planScore && (
              <Panel title="Build health">
                <PlanScoreDashboard plan={planScore} />
              </Panel>
            )}
          </div>
          {/* Saltiest — lone, spans full width. */}
          <div className="deck-stats-pair">
            {saltiestCards && saltiestCards.length > 0 && (
              <Panel title="Saltiest cards">
                <ul className="deck-saltiest-list">
                  {saltiestCards.map((c) => (
                    <li key={c.name} className="deck-saltiest-row">
                      <button
                        type="button"
                        className="deck-saltiest-name"
                        onClick={() =>
                          void saltCarousel.open(
                            saltiestCards.map((s) => ({
                              name: s.name,
                              label: `Salt ${s.salt.toFixed(2)}`,
                            })),
                            c.name
                          )
                        }
                        aria-label={`Preview ${c.name}`}
                      >
                        {c.name}
                      </button>
                      <span className="deck-saltiest-score">{c.salt.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <p className="deck-saltiest-hint">
                  EDHREC salt score (higher = more polarizing)
                  {typeof averageSalt === 'number' && ` · deck avg ${averageSalt.toFixed(2)}`}.
                </p>
                {saltCarousel.preview}
              </Panel>
            )}
          </div>
          {/* Build report — full width, list-heavy. */}
          {buildReport && (
            <Panel title="Build report" wide>
              <BuildReportPanel report={buildReport} />
            </Panel>
          )}
        </div>
      )}

      {current === 'power' && (
        <div className="deck-bento deck-bento--power">
          {powerHeroSlot}
          {/* Detailed breakdowns under the verdict hero. */}
          {/* Bracket + Roles — a compact pair (lone survivor spans full width).
              When the prescriptive Bracket Fit lane is showing, the Bracket panel
              is list-heavy and wants room: both panels go full-width (stacked) so
              the lane isn't crushed into a half-width track and Roles doesn't
              orphan an empty cell beside the tall lane. */}
          <div className="deck-stats-pair">
            {(bracketEstimation || bracketOverride != null) && (
              <Panel id="deck-power-bracket" title="Bracket" wide={!!bracketFitSlot}>
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
                  {onSetBracketOverride && (
                    <label className="deck-stats-bracket-override">
                      <span>Set bracket</span>
                      <select
                        className="deck-stats-bracket-select"
                        value={bracketOverride ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          onSetBracketOverride(v === '' ? null : (Number(v) as 1 | 2 | 3 | 4 | 5));
                        }}
                      >
                        <option value="">Auto</option>
                        {([1, 2, 3, 4, 5] as const).map((b) => (
                          <option key={b} value={b}>
                            {b} — {bracketLabel(b)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {bracketEstimation && (
                    <BracketBreakdown
                      estimation={bracketEstimation}
                      deckCardsByName={deckCardsByName}
                    />
                  )}
                  {/* Bracket Fit coaching lane — prescriptive card moves toward
                      the target. The page only builds it when a target is set and
                      the plan isn't aligned; null otherwise. */}
                  {bracketFitSlot}
                </div>
              </Panel>
            )}
            {showRoles && (
              <Panel title="Roles" wide={!!bracketFitSlot}>
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
          {/* Verdict hero — the single highest-leverage move + the intent router
              (deep-links into the lanes below). Full-width, like the Power hero. */}
          {nextBestMoveSlot}
          {/* Two intent lanes — collapsible (hero-pointed-expand). The Improve
              engine merges the old Fill-the-gaps / Upgrade-power / Build-from-
              collection sources into one ranked, owned-filterable list; Trim cost
              stays separate (its swap-to-target apply contract is distinct). */}
          {improveSlot && (
            <CollapsibleLane
              ref={improveLaneRef}
              title="Improve the deck"
              icon={<TrendingUp width={16} height={16} aria-hidden />}
              summary={<span>Your best adds — staples, power, and synergy</span>}
              defaultCollapsed={
                tuneDefaultLane !== 'fill-gaps' &&
                tuneDefaultLane !== 'upgrade' &&
                tuneDefaultLane !== 'collection'
              }
              storageKey="spellcontrol-tune-improve"
            >
              {improveSlot}
            </CollapsibleLane>
          )}
          {costSlot && (
            <CollapsibleLane
              ref={budgetLaneRef}
              title="Trim cost"
              icon={<PiggyBank width={16} height={16} aria-hidden />}
              summary={<span>Cheaper cards that play the same role</span>}
              defaultCollapsed={tuneDefaultLane !== 'budget'}
              storageKey="spellcontrol-tune-budget"
            >
              {costSlot}
            </CollapsibleLane>
          )}
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
}: {
  title: string;
  children: React.ReactNode;
  /** Span the full surface width (for list-heavy panels whose items lay out in
   *  their own multi-column grid, e.g. Cards to consider). */
  wide?: boolean;
  /** Stable id so the Power hero's summary lines can scroll to this panel. */
  id?: string;
}) {
  return (
    <div id={id} className={`deck-stats-panel${wide ? ' deck-stats-panel--wide' : ''}`}>
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
